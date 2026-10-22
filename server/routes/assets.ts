import { mavrionCafRegistros } from "@shared/schema";
import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { fetchAnmProcessoGeometryFallback } from "../lib/anm-fallback";
import { resolveAssetUfs } from "../lib/uf";
import { getOrgId } from "../lib/tenant";
import { enriquecerFazenda, consultarNDVIGrid, consultarSIGEFPublicoPorCoordenadas, consultarCCIRViaSICAR, consultarSIGEFPorDocumento, isSicarDisponivel, logSicarWarningOnce, temperaturaMediaAnual } from "../enrichment/agro";
import { sql } from "drizzle-orm";
import { consultarEmbargoIbama, consultarEmbargoIbamaCoordenadas, consultarEmbargoIbamaMunicipio } from "../lib/ibama";
import { getUsoTerraMapBiomas } from "../lib/mapbiomas";
import { consultarDeterINPE } from "../lib/deter-inpe";
import { getNDVISentinel } from "../lib/sentinel";
import { getProducaoMunicipio } from "../lib/contexto-regional";
import { consultarApiPaginadaPublica, calcularPerfilMavrion } from "../services/caf-crawler";
import { getCached, setCached } from "../cache";
import { payloadFalhaConsulta } from "../lib/consulta-contrato";

const MAVRION_API_URL = "https://api.mavrionconnect.com.br";

// Ativos minerários (MINA/JAZIDA) compartilham polígono ANM, base fundiária etc.
function isTipoMinerario(type: any): boolean {
  return type === "MINA" || type === "JAZIDA";
}
let _assetsMavrionToken: string | null = null;
let _assetsMavrionTokenExp: number = 0;

async function getAssetsApiToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && _assetsMavrionToken && Date.now() < _assetsMavrionTokenExp) return _assetsMavrionToken;
  const user = process.env.MAVRION_API_USER;
  const pass = process.env.MAVRION_API_PASS;
  if (!user || !pass) return null;
  try {
    const resp = await fetch(`${MAVRION_API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    _assetsMavrionToken = data.token || data.accessToken || null;
    _assetsMavrionTokenExp = Date.now() + 6 * 24 * 60 * 60 * 1000;
    return _assetsMavrionToken;
  } catch { return null; }
}

async function sicarionFetch(path: string, timeout = 15000): Promise<any | null> {
  const token = await getAssetsApiToken();
  if (!token) return null;
  try {
    const resp = await fetch(`${MAVRION_API_URL}${path}`, {
      headers: { "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout),
    });
    if (resp.status === 401 || resp.status === 403) {
      const refreshed = await getAssetsApiToken(true);
      if (!refreshed) return null;
      const retry = await fetch(`${MAVRION_API_URL}${path}`, {
        headers: { "Authorization": `Bearer ${refreshed}` },
        signal: AbortSignal.timeout(timeout),
      });
      if (!retry.ok) return null;
      return await retry.json();
    }
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

function computeCentroid(geometry: any): { lat: number; lon: number } | null {
  let ring: number[][] | null = null;
  if (geometry?.type === "Polygon" && geometry.coordinates?.[0]) {
    ring = geometry.coordinates[0];
  } else if (geometry?.type === "MultiPolygon" && geometry.coordinates?.[0]?.[0]) {
    ring = geometry.coordinates[0][0];
  }
  if (!ring || ring.length === 0) return null;
  const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

export function registerAssetRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  app.get(api.assets.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    const assetsList = await storage.getAssets(user?.orgId);
    res.json(assetsList);
  });

  app.post(api.assets.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.assets.create.input.parse({ ...req.body, orgId: getOrgId(req) });
      if (input.type === "FII_CRI") {
        return res.status(400).json({ message: "Fundos não fazem parte do Mavrion." });
      }
      if (input.priceAsking !== undefined && input.priceAsking !== null && input.priceAsking < 0) {
        return res.status(400).json({ message: "Preço não pode ser negativo" });
      }
      const novoAtivo = await storage.createAsset(input);

      res.status(201).json(novoAtivo);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.get("/api/assets/geo/terra", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const user = req.user as any;
      const orgId = user?.orgId;
      const rows = (await db.execute(sql`
        SELECT id, title, municipio, estado, area_ha, geo_score, car_cod_imovel, status_ativo as status,
               campos_especificos->>'latitude' as lat,
               campos_especificos->>'longitude' as lon,
               ST_AsGeoJSON(geom) as geojson
        FROM assets
        WHERE org_id = ${orgId} AND type = 'TERRA' AND geom IS NOT NULL
        ORDER BY geo_score DESC NULLS LAST
      `)) as any;
      const features = (rows.rows || []).map((r: any) => ({
        type: "Feature",
        id: r.id,
        geometry: JSON.parse(r.geojson),
        properties: {
          id: r.id,
          title: r.title,
          municipio: r.municipio,
          estado: r.estado,
          areaHa: r.area_ha ? Number(r.area_ha) : null,
          geoScore: r.geo_score ? Number(r.geo_score) : null,
          carCodImovel: r.car_cod_imovel,
          status: r.status,
          lat: r.lat ? Number(r.lat) : null,
          lon: r.lon ? Number(r.lon) : null,
        },
      }));
      res.json({ type: "FeatureCollection", features, total: features.length });
    } catch (err: any) {
      console.error("[geo/terra]", err.message);
      res.status(500).json({ message: "Erro ao buscar ativos geoespaciais" });
    }
  });

  app.get("/api/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== getOrgId(req)) return res.status(404).json({ message: "Asset not found" });

      res.json(asset);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get("/api/assets/:id/geometry", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const user = req.user as any;
      const orgId = user?.orgId;

      let row: any = null;
      try {
        const result = await db.execute(
          sql`SELECT ST_AsGeoJSON(geom) as geojson, type, anm_processo FROM assets WHERE id = ${assetId} AND org_id = ${orgId}`
        );
        row = (result as any).rows?.[0];
      } catch (geoErr: any) {
        if (geoErr?.code === '42883' || geoErr?.code === '42703') {
          const fallback = await db.execute(
            sql`SELECT type, anm_processo FROM assets WHERE id = ${assetId} AND org_id = ${orgId}`
          );
          row = (fallback as any).rows?.[0];
        } else {
          throw geoErr;
        }
      }

      if (row?.geojson) {
        return res.json({ geometry: JSON.parse(row.geojson) });
      }

      if (isTipoMinerario(row?.type) && row?.anm_processo) {
        try {
          const processo = row.anm_processo.replace(/[^0-9/]/g, "");
          const ANM_URL = "https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/0/query";
          const formBody = new URLSearchParams({
            where: `PROCESSO='${processo}'`,
            outFields: "PROCESSO,UF,SUBS,AREA_HA",
            returnGeometry: "true",
            geometryType: "esriGeometryPolygon",
            outSR: "4326",
            f: "json",
          });
          let geometry: any | null = null;
          try {
            const anmResp = await fetch(ANM_URL, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: formBody.toString(),
              signal: AbortSignal.timeout(15000),
            });
            if (anmResp.ok) {
              const anmData = await anmResp.json() as any;
              const features = anmData.features || [];
              if (features.length > 0 && features[0].geometry?.rings) {
                const rings = features[0].geometry.rings;
                const coordinates = rings.map((ring: number[][]) => ring.map((c: number[]) => [c[0], c[1]]));
                geometry = { type: "Polygon", coordinates };
              }
            }
          } catch {}

          if (!geometry) {
            // Geoportal bloqueado (WAF) — base SIGMINE espelhada na API Mavrion
            const fb = await fetchAnmProcessoGeometryFallback(processo);
            if (fb) geometry = fb.geometry;
          }

          if (geometry) {
            const coordinates = geometry.type === "Polygon"
              ? geometry.coordinates
              : geometry.coordinates.flat();

              let sumLat = 0, sumLng = 0, ptCount = 0;
              for (const ring of coordinates) {
                for (const c of ring) { sumLng += c[0]; sumLat += c[1]; ptCount++; }
              }
              const centLat = ptCount > 0 ? Math.round((sumLat / ptCount) * 1e6) / 1e6 : null;
              const centLng = ptCount > 0 ? Math.round((sumLng / ptCount) * 1e6) / 1e6 : null;

              let codigoIbge: string | null = null;
              let municipioNome: string | null = null;
              if (centLat && centLng) {
                try {
                  const nomResp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${centLat}&lon=${centLng}&format=json&zoom=10&extratags=1`, {
                    headers: { "User-Agent": "MavrionConnect/1.0" },
                    signal: AbortSignal.timeout(8000),
                  });
                  if (nomResp.ok) {
                    const nomData = await nomResp.json() as any;
                    municipioNome = nomData.address?.city || nomData.address?.town || nomData.address?.municipality || null;
                    const et = nomData.extratags || {};
                    codigoIbge = et["IBGE:GEOCODIGO"] || et["ibge:geocodigo"] || null;
                  }
                } catch {}
              }

              try {
                // Merge atômico (jsonb ||): não regrava o objeto inteiro para não
                // apagar chaves de enriquecimento salvas por requisições paralelas.
                const camposPatch: Record<string, any> = {};
                if (centLat != null) camposPatch.latitude = centLat;
                if (centLng != null) camposPatch.longitude = centLng;
                if (codigoIbge) camposPatch.codigoIbge = codigoIbge;
                if (municipioNome) camposPatch.municipio = municipioNome;

                const municipioAtual = (await db.execute(sql`SELECT municipio FROM assets WHERE id = ${assetId}`)) as any;
                const setMunicipioColuna = !municipioAtual.rows?.[0]?.municipio && municipioNome;
                if (Object.keys(camposPatch).length > 0 || setMunicipioColuna) {
                  await storage.mergeAssetCampos(
                    assetId,
                    camposPatch,
                    setMunicipioColuna ? { municipio: municipioNome } : undefined,
                  );
                }
              } catch (updateErr) {
                console.warn("Failed to update asset campos/municipio:", updateErr);
              }

              return res.json({ geometry, municipio: municipioNome, codigoIbge });
          }
        } catch (anmErr: any) {
          console.error("ANM geometry fallback error:", anmErr.message);
        }
      }

      if ((row?.type === "TERRA" || row?.type === "AGRO") && !row?.geojson) {
        try {
          const carResult = await db.execute(
            sql`SELECT car_cod_imovel FROM assets WHERE id = ${assetId} AND org_id = ${orgId}`
          );
          const carCod = (carResult as any).rows?.[0]?.car_cod_imovel;
          if (carCod) {
            const sicarionData = await sicarionFetch(`/api/sicar/${encodeURIComponent(carCod)}`);
            if (sicarionData?.geometry) {
              const centroid = computeCentroid(sicarionData.geometry);
              try {
                // Merge atômico: envia só as chaves do SICAR; codigoIbge é
                // omitido quando ausente para preservar o valor já salvo.
                const ibgeSicar = sicarionData.cod_municipio_ibge || sicarionData.properties?.cod_municipio_ibge;
                const sicarPatch: Record<string, any> = {
                  ...(centroid ? { latitude: centroid.lat, longitude: centroid.lon } : {}),
                  ...(ibgeSicar ? { codigoIbge: String(ibgeSicar) } : {}),
                  sicarStatus: sicarionData.ind_status || sicarionData.properties?.status_imovel,
                  sicarCondicao: sicarionData.condicao || sicarionData.properties?.condicao,
                  sicarTipo: sicarionData.ind_tipo || sicarionData.properties?.tipo_imovel,
                  sicarModuloFiscal: sicarionData.m_fiscal || sicarionData.properties?.m_fiscal,
                  sicarDataCriacao: sicarionData.dat_criacao || sicarionData.properties?.dat_criacao,
                  sicarDataAtualizacao: sicarionData.data_atualizacao || sicarionData.properties?.data_atualizacao,
                  sicarFonte: "SICARIOn API",
                  sicarConsultadoEm: new Date().toISOString(),
                };
                await storage.mergeAssetCampos(assetId, sicarPatch);
              } catch (updateErr) {
                console.warn("Failed to update asset from SICARIOn:", updateErr);
              }
              return res.json({ geometry: sicarionData.geometry });
            }
          }
        } catch (sicarErr: any) {
          console.error("SICAR geometry fallback error:", sicarErr.message);
        }
      }

      return res.json({ geometry: null });
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  // Resolve a geometria do processo de um ativo: coluna geom (PostGIS) → ANM ArcGIS → espelho Mavrion
  async function resolveProcessoGeometry(assetId: number, orgId: any, asset: any): Promise<any | null> {
    let geometry: any | null = null;
    try {
      const result = await db.execute(
        sql`SELECT ST_AsGeoJSON(geom) as geojson FROM assets WHERE id = ${assetId} AND org_id = ${orgId}`
      );
      const gj = (result as any).rows?.[0]?.geojson;
      if (gj) geometry = JSON.parse(gj);
    } catch { /* banco sem PostGIS/coluna geom */ }

    if (!geometry && isTipoMinerario(asset.type) && (asset as any).anmProcesso) {
      const processo = String((asset as any).anmProcesso).replace(/[^0-9/]/g, "");
      try {
        const formBody = new URLSearchParams({
          where: `PROCESSO='${processo}'`,
          outFields: "PROCESSO",
          returnGeometry: "true",
          geometryType: "esriGeometryPolygon",
          outSR: "4326",
          f: "json",
        });
        const anmResp = await fetch("https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/0/query", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody.toString(),
          signal: AbortSignal.timeout(15000),
        });
        if (anmResp.ok) {
          const anmData = await anmResp.json() as any;
          const rings = anmData.features?.[0]?.geometry?.rings;
          if (rings) {
            // normaliza topologia esri (cascas/furos em ordem arbitrária) para MultiPolygon GeoJSON
            const { esriRingsToMultiPoly } = await import("../lib/sigef-parcelas");
            const mp = esriRingsToMultiPoly(rings);
            if (mp.length > 0) geometry = { type: "MultiPolygon", coordinates: mp };
          }
        }
      } catch { /* geoportal ANM instável/WAF */ }
      if (!geometry) {
        try {
          const fb = await fetchAnmProcessoGeometryFallback(processo);
          if (fb?.geometry) geometry = fb.geometry;
        } catch {}
      }
    }
    return geometry;
  }

  // Parcelas certificadas SIGEF/INCRA sobre o polígono do processo (ativo MINA)
  app.post("/api/assets/:id/sigef-parcelas", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const geometry = await resolveProcessoGeometry(assetId, orgId, asset);
      if (!geometry) {
        // pré-condição ausente: sem geometria não há vínculo geométrico —
        // responde o contrato com identificador nulo (não estabelecido)
        return res.status(422).json(payloadFalhaConsulta({
          fonte: "SIGEF/INCRA — Acervo Fundiário (espelho ArcGIS sigef_brasil)",
          tierFonte: "T1",
          motivoFalha: "Geometria do processo indisponível — não foi possível cruzar com o SIGEF",
        }));
      }

      // 2) cruzamento com as parcelas certificadas
      const { consultarParcelasSigef } = await import("../lib/sigef-parcelas");
      const resultado = await consultarParcelasSigef(geometry);
      if (!resultado.disponivel) {
        // A lib já devolve o contrato completo (estadoConsulta, tier, janela,
        // identificador); a rota repassa o payload e PERSISTE a falha quando não
        // houver consulta boa anterior — o relatório distingue "tentou e falhou
        // em X" de "nunca consultada", sem perder dados bons já salvos.
        const motivo = (resultado as any).motivoFalha || (resultado as any).erro || "Serviço SIGEF indisponível no momento";
        const falha: any = { ...resultado, motivoFalha: motivo, message: motivo };
        delete falha.geometrias;
        const anterior = ((asset.camposEspecificos as any) || {}).sigefParcelas;
        if (!anterior || anterior.disponivel === false) {
          try {
            await storage.mergeAssetCampos(assetId, { sigefParcelas: falha, sigefParcelasUpdatedAt: new Date().toISOString() } as any);
          } catch (persistErr: any) {
            console.error("[SIGEF] Falha ao persistir estado de falha da consulta:", persistErr.message);
          }
        }
        return res.status(502).json(falha);
      }

      // 3) persiste no ativo (sem as geometrias — vão para o cache do mapa)
      const { geometrias, ...resultadoSemGeometrias } = resultado;
      const updatedAt = new Date().toISOString();
      try {
        await storage.mergeAssetCampos(assetId, { sigefParcelas: resultadoSemGeometrias, sigefParcelasUpdatedAt: updatedAt });
      } catch (persistErr: any) {
        console.error("[SIGEF] Falha ao persistir parcelas:", persistErr.message);
      }

      // 4) preenche o cache de geometrias (mesma chave da rota GET .../geometrias
      // e da consolidação CCIR), evitando nova ida à rede na primeira consolidação
      try {
        const porCodigo = new Map(resultado.parcelas.filter((p) => p.codigoParcela).map((p) => [p.codigoParcela, p]));
        const parcelasCache = (geometrias || [])
          .filter((g) => g.codigoParcela && porCodigo.has(g.codigoParcela))
          .map((g) => {
            const p = porCodigo.get(g.codigoParcela!)!;
            return {
              codigoParcela: g.codigoParcela,
              nomeArea: p.nomeArea ?? null,
              detentor: p.detentor ?? null,
              areaHa: p.areaHa ?? null,
              sobreposicaoHa: p.sobreposicaoHa ?? null,
              relacao: p.relacao,
              geometry: g.geometry,
            };
          });
        await setCached("sigef_geometrias", `${assetId}:${updatedAt}`, { parcelas: parcelasCache });
      } catch (cacheErr: any) {
        console.warn("[SIGEF] Falha ao gravar cache de geometrias na consulta:", cacheErr.message);
      }

      res.json(resultadoSemGeometrias);
    } catch (err: any) {
      console.error("[SIGEF] Erro no cruzamento de parcelas:", err.message);
      res.status(500).json(payloadFalhaConsulta({
        fonte: "SIGEF/INCRA — Acervo Fundiário (espelho ArcGIS sigef_brasil)",
        tierFonte: "T1",
        motivoFalha: `Erro inesperado ao consultar parcelas SIGEF: ${err?.message || String(err)}`,
        identificadorVinculo: { tipo: "geometria", valor: "polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE" },
      }));
    }
  });

  // Geometrias das parcelas SIGEF já consultadas, para desenhar no mapa do ativo.
  // Consulta leve no espelho (só geometria); relacao/atributos vêm do resultado salvo.
  app.get("/api/assets/:id/sigef-parcelas/geometrias", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (asset.camposEspecificos as any) || {};
      const salvas: any[] = campos.sigefParcelas?.parcelas || [];
      if (salvas.length === 0) return res.json({ parcelas: [] });

      // Cache no servidor por ativo: a chave inclui o timestamp da última consulta
      // SIGEF, então refazer a consulta (POST sigef-parcelas) invalida naturalmente.
      const cacheKey = `${assetId}:${campos.sigefParcelasUpdatedAt || "sem-data"}`;
      const cached = await getCached<{ parcelas: any[] }>("sigef_geometrias", cacheKey);
      if (cached?.parcelas) return res.json(cached);

      const geometry = await resolveProcessoGeometry(assetId, orgId, asset);
      if (!geometry) return res.json({ parcelas: [] });

      const { consultarGeometriasParcelasSigef } = await import("../lib/sigef-parcelas");
      const geoms = await consultarGeometriasParcelasSigef(geometry);
      const porCodigo = new Map(salvas.filter((p) => p.codigoParcela).map((p) => [p.codigoParcela, p]));
      const parcelas = geoms
        .filter((g) => g.codigoParcela && porCodigo.has(g.codigoParcela))
        .map((g) => {
          const p = porCodigo.get(g.codigoParcela!)!;
          return {
            codigoParcela: g.codigoParcela,
            nomeArea: p.nomeArea ?? null,
            detentor: p.detentor ?? null,
            areaHa: p.areaHa ?? null,
            sobreposicaoHa: p.sobreposicaoHa ?? null,
            relacao: p.relacao,
            geometry: g.geometry,
          };
        });
      try {
        await setCached("sigef_geometrias", cacheKey, { parcelas });
      } catch (cacheErr: any) {
        console.warn("[SIGEF] Falha ao gravar cache de geometrias:", cacheErr.message);
      }
      res.json({ parcelas });
    } catch (err: any) {
      console.error("[SIGEF] Erro ao buscar geometrias das parcelas:", err.message);
      res.status(500).json(payloadFalhaConsulta({
        fonte: "SIGEF/INCRA — Acervo Fundiário (espelho ArcGIS sigef_brasil)",
        tierFonte: "T1",
        motivoFalha: `Erro ao buscar geometrias das parcelas SIGEF: ${err?.message || String(err)}`,
        identificadorVinculo: { tipo: "geometria", valor: "polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE" },
        extras: { parcelas: [] },
      }));
    }
  });

  // UF(s) do ativo para consultas em camadas estaduais (ex.: SICAR):
  // resolveAssetUfs (../lib/uf) — cadastro → dados ANM → fallback por dados
  // fundiários já consultados (parcelas SIGEF salvas / última consulta CAR).

  // Imóveis CAR (SICAR) sobre o polígono do processo (ativo MINA)
  app.post("/api/assets/:id/car-imoveis", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const geometry = await resolveProcessoGeometry(assetId, orgId, asset);
      if (!geometry) {
        return res.status(422).json(payloadFalhaConsulta({
          fonte: "SICAR — GeoServer público (geoserver.car.gov.br)",
          tierFonte: "T1",
          motivoFalha: "Geometria do processo indisponível — não foi possível cruzar com o CAR",
        }));
      }

      const ufs = resolveAssetUfs(asset);
      if (ufs.length === 0) {
        return res.status(422).json(payloadFalhaConsulta({
          fonte: "SICAR — GeoServer público (geoserver.car.gov.br)",
          tierFonte: "T1",
          motivoFalha: "UF do ativo desconhecida — preencha o estado do ativo para consultar o CAR",
          identificadorVinculo: { tipo: "geometria", valor: "polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE" },
        }));
      }

      const { consultarImoveisCar } = await import("../lib/car-imoveis");
      const resultado = await consultarImoveisCar(geometry, ufs);
      if (!resultado.disponivel) {
        // Mesmo tratamento da rota SIGEF: repassa o contrato da lib e persiste
        // a falha quando não houver consulta boa anterior.
        const motivo = (resultado as any).motivoFalha || (resultado as any).erro || "GeoServer do SICAR indisponível no momento";
        const falha: any = { ...resultado, motivoFalha: motivo, message: motivo };
        delete falha.geometrias;
        const anterior = ((asset.camposEspecificos as any) || {}).carImoveis;
        if (!anterior || anterior.disponivel === false) {
          try {
            await storage.mergeAssetCampos(assetId, { carImoveis: falha, carImoveisUpdatedAt: new Date().toISOString() } as any);
          } catch (persistErr: any) {
            console.error("[CAR] Falha ao persistir estado de falha da consulta:", persistErr.message);
          }
        }
        return res.status(502).json(falha);
      }

      // persiste no ativo (sem as geometrias — vão para o cache do mapa)
      const { geometrias, ...resultadoSemGeometrias } = resultado;
      const updatedAt = new Date().toISOString();
      try {
        await storage.mergeAssetCampos(assetId, { carImoveis: resultadoSemGeometrias, carImoveisUpdatedAt: updatedAt });
      } catch (persistErr: any) {
        console.error("[CAR] Falha ao persistir imóveis CAR:", persistErr.message);
      }

      // preenche o cache de geometrias (mesma chave da rota GET .../geometrias
      // e da consolidação CCIR), evitando nova ida à rede na primeira consolidação
      try {
        const porCodigo = new Map(resultado.imoveis.filter((i) => i.codImovel).map((i) => [i.codImovel, i]));
        const imoveisCache = (geometrias || [])
          .filter((g) => g.codImovel && porCodigo.has(g.codImovel))
          .map((g) => {
            const i = porCodigo.get(g.codImovel!)!;
            return {
              codImovel: g.codImovel,
              municipio: i.municipio ?? null,
              areaHa: i.areaHa ?? null,
              sobreposicaoHa: i.sobreposicaoHa ?? null,
              sobreposicaoPct: i.sobreposicaoPct ?? null,
              status: i.status ?? null,
              relacao: i.relacao,
              geometry: g.geometry,
            };
          });
        await setCached("car_geometrias", `${assetId}:${updatedAt}`, { imoveis: imoveisCache });
      } catch (cacheErr: any) {
        console.warn("[CAR] Falha ao gravar cache de geometrias na consulta:", cacheErr.message);
      }

      res.json(resultadoSemGeometrias);
    } catch (err: any) {
      console.error("[CAR] Erro no cruzamento de imóveis CAR:", err.message);
      res.status(500).json(payloadFalhaConsulta({
        fonte: "SICAR — GeoServer público (geoserver.car.gov.br)",
        tierFonte: "T1",
        motivoFalha: `Erro inesperado ao consultar imóveis CAR: ${err?.message || String(err)}`,
        identificadorVinculo: { tipo: "geometria", valor: "polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE" },
      }));
    }
  });

  // Geometrias dos imóveis CAR já consultados, para desenhar no mapa do ativo.
  app.get("/api/assets/:id/car-imoveis/geometrias", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (asset.camposEspecificos as any) || {};
      const salvos: any[] = campos.carImoveis?.imoveis || [];
      if (salvos.length === 0) return res.json({ imoveis: [] });

      const cacheKey = `${assetId}:${campos.carImoveisUpdatedAt || "sem-data"}`;
      const cached = await getCached<{ imoveis: any[] }>("car_geometrias", cacheKey);
      if (cached?.imoveis) return res.json(cached);

      const geometry = await resolveProcessoGeometry(assetId, orgId, asset);
      if (!geometry) return res.json({ imoveis: [] });

      const ufs = resolveAssetUfs(asset);
      const { consultarGeometriasImoveisCar } = await import("../lib/car-imoveis");
      const geoms = await consultarGeometriasImoveisCar(geometry, ufs);
      const porCodigo = new Map(salvos.filter((i) => i.codImovel).map((i) => [i.codImovel, i]));
      const imoveis = geoms
        .filter((g) => g.codImovel && porCodigo.has(g.codImovel))
        .map((g) => {
          const i = porCodigo.get(g.codImovel!)!;
          return {
            codImovel: g.codImovel,
            municipio: i.municipio ?? null,
            areaHa: i.areaHa ?? null,
            sobreposicaoHa: i.sobreposicaoHa ?? null,
            sobreposicaoPct: i.sobreposicaoPct ?? null,
            status: i.status ?? null,
            relacao: i.relacao,
            geometry: g.geometry,
          };
        });
      try {
        await setCached("car_geometrias", cacheKey, { imoveis });
      } catch (cacheErr: any) {
        console.warn("[CAR] Falha ao gravar cache de geometrias:", cacheErr.message);
      }
      res.json({ imoveis });
    } catch (err: any) {
      console.error("[CAR] Erro ao buscar geometrias dos imóveis CAR:", err.message);
      res.status(500).json(payloadFalhaConsulta({
        fonte: "SICAR — GeoServer público (geoserver.car.gov.br)",
        tierFonte: "T1",
        motivoFalha: `Erro ao buscar geometrias dos imóveis CAR: ${err?.message || String(err)}`,
        identificadorVinculo: { tipo: "geometria", valor: "polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE" },
        extras: { imoveis: [] },
      }));
    }
  });

  // Abre sessão na Consulta Pública do SNCR e devolve a sitekey do hCaptcha
  // para a interface embedar o widget (o usuário resolve o captcha).
  app.post("/api/sncr/sessao", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { iniciarSessaoSncr } = await import("../lib/sncr-detentores");
      const sessao = await iniciarSessaoSncr();
      res.json(sessao);
    } catch (err: any) {
      console.error("[SNCR] Falha ao abrir sessão:", err.message);
      res.status(502).json({ message: err.message || "SNCR indisponível" });
    }
  });

  // Detentores das parcelas SIGEF via SNCR:
  // - sem captchaToken: preenche do cache e devolve municípios pendentes;
  // - com sessionId+captchaToken: baixa o CSV de UM município pendente,
  //   preenche as parcelas e devolve o que ainda falta.
  app.post("/api/assets/:id/sigef-detentores", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (asset.camposEspecificos as any) || {};
      const resultado = campos.sigefParcelas;
      if (!resultado?.parcelas?.length) {
        return res.status(422).json({ message: "Consulte as parcelas SIGEF antes de buscar os detentores" });
      }

      const {
        baixarMunicipioSncr, preencherDetentoresDoCacheSncr,
        municipiosPendentesSncr, CaptchaInvalidoError,
      } = await import("../lib/sncr-detentores");

      const { sessionId, captchaToken } = req.body || {};
      let municipioBaixado: string | null = null;
      if (sessionId && captchaToken) {
        const pendentes = await municipiosPendentesSncr(resultado.parcelas);
        if (pendentes.length > 0) {
          const alvo = pendentes[0];
          try {
            const payload = await baixarMunicipioSncr(sessionId, alvo.ufIbge, alvo.municipioIbge, captchaToken);
            municipioBaixado = payload.nomeMunicipio;
          } catch (e: any) {
            if (e instanceof CaptchaInvalidoError) {
              return res.status(422).json({ message: e.message, captchaInvalido: true });
            }
            throw e;
          }
        }
      }

      const preenchidas = await preencherDetentoresDoCacheSncr(resultado.parcelas);
      const municipiosPendentes = await municipiosPendentesSncr(resultado.parcelas);

      try {
        await storage.mergeAssetCampos(assetId, { sigefParcelas: resultado });
      } catch (persistErr: any) {
        console.error("[SNCR] Falha ao persistir detentores:", persistErr.message);
      }

      res.json({
        resultado,
        preenchidas,
        municipioBaixado,
        municipiosPendentes,
        totalComDetentor: resultado.parcelas.filter((p: any) => p.detentor).length,
      });
    } catch (err: any) {
      console.error("[SNCR] Erro ao buscar detentores:", err.message);
      res.status(500).json(payloadFalhaConsulta({
        fonte: "SNCR/INCRA — consulta pública de imóveis rurais",
        tierFonte: "T1",
        motivoFalha: err.message || "Erro ao buscar detentores no SNCR",
      }));
    }
  });

  // Fallback manual: o usuário baixa o CSV no site do SNCR e envia o conteúdo.
  // `municipioIbge`/`ufIbge` indicam a qual município o CSV pertence (para cache).
  app.post("/api/assets/:id/sigef-detentores/csv", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (asset.camposEspecificos as any) || {};
      const resultado = campos.sigefParcelas;
      if (!resultado?.parcelas?.length) {
        return res.status(422).json({ message: "Consulte as parcelas SIGEF antes de buscar os detentores" });
      }
      const { csv, ufIbge, municipioIbge } = req.body || {};
      if (!csv || typeof csv !== "string") return res.status(400).json({ message: "CSV ausente" });

      const { parsearCsvSncr, preencherDetentoresDoCacheSncr, municipiosPendentesSncr } = await import("../lib/sncr-detentores");
      const { setCached } = await import("../cache");
      const imoveis = parsearCsvSncr(csv);

      if (ufIbge && municipioIbge) {
        await setCached("sncr_detentor", `${ufIbge}:${municipioIbge}`, {
          ufIbge: String(ufIbge),
          municipioIbge: Number(municipioIbge),
          nomeMunicipio: null,
          baixadoEm: new Date().toISOString(),
          totalImoveis: Object.keys(imoveis).length,
          imoveis,
        });
      }

      // aplica direto às parcelas (além do cache)
      let preenchidas = 0;
      for (const p of resultado.parcelas) {
        if (p.detentor || !p.codigoImovel) continue;
        const nome = imoveis[String(p.codigoImovel).replace(/[^\d]/g, "")];
        if (nome) { p.detentor = nome; preenchidas++; }
      }
      preenchidas += await preencherDetentoresDoCacheSncr(resultado.parcelas);

      try {
        await storage.mergeAssetCampos(assetId, { sigefParcelas: resultado });
      } catch (persistErr: any) {
        console.error("[SNCR] Falha ao persistir detentores (csv):", persistErr.message);
      }

      res.json({
        resultado,
        preenchidas,
        municipiosPendentes: await municipiosPendentesSncr(resultado.parcelas),
        totalComDetentor: resultado.parcelas.filter((p: any) => p.detentor).length,
      });
    } catch (err: any) {
      console.error("[SNCR] Erro no CSV manual:", err.message);
      res.status(400).json({ message: err.message || "CSV inválido" });
    }
  });

  app.patch("/api/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const novoLog: any[] = [];
      if (req.body.type === "FII_CRI" && asset.type !== "FII_CRI") {
        return res.status(400).json({ message: "Fundos não fazem parte do Mavrion." });
      }
      const by = (req.user as any)?.username || "sistema";
      const now = new Date().toISOString();

      if (req.body.priceAsking !== undefined &&
          req.body.priceAsking !== asset.priceAsking) {
        novoLog.push({ type: "price_change", from: asset.priceAsking, to: req.body.priceAsking, at: now, by });
      }

      if (req.body.statusAtivo !== undefined &&
          req.body.statusAtivo !== asset.statusAtivo) {
        novoLog.push({ type: "status_change", from: asset.statusAtivo, to: req.body.statusAtivo, at: now, by });
      }

      const novosEsp = req.body.camposEspecificos;
      const espAtual = asset.camposEspecificos;
      if (novosEsp?.embrapa && !espAtual?.embrapa) {
        novoLog.push({ type: "enrichment", source: "Embrapa", scoreAgro: novosEsp.embrapa?.scoreAgro ?? null, at: now, by: "sistema" });
      }
      if (novosEsp?.enriquecimentoCompleto && !espAtual?.enriquecimentoCompleto) {
        novoLog.push({ type: "enrichment", source: "Completo (IBAMA+MapBiomas+Sentinel)", at: now, by: "sistema" });
      }

      if (novoLog.length > 0) {
        const logAtual = (asset.activityLog as any[]) || [];
        req.body.activityLog = [...logAtual, ...novoLog];
      }

      // storage.updateAsset aplica camposEspecificos como merge atômico (jsonb ||):
      // um PATCH com cópia parcial/desatualizada não apaga chaves salvas por
      // consultas de enriquecimento concorrentes.
      const updated = await storage.updateAsset(Number(req.params.id), req.body);

      if (req.body.statusAtivo &&
          ["fechado", "arquivado"].includes(req.body.statusAtivo) &&
          asset.statusAtivo !== req.body.statusAtivo) {
        await db.update(matchSuggestions)
          .set({ status: "rejected" })
          .where(and(
            eq(matchSuggestions.assetId, updated.id),
            eq(matchSuggestions.status, "new")
          ));
      }

      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  const ENRICHMENT_FIELDS: Record<string, string[]> = {
    TERRA: ["aptidaoUso", "topografia", "acessoPrincipal", "aguaDisponivel", "energiaEletrica", "benfeitorias", "aceitaPermuta", "situacaoDocumental", "possuiReservaLegal", "observacoesQualitativas"],
    AGRO: ["aptidaoUso", "topografia", "acessoPrincipal", "aguaDisponivel", "energiaEletrica", "benfeitorias", "aceitaPermuta", "situacaoDocumental", "possuiReservaLegal", "observacoesQualitativas"],
    MINA: ["substanciaMineral", "faseExploracao", "reservaEstimada", "possuiLicencaAmbiental", "tipoLavra", "infraestruturaLocal", "aceitaPermuta", "situacaoDocumental", "observacoesQualitativas"],
    NEGOCIO: ["setorAtuacao", "faturamentoAnual", "ebitda", "margemOperacional", "qtdFuncionarios", "motivoVenda", "possuiPassivos", "aceitaPermuta", "situacaoDocumental", "observacoesQualitativas"],
  };

  app.patch("/api/assets/:id/enrichment", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const allowedFields = ENRICHMENT_FIELDS[asset.type] || ENRICHMENT_FIELDS["NEGOCIO"];
      const enrichmentData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          enrichmentData[field] = req.body[field];
        }
      }

      const existingCampos = asset.camposEspecificos ?? {};
      const existingEnrich = existingCampos.enrichment || {};
      const mergedEnrichment = { ...existingEnrich, ...enrichmentData };

      const booleanFields = ["energiaEletrica", "aceitaPermuta", "possuiReservaLegal", "possuiLicencaAmbiental"];
      const filledCount = allowedFields.filter(f => {
        const val = mergedEnrichment[f];
        if (booleanFields.includes(f)) return val === true;
        if (val === null || val === undefined || val === "") return false;
        if (Array.isArray(val) && val.length === 0) return false;
        return true;
      }).length;
      const progress = Math.round((filledCount / allowedFields.length) * 100);

      const logAtual = (asset.activityLog as any[]) || [];
      const by = (req.user as any)?.username || "sistema";
      const now = new Date().toISOString();
      logAtual.push({ type: "enrichment", source: "Manual", progress, at: now, by });

      const updated = await storage.mergeAssetCampos(Number(req.params.id), { enrichment: mergedEnrichment }, { activityLog: logAtual });

      res.json({ ...updated, enrichmentProgress: progress });
    } catch (err: any) {
      console.error("[Enrichment PATCH]", err.message);
      res.status(500).json({ message: "Erro ao salvar enriquecimento" });
    }
  });

  app.get("/api/assets/:id/enrichment-fields", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const type = String(req.query.type || "NEGOCIO");
    res.json({ fields: ENRICHMENT_FIELDS[type] || ENRICHMENT_FIELDS["NEGOCIO"] });
  });

  app.delete("/api/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });
      await storage.deleteAsset(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/assets/:id/enriquecer-sicar", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });
      if (!["TERRA", "AGRO"].includes(asset.type)) return res.status(400).json({ message: "Disponível apenas para ativos TERRA/AGRO" });

      const carCode = asset.carCodImovel || asset.camposEspecificos?.codigoCar;
      if (!carCode) return res.status(400).json({ message: "Ativo sem código CAR. Preencha o código CAR nas informações do ativo." });

      const sicarData = await sicarionFetch(`/api/sicar/${encodeURIComponent(carCode)}`);

      if (!sicarData) return res.status(502).json({ message: "Não foi possível consultar dados CAR. A API SICARIOn não respondeu." });

      const geometry = sicarData.geometry || null;
      const centroid = geometry ? computeCentroid(geometry) : null;
      const props = sicarData.properties || {};

      const sicarPatch: Record<string, any> = {
        ...(centroid ? { latitude: centroid.lat, longitude: centroid.lon } : {}),
        codigoIbge: String(sicarData.cod_municipio_ibge || props.cod_municipio_ibge || asset.camposEspecificos?.codigoIbge || ""),
        sicarStatus: sicarData.ind_status || props.status_imovel || null,
        sicarCondicao: sicarData.condicao || props.condicao || null,
        sicarTipo: sicarData.ind_tipo || props.tipo_imovel || null,
        sicarModuloFiscal: sicarData.m_fiscal || props.m_fiscal || null,
        sicarDataCriacao: sicarData.dat_criacao || props.dat_criacao || null,
        sicarDataAtualizacao: sicarData.data_atualizacao || props.data_atualizacao || null,
        sicarArea: sicarData.num_area || props.area || null,
        sicarMunicipio: sicarData.municipio || props.municipio || null,
        sicarUf: sicarData.uf || props.uf || null,
        sicarFonte: (sicarData as any)._fonte || "SICARIOn API",
        sicarConsultadoEm: new Date().toISOString(),
      };

      const extraFields: Record<string, any> = {};
      if (!asset.municipio && (sicarData.municipio || props.municipio)) {
        extraFields.municipio = sicarData.municipio || props.municipio;
      }
      if (!asset.estado && (sicarData.uf || props.uf)) {
        extraFields.estado = sicarData.uf || props.uf;
      }
      if (sicarData.num_area && !asset.areaHa) {
        extraFields.areaHa = sicarData.num_area;
      }

      await storage.mergeAssetCampos(asset.id, sicarPatch, Object.keys(extraFields).length > 0 ? extraFields : undefined);

      if (geometry) {
        try {
          await db.execute(sql`UPDATE assets SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326) WHERE id = ${asset.id}`);
        } catch (geomErr) {
          console.warn("[enriquecer-sicar] Falha ao salvar geometria PostGIS:", geomErr);
        }
      }

      res.json({
        success: true,
        sicar: {
          codImovel: carCode,
          status: sicarPatch.sicarStatus,
          condicao: sicarPatch.sicarCondicao,
          tipo: sicarPatch.sicarTipo,
          moduloFiscal: sicarPatch.sicarModuloFiscal,
          area: sicarPatch.sicarArea,
          municipio: sicarPatch.sicarMunicipio,
          uf: sicarPatch.sicarUf,
          dataCriacao: sicarPatch.sicarDataCriacao,
          dataAtualizacao: sicarPatch.sicarDataAtualizacao,
          codigoIbge: sicarPatch.codigoIbge,
          temGeometria: !!geometry,
          fonte: "SICARIOn API",
          consultadoEm: sicarPatch.sicarConsultadoEm,
        },
      });
    } catch (err) {
      console.error("[enriquecer-sicar] Erro:", (err as Error).message);
      res.status(500).json({ message: "Erro ao consultar SICAR" });
    }
  });

  app.post("/api/assets/:id/enriquecer-embrapa", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = asset.camposEspecificos ?? {};
      const attrs = (asset.attributesJson as any) || {};
      const forceRefresh = req.body.force === true;

      if (!forceRefresh && campos.embrapa && campos.embrapa.solo) {
        return res.json({
          success: true,
          dados: campos.embrapa,
          ativo: asset,
          cached: true,
          cachedAt: campos.embrapaUpdatedAt || null,
        });
      }

      let lat: number | null = campos.latitude != null ? Number(campos.latitude) : (req.body.lat != null ? Number(req.body.lat) : null);
      let lon: number | null = campos.longitude != null ? Number(campos.longitude) : (req.body.lon != null ? Number(req.body.lon) : null);
      const codIBGE: string = campos.codigoIbge || attrs.codigoIbge || req.body.codigoIbge || "";

      if (lat == null || lon == null) {
        try {
          const geomRows = await db.execute(sql`SELECT ST_AsGeoJSON(geom) as geojson FROM assets WHERE id = ${asset.id} AND geom IS NOT NULL`);
          if ((geomRows as any).rows?.[0]?.geojson) {
            const geom = JSON.parse((geomRows as any).rows[0].geojson);
            let ring: number[][] | null = null;
            if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
              ring = geom.coordinates[0];
            } else if (geom.type === 'MultiPolygon' && geom.coordinates?.[0]?.[0]) {
              ring = geom.coordinates[0][0];
            }
            if (ring && ring.length > 0) {
              lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
              lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
            }
          }
        } catch (geoErr) {
          console.warn("Não foi possível extrair centroide da geometria:", geoErr);
        }
      }

      if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({
          message: "Coordenadas não encontradas para este ativo. Reimporte o imóvel na Geo Rural para corrigir."
        });
      }

      const resultado = await enriquecerFazenda({ lat, lon, codIBGE: codIBGE || undefined });

      const embrapaCompat: any = {};
      if (resultado.solo) {
        const s = resultado.solo;
        let classificacao = s.soilClass || 'Não classificado';
        let textura = '';
        if (s.clay !== null) {
          if (s.clay > 60) textura = 'Muito argilosa';
          else if (s.clay > 35) textura = 'Argilosa';
          else if (s.clay > 15) textura = 'Média';
          else textura = 'Arenosa';
        }
        let aptidao = '';
        if (s.phh2o !== null && s.soc !== null) {
          if (s.phh2o >= 5.5 && s.phh2o <= 7.0 && s.soc > 10) aptidao = 'Boa para agricultura';
          else if (s.phh2o >= 4.5 && s.phh2o <= 7.5) aptidao = 'Moderada';
          else aptidao = 'Restrita — necessita correção';
        }
        embrapaCompat.solo = {
          classificacao,
          textura,
          aptidao,
          ph: s.phh2o,
          argila: s.clay,
          areia: s.sand,
          carbonoOrganico: s.soc,
          nitrogenio: s.nitrogen,
          cec: s.cec,
          fonte: `SoilGrids/ISRIC — ${s.profundidade || 'profundidade não informada'}, ponto central, estimativa de modelo 250 m`,
        };
      }

      // Só entram culturas com janela de plantio no ZARC do município. Antes, sem aptidão definida, o
      // risco virava "medio" — um valor inventado para quem simplesmente não tinha dado.
      const zarcComJanela = resultado.zarc.filter(z => z.aptidao);
      if (zarcComJanela.length > 0) {
        embrapaCompat.zoneamento = {
          culturas: zarcComJanela.map(z => ({
            nome: z.cultura,
            risco: z.aptidao === 'Apto' ? 'baixo' : z.aptidao === 'Inapto' ? 'alto' : '',
            epocaPlantio: z.datasPlantio?.join(', ') || '',
            aptidao: z.aptidao,
          })),
        };
      }

      if (resultado.ndviSatveg && resultado.ndviSatveg.ndviMedio > 0) {
        embrapaCompat.ndvi = {
          ndvi: resultado.ndviSatveg.ndviMedio,
          evi: resultado.ndviSatveg.eviMedio,
          classificacao: resultado.ndviSatveg.ndviMedio >= 0.7 ? 'Vegetação densa e saudável' : resultado.ndviSatveg.ndviMedio >= 0.4 ? 'Vegetação moderada' : 'Vegetação escassa',
          fonte: resultado.ndviSatveg.fonte,
          periodo: `${resultado.ndviSatveg.dataInicio} a ${resultado.ndviSatveg.dataFim}`,
        };
      }
      // Sem NDVI de satélite (SATVeg) NÃO se inventa índice: a fórmula antiga derivava um "NDVI"
      // do carbono do solo (0.5 + carbono/100 ± 0.1) e o classificava como "vegetação densa/moderada".
      // Isso não é medição de vegetação. Sem dado real, o campo fica ausente.

      if (resultado.clima) {
        const tempMedia = temperaturaMediaAnual(resultado.clima);
        embrapaCompat.clima = {
          precipitacaoMedia: resultado.clima.precipitacaoMedia,
          temperaturaMedia: tempMedia,
          temperaturaMax: resultado.clima.temperaturaMaxMedia,
          temperaturaMin: resultado.clima.temperaturaMinMedia,
          indiceSeca: resultado.resumo || '',
          fonte: resultado.clima.fonte,
          precipitacaoAnual: resultado.clima.precipitacaoAnual,
          precipitacaoMensal: resultado.clima.precipitacaoMensal,
          temperaturaMensal: resultado.clima.temperaturaMensal,
          mesesSecos: resultado.clima.mesesSecos,
          mesesChuvosos: resultado.clima.mesesChuvosos,
          anoReferencia: resultado.clima.anoReferencia,
        };
      }
      // Consulta de clima falhou: o campo fica ausente. Antes gravava precipitação 0 / temperatura 0,
      // que a tela exibia como "sem chuva" em vez de "sem dado".

      embrapaCompat.scoreAgro = resultado.scoreAgro;
      embrapaCompat.resumo = resultado.resumo;

      const now = new Date().toISOString();
      const updated = await storage.mergeAssetCampos(Number(req.params.id), {
        latitude: lat,
        longitude: lon,
        codigoIbge: codIBGE || campos.codigoIbge || null,
        embrapa: embrapaCompat,
        agro: resultado,
        embrapaUpdatedAt: now,
      });

      res.json({ success: true, dados: embrapaCompat, ativo: updated, cached: false, cachedAt: now });
    } catch (err: any) {
      console.error("Erro enriquecimento agro:", err.message);
      res.status(500).json({ message: err.message || "Erro ao enriquecer ativo" });
    }
  });

  app.post("/api/assets/:id/ndvi-grid", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const gridSize = Math.min(7, Math.max(3, Number(req.body.gridSize) || 5));

      let polygon: number[][] | null = null;

      try {
        const geomRows = await db.execute(sql`SELECT ST_AsGeoJSON(geom) as geojson FROM assets WHERE id = ${asset.id} AND geom IS NOT NULL`);
        if ((geomRows as any).rows?.[0]?.geojson) {
          const geom = JSON.parse((geomRows as any).rows[0].geojson);
          if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
            polygon = geom.coordinates[0];
          } else if (geom.type === 'MultiPolygon' && geom.coordinates?.[0]?.[0]) {
            polygon = geom.coordinates[0][0];
          }
        }
      } catch (geoErr) {
        console.warn("Erro ao extrair geometria para NDVI grid:", geoErr);
      }

      if (!polygon || polygon.length < 3) {
        const camposFallback = asset.camposEspecificos ?? {};
        const lat = Number(camposFallback.latitude);
        const lon = Number(camposFallback.longitude);
        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          const offset = 0.005;
          polygon = [
            [lon - offset, lat - offset],
            [lon + offset, lat - offset],
            [lon + offset, lat + offset],
            [lon - offset, lat + offset],
            [lon - offset, lat - offset],
          ];
        }
      }

      if (!polygon || polygon.length < 3) {
        return res.status(400).json({
          message: "Este ativo não possui geometria (polígono) para análise de variabilidade. Reimporte o imóvel na Geo Rural."
        });
      }

      const resultado = await consultarNDVIGrid(polygon, gridSize);
      if (!resultado) {
        return res.status(502).json({
          message: "Não foi possível obter dados NDVI do SATVeg. Verifique se as chaves Embrapa estão configuradas."
        });
      }

      await storage.mergeAssetCampos(Number(req.params.id), {
        ndviGrid: {
          ...resultado,
          polygon,
        },
      });

      res.json({ success: true, ...resultado, polygon });
    } catch (err: any) {
      console.error("Erro NDVI grid:", err.message);
      res.status(500).json({ message: err.message || "Erro ao analisar variabilidade NDVI" });
    }
  });

  app.get("/api/embrapa/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { checkAgritecHealth } = await import("../enrichment/agro");
      const agritecOnline = await checkAgritecHealth();
      res.json({
        status: agritecOnline ? "online" : "degraded",
        message: agritecOnline ? "Agritec v2 respondendo" : "Agritec v2 indisponível — SoilGrids e ClimAPI funcionam normalmente",
        apis: {
          soilgrids: "online",
          climapi: process.env.EMBRAPA_CONSUMER_KEY ? "configured" : "no_key",
          agritec: agritecOnline ? "online" : "offline",
        },
      });
    } catch (err: any) {
      res.json({ status: "offline", message: err.message });
    }
  });

  app.post("/api/assets/:id/enriquecer-completo", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });

      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = asset.camposEspecificos ?? {};
      const lat = Number(campos.latitude);
      const lon = Number(campos.longitude);
      const polygon = campos.geoPolygon || null;
      const cpfCnpjProprietario = campos.cpfProprietario || campos.cnpjProprietario || null;

      const resultados: any = { enriquecidoEm: new Date().toISOString() };
      const erros: string[] = [];

      const [ibamaCnpj, ibamaGeo, mapbiomas, sentinelNdvi] = await Promise.allSettled([
        cpfCnpjProprietario
          ? consultarEmbargoIbama(cpfCnpjProprietario)
          : Promise.resolve(null),
        lat && lon
          ? consultarEmbargoIbamaCoordenadas(lat, lon)
          : Promise.resolve(null),
        lat && lon
          ? getUsoTerraMapBiomas(lat, lon, campos.car_cod_imovel || asset.carCodImovel || undefined)
          : Promise.resolve(null),
        lat && lon
          ? getNDVISentinel(lat, lon, polygon)
          : Promise.resolve(null),
      ]);

      if (ibamaCnpj.status === "fulfilled" && ibamaCnpj.value) {
        resultados.ibamaProprietario = ibamaCnpj.value;
      } else erros.push("IBAMA CPF/CNPJ");

      if (ibamaGeo.status === "fulfilled" && ibamaGeo.value) {
        resultados.ibamaGeo = ibamaGeo.value;
      } else erros.push("IBAMA Geo");

      if (mapbiomas.status === "fulfilled" && mapbiomas.value) {
        resultados.mapbiomas = mapbiomas.value;
      } else erros.push("MapBiomas");

      if (sentinelNdvi.status === "fulfilled" && sentinelNdvi.value) {
        resultados.ndviHD = sentinelNdvi.value;
      } else erros.push("Sentinel NDVI");

      const temEmbargoIbama =
        resultados.ibamaProprietario?.temEmbargo ||
        resultados.ibamaGeo?.temEmbargo || false;

      await storage.mergeAssetCampos(asset.id, {
        enriquecimentoCompleto: resultados,
        temEmbargoIbama,
        enriquecimentoCompletoEm: new Date().toISOString(),
      });

      res.json({
        message: `Enriquecimento concluído${erros.length > 0 ? ` (${erros.join(", ")} indisponíveis)` : ""}`,
        resultados,
        temEmbargoIbama,
        erros,
      });
    } catch (err: any) {
      console.error("[enriquecer-completo] Erro:", err);
      res.status(500).json({ message: err?.message || "Erro interno no enriquecimento completo" });
    }
  });

  app.get("/api/assets/:id/ambiental", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const user = req.user as any;
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== user?.orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = asset.camposEspecificos ?? {};
      const lat = Number(campos.latitude);
      const lon = Number(campos.longitude);

      if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ message: "Ativo sem coordenadas (latitude/longitude)" });
      }

      const carCode = campos.car_cod_imovel || asset.carCodImovel || undefined;
      const cpfCnpj = campos.cpfProprietario || campos.cnpjProprietario || null;

      const existingIbamaProp = campos.ibamaProprietario || null;
      const existingIbamaGeo = campos.ibamaGeo || null;

      const [deterResult, mapbiomasResult, ibamaPropResult, ibamaGeoResult] = await Promise.allSettled([
        consultarDeterINPE(lat, lon),
        getUsoTerraMapBiomas(lat, lon, carCode),
        existingIbamaProp
          ? Promise.resolve(existingIbamaProp)
          : cpfCnpj
            ? consultarEmbargoIbama(cpfCnpj)
            : Promise.resolve(null),
        existingIbamaGeo
          ? Promise.resolve(existingIbamaGeo)
          : consultarEmbargoIbamaCoordenadas(lat, lon),
      ]);

      const deter = deterResult.status === "fulfilled" ? deterResult.value : null;
      const mapbiomas = mapbiomasResult.status === "fulfilled" ? mapbiomasResult.value : null;
      let ibamaProp = ibamaPropResult.status === "fulfilled" ? ibamaPropResult.value : null;
      let ibamaGeo = ibamaGeoResult.status === "fulfilled" ? ibamaGeoResult.value : null;

      if (!ibamaGeo || (ibamaGeo as any).totalInfracoes === 0) {
        const munName = mapbiomas?.municipio || campos.municipio || "";
        const ufName = mapbiomas?.estado || campos.uf || "";
        const ufSigla = ufName.length === 2 ? ufName :
          { "Minas Gerais": "MG", "São Paulo": "SP", "Rio de Janeiro": "RJ", "Bahia": "BA",
            "Goiás": "GO", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS", "Paraná": "PR",
            "Rio Grande do Sul": "RS", "Santa Catarina": "SC", "Pará": "PA", "Amazonas": "AM",
            "Maranhão": "MA", "Piauí": "PI", "Ceará": "CE", "Pernambuco": "PE", "Tocantins": "TO",
            "Rondônia": "RO", "Acre": "AC", "Amapá": "AP", "Roraima": "RR", "Sergipe": "SE",
            "Alagoas": "AL", "Rio Grande do Norte": "RN", "Paraíba": "PB", "Espírito Santo": "ES",
            "Distrito Federal": "DF" }[ufName as string] as string || "";
        if (munName && ufSigla) {
          try {
            const munResult = await consultarEmbargoIbamaMunicipio(munName, ufSigla);
            if (munResult) {
              ibamaGeo = {
                temEmbargo: munResult.temEmbargo,
                totalInfracoes: munResult.totalInfracoes,
                embargos: munResult.infracoes || [],
                fonte: `IBAMA — Município ${munName}/${ufSigla}`,
              };
            }
          } catch {}
        }
      }

      const ibamaAvailable = !!(ibamaProp || ibamaGeo);
      const temEmbargo = ibamaAvailable ? !!(ibamaProp?.temEmbargo || ibamaGeo?.temEmbargo) : null;
      const embargosLista = [
        ...(ibamaProp?.embargos || []),
        ...(ibamaGeo?.embargos || []),
      ];
      const totalInfracoes = (ibamaGeo as any)?.totalInfracoes || 0;

      const ibama = ibamaAvailable ? {
        temEmbargo: !!temEmbargo,
        totalEmbargos: embargosLista.filter((e: any) => e.temEmbargo).length,
        totalInfracoes,
        embargos: embargosLista.slice(0, 20),
        fonte: (ibamaGeo as any)?.fonte || "IBAMA — Base Local",
      } : null;

      const ambiental = {
        deter,
        mapbiomas,
        ibama,
        deterStatus: deter ? "ok" : "indisponivel",
        mapbiomasStatus: mapbiomas ? "ok" : "indisponivel",
        ibamaStatus: ibama ? "ok" : "indisponivel",
        consultadoEm: new Date().toISOString(),
      };

      await storage.mergeAssetCampos(asset.id, { ambiental });

      res.json(ambiental);
    } catch (err) {
      console.error("[Ambiental] Erro:", (err as Error).message);
      res.status(500).json({ message: "Erro na consulta ambiental" });
    }
  });

  app.post("/api/assets/:id/contexto-regional", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const user = req.user as any;
      const orgId = user?.orgId;
      const assetId = Number(req.params.id);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      if (!["TERRA", "AGRO"].includes(asset.type)) {
        return res.status(400).json({ message: "Contexto regional disponível apenas para ativos agrícolas" });
      }

      const campos = asset.camposEspecificos ?? {};
      const codigoIbge = campos.codigoIbge;
      if (!codigoIbge) {
        return res.status(400).json({ message: "Ativo sem código IBGE do município. Enriqueça o ativo com dados geoespaciais primeiro." });
      }

      const contexto = await getProducaoMunicipio(codigoIbge);
      if (!contexto) {
        return res.status(400).json({ message: "Não foi possível obter dados de produção agrícola para este município" });
      }

      await storage.mergeAssetCampos(asset.id, { contextoRegional: contexto });

      res.json({ success: true, contexto });
    } catch (error: any) {
      console.error("Erro contexto regional:", error);
      res.status(500).json({ message: "Erro ao carregar contexto regional" });
    }
  });

  app.post("/api/assets/:id/enriquecer-caf", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });

    try {
      const asset = await storage.getAsset(id);
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = asset.camposEspecificos ?? {};
      const municipio = asset.municipio || campos.municipio;
      const estado = asset.estado || campos.estado;
      const codIBGE = campos.codigoIbge || campos.codIBGE || "";

      if (!municipio && !codIBGE) {
        return res.status(400).json({ message: "Município ou código IBGE não disponível para este ativo" });
      }

      const cacheKey = `caf_asset_${id}`;
      if (!req.body.force) {
        const cached = await getCached("caf_municipio", cacheKey);
        if (cached) return res.json({ success: true, cafData: cached, cached: true });
      }

      let codigoMunicipio = codIBGE;
      if (!codigoMunicipio && municipio && estado) {
        try {
          const { default: axios } = await import("axios");
          const r = await axios.get(
            `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${estado}/municipios`,
            { timeout: 10000 }
          );
          const found = (r.data || []).find((m: any) =>
            m.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") ===
            municipio.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          );
          if (found) codigoMunicipio = String(found.id);
        } catch {}
      }

      if (!codigoMunicipio) {
        return res.status(400).json({ message: `Não foi possível resolver o código IBGE de "${municipio}" (${estado})` });
      }

      const result = await consultarApiPaginadaPublica({
        codigoMunicipio,
        uf: estado || undefined,
        pagina: 1,
        tamanhoPagina: 50,
      });

      if (!result.sucesso) {
        try {
          const localRows = await db.execute(sql`
            SELECT * FROM ${mavrionCafRegistros}
            WHERE (municipio ILIKE ${`%${municipio}%`} OR uf = ${estado})
            ORDER BY created_at DESC
            LIMIT 50
          `);
          const localData = (localRows as any).rows || localRows;
          if (localData && localData.length > 0) {
            const produtoresLocal = localData.map((r: any) => ({
              idUfpa: r.numero_ufpa || "",
              nufpa: r.numero_ufpa || "",
              nome: r.nome_titular || "",
              cpfMascarado: r.cpf_titular || "",
              situacao: r.status === "ativo" ? "ATIVA" : r.status?.toUpperCase() || "ATIVA",
              grauParentesco: "Titular",
              municipio: r.municipio || municipio || "",
              uf: r.uf || estado || "",
              atividade: r.atividade_principal || "",
              areaHa: r.area_ha ? Number(r.area_ha) : null,
              condicaoPosse: r.condicao_posse || "",
              numImoveis: r.num_imoveis || 1,
              enquadramentoPronaf: r.enquadramento_pronaf === "Sim",
              dataValidade: r.validade || null,
              dataInscricao: r.data_inscricao || null,
              entidadeCadastradora: r.entidade_nome || "",
              membros: r.composicao_familiar || [],
              classificacao: "pendente" as const,
              extraidoEm: r.created_at || new Date().toISOString(),
              perfil: r[mavrionCafRegistros.mavrionProfile.name] || "baixo",
              fonteLocal: true,
            }));
            const familias = new Set(produtoresLocal.map((p: any) => p.idUfpa || p.nufpa));
            const cafData = {
              produtores: produtoresLocal,
              totalProdutores: produtoresLocal.length,
              totalFamilias: familias.size,
              totalMembros: produtoresLocal.reduce((s: number, p: any) => s + (p.membros?.length || 0), 0),
              municipio,
              codigoMunicipio,
              consultadoEm: new Date().toISOString(),
              fonteLocal: true,
            };
            return res.json({ success: true, cafData, fonteLocal: true });
          }
        } catch (localErr: any) {
          console.log("[enriquecer-caf] Fallback local DB também falhou:", localErr.message);
        }

        const motivo = (result as any).motivo || "API do CAF indisponível no momento";
        return res.status(502).json({
          message: motivo,
          httpStatus: (result as any).httpStatus,
          detalhes: (result as any).httpStatus === 403
            ? "O site caf.mda.gov.br está bloqueando conexões deste servidor (HTTP 403). Isso pode ser temporário ou um bloqueio de IP pelo firewall do governo."
            : undefined,
        });
      }

      const produtores = result.dados.map((d: any) => {
        const lead = {
          idUfpa: d.idUfpa || d.id?.toString() || "",
          nufpa: d.nufpa || d.numeroUFPA || "",
          nome: d.nome || d.nomeTitular || "",
          cpfMascarado: d.cpfMascarado || d.cpf || "",
          situacao: d.situacao || d.descSituacao || "Ativo",
          grauParentesco: d.grauParentesco || "Titular",
          municipio: d.municipio || municipio || "",
          uf: d.uf || estado || "",
          atividade: d.atividade || d.descAtividade || "",
          areaHa: d.areaHa || d.areaTotalHectare || null,
          condicaoPosse: d.condicaoPosse || "",
          numImoveis: d.numImoveis || d.quantidadeImovel || 1,
          enquadramentoPronaf: d.enquadramentoPronaf ?? d.pronaf ?? false,
          dataValidade: d.dataValidade || null,
          dataInscricao: d.dataInscricao || null,
          entidadeCadastradora: d.entidadeCadastradora || "",
          membros: d.membros || [],
          classificacao: "pendente" as const,
          extraidoEm: new Date().toISOString(),
        };
        return { ...lead, perfil: calcularPerfilMavrion(lead) };
      });

      const familias = new Set(produtores.map((p: any) => p.idUfpa || p.nufpa));
      const totalMembros = produtores.reduce((sum: number, p: any) => sum + (p.membros?.length || 0), 0);

      const cafData = {
        produtores,
        totalProdutores: produtores.length,
        totalFamilias: familias.size,
        totalMembros,
        municipio,
        codigoMunicipio,
        consultadoEm: new Date().toISOString(),
      };

      await setCached("caf_municipio", cacheKey, cafData);

      const cafEnrichData = {
        cafData,
        cafProdutores: produtores,
        cafUpdatedAt: new Date().toISOString(),
        cafTotalProdutores: produtores.length,
        cafTotalFamilias: familias.size,
      };
      await db.execute(sql`
        UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify(cafEnrichData)}::jsonb
        WHERE id = ${id}
      `);

      res.json({ success: true, cafData });
    } catch (error: any) {
      console.error("[enriquecer-caf]", error);
      res.status(500).json({ message: error.message || "Erro ao buscar dados CAF" });
    }
  });

  logSicarWarningOnce();

  app.post("/api/enrichment/ccir/:assetId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });

    const ROUTE_TIMEOUT_MS = 60000;

    try {
      const user = req.user as any;
      const assetId = Number(req.params.assetId);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== user?.orgId) {
        return res.status(404).json({ message: "Ativo não encontrado" });
      }

      // Ativo minerário: CCIR por imóvel identificado sobre o polígono do
      // processo (parcelas SIGEF sobrepostas + imóveis CAR), em vez do CAR
      // do próprio ativo. Consolida denominação, código INCRA, detentores
      // (SNCR) e situação — persistido por imóvel em campos.ccirImoveis.
      if (isTipoMinerario(asset.type)) {
        const campos = (asset.camposEspecificos as any) || {};
        const parcelasSobrepostas: any[] = (campos.sigefParcelas?.parcelas || []).filter((p: any) => p.relacao === "sobreposta");
        const carSobrepostos: any[] = (campos.carImoveis?.imoveis || []).filter((i: any) => i.relacao === "sobreposto");

        if (parcelasSobrepostas.length === 0 && carSobrepostos.length === 0) {
          // pré-condição ausente também responde o contrato de três estados
          return res.status(422).json(payloadFalhaConsulta({
            fonte: "CCIR — consolidação fundiária (SIGEF + SNCR + CAR)",
            tierFonte: "T1",
            motivoFalha: "Nenhum imóvel identificado sobre o processo. Consulte primeiro as parcelas SIGEF e os imóveis CAR na aba Geo (Base Fundiária).",
            identificadorVinculo: { tipo: "geometria", valor: "imóveis sobrepostos ao polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE + consultas SIGEF/CAR do ativo" },
          }));
        }

        // Detentores via cache SNCR (melhor esforço, sem captcha) — a falha
        // fica explícita no payload em vez de engolida
        let municipiosPendentes: any[] = [];
        let estadoSncr: "registro_existente" | "consultada_sem_registro" | "nao_consultada" = "consultada_sem_registro";
        let motivoEstadoSncr: string | null = null;
        try {
          const { preencherDetentoresDoCacheSncr, municipiosPendentesSncr } = await import("../lib/sncr-detentores");
          await preencherDetentoresDoCacheSncr(parcelasSobrepostas);
          municipiosPendentes = await municipiosPendentesSncr(parcelasSobrepostas);
        } catch (sncrErr: any) {
          estadoSncr = "nao_consultada";
          motivoEstadoSncr = `cache SNCR indisponível: ${sncrErr?.message || String(sncrErr)}`;
        }

        // Casamento SIGEF×CAR por geometria: parcela majoritariamente dentro do
        // imóvel CAR ⇒ mesma propriedade ⇒ funde num único registro (melhor esforço).
        let parcelaParaCar = new Map<string, string>();
        let casamentoInfo: { abaixoLimiar: Map<string, { codImovel: string; fracaoPct: number }>; limiarPct: number } | undefined;
        let casamentoRealizado = false;
        let casamentoIndisponivelMotivo: string | null = null;
        try {
          // Reaproveita as geometrias já buscadas para o mapa (mesmas chaves de
          // cache das rotas .../geometrias) — rede só para o que faltar.
          const [sigefCache, carCache] = await Promise.all([
            getCached<{ parcelas: any[] }>("sigef_geometrias", `${assetId}:${campos.sigefParcelasUpdatedAt || "sem-data"}`).catch(() => null),
            getCached<{ imoveis: any[] }>("car_geometrias", `${assetId}:${campos.carImoveisUpdatedAt || "sem-data"}`).catch(() => null),
          ]);
          const geometriasCache = {
            parcelas: (sigefCache?.parcelas || []).filter((p: any) => p.codigoParcela && p.geometry),
            imoveis: (carCache?.imoveis || []).filter((i: any) => i.codImovel && i.geometry),
          };
          const cacheCompleto = geometriasCache.parcelas.length > 0 && geometriasCache.imoveis.length > 0;
          // Só resolve a geometria do processo (potencialmente rede) se alguma fonte faltar no cache
          const geometry = cacheCompleto ? null : await resolveProcessoGeometry(assetId, user?.orgId, asset);
          if (geometry || cacheCompleto) {
            const { casarParcelasSigefComCar } = await import("../lib/car-imoveis");
            const casamento = await casarParcelasSigefComCar(
              geometry,
              resolveAssetUfs(asset),
              parcelasSobrepostas.map((p: any) => p.codigoParcela).filter(Boolean),
              carSobrepostos.map((i: any) => i.codImovel).filter(Boolean),
              geometriasCache,
            );
            parcelaParaCar = casamento.casados;
            casamentoInfo = { abaixoLimiar: casamento.abaixoLimiar, limiarPct: casamento.limiarPct };
            casamentoRealizado = true;
          } else {
            casamentoIndisponivelMotivo = "geometria do processo indisponível para o casamento SIGEF×CAR — fontes exibidas separadamente";
          }
        } catch (matchErr: any) {
          console.warn("[CCIR-MINA] Casamento SIGEF×CAR indisponível:", matchErr.message);
          casamentoIndisponivelMotivo = `casamento SIGEF×CAR indisponível: ${matchErr?.message || String(matchErr)} — fontes exibidas separadamente`;
        }

        // Consolida por código do imóvel (SNCR/INCRA) e funde SIGEF×CAR
        const { consolidarImoveisFundiarios } = await import("../lib/ccir-fusao");
        const imoveis = consolidarImoveisFundiarios(parcelasSobrepostas, carSobrepostos, parcelaParaCar, casamentoInfo);

        const comDetentor = imoveis.filter((i) => i.detentores.length > 0).length;
        if (estadoSncr !== "nao_consultada") {
          estadoSncr = comDetentor > 0 ? "registro_existente" : "consultada_sem_registro";
        }
        const ccirImoveis: any = {
          disponivel: true,
          consultadoEm: new Date().toISOString(),
          fonte: "SIGEF/INCRA (espelho ArcGIS) + SNCR (detentores) + SICAR (CAR)",
          // contrato de três estados no nível do módulo consolidado
          estadoConsulta: imoveis.length > 0 ? "registro_existente" : "consultada_sem_registro",
          situacaoRegistro: imoveis.length > 0 ? "indeterminada" : null,
          tierFonte: "T1",
          janelaCobertura: [campos.sigefParcelas?.janelaCobertura, campos.carImoveis?.janelaCobertura].filter(Boolean).join(" + ")
            || "bases SIGEF/SNCR/CAR conforme as consultas de origem persistidas no ativo",
          identificadorVinculo: { tipo: "geometria", valor: "imóveis sobrepostos ao polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE + consultas SIGEF/CAR do ativo" },
          // disponibilidade explícita das etapas de enriquecimento
          estadoSncr,
          motivoEstadoSncr,
          casamentoRealizado,
          casamentoIndisponivelMotivo,
          totalImoveis: imoveis.length,
          comCodigoIncra: imoveis.filter((i) => i.codigoIncra).length,
          fundidosSigefCar: imoveis.filter((i) => i.origem === "SIGEF+CAR").length,
          naoConsolidados: imoveis.filter((i) => i.consolidacao === "nao_consolidado").length,
          comDetentor,
          municipiosPendentesSncr: municipiosPendentes.length,
          observacao: "O CCIR (certificado) é emitido por imóvel no SNCR/INCRA. Os dados acima consolidam as fontes públicas (SIGEF, SNCR e CAR) para os imóveis identificados sobre o processo.",
          imoveis,
        };

        try {
          await storage.mergeAssetCampos(assetId, {
            ccirImoveis,
            ccirImoveisUpdatedAt: ccirImoveis.consultadoEm,
            // detentores eventualmente preenchidos pelo cache SNCR
            sigefParcelas: campos.sigefParcelas,
          });
        } catch (persistErr: any) {
          console.error("[CCIR-MINA] Falha ao persistir:", persistErr.message);
        }

        return res.json({ success: true, ccirImoveis });
      }

      if (asset.type !== "TERRA" && asset.type !== "AGRO") {
        return res.status(400).json({ message: "CCIR não se aplica a este tipo de ativo" });
      }

      const fontesTentadas: Array<{ fonte: string; status: string }> = [];
      let resolvedFrom = "";
      const campos = (asset.camposEspecificos as any) || {};
      let resultado: any = null;

      const cpfCnpjManual = req.body?.cpfCnpj ? String(req.body.cpfCnpj).replace(/\D/g, '') : '';

      const documentosExtraidos: string[] = [];
      if (cpfCnpjManual && cpfCnpjManual.length >= 11) {
        documentosExtraidos.push(cpfCnpjManual);
      }

      if (campos.cafProdutores && Array.isArray(campos.cafProdutores)) {
        for (const p of campos.cafProdutores) {
          const doc = (p.cpf || p.cpfCnpj || p.documento || '').replace(/\D/g, '');
          if (doc.length >= 11 && !documentosExtraidos.includes(doc)) {
            documentosExtraidos.push(doc);
          }
        }
      }

      if (campos.empresaCnpj) {
        const doc = String(campos.empresaCnpj).replace(/\D/g, '');
        if (doc.length >= 11 && !documentosExtraidos.includes(doc)) {
          documentosExtraidos.push(doc);
        }
      }

      const ownerDocFields = [
        campos.proprietarioCpf, campos.proprietarioCnpj,
        campos.cpfProprietario, campos.cnpjProprietario,
      ];
      for (const ownerDoc of ownerDocFields) {
        if (ownerDoc) {
          const doc = String(ownerDoc).replace(/\D/g, '');
          if (doc.length >= 11 && !documentosExtraidos.includes(doc)) {
            documentosExtraidos.push(doc);
          }
        }
      }

      if (campos.contatos && Array.isArray(campos.contatos)) {
        for (const c of campos.contatos) {
          const doc = (c.cpf || c.cnpj || c.cpfCnpj || c.documento || '').replace(/\D/g, '');
          if (doc.length >= 11 && !documentosExtraidos.includes(doc)) {
            documentosExtraidos.push(doc);
          }
        }
      }

      if (documentosExtraidos.length > 0) {
        console.log(`[CCIR] Documentos disponíveis para busca: ${documentosExtraidos.length} (${cpfCnpjManual ? 'inclui manual' : 'extraídos do ativo'})`);
      }

      let lat = campos.latitude != null ? parseFloat(String(campos.latitude)) : NaN;
      let lon = campos.longitude != null ? parseFloat(String(campos.longitude)) : NaN;
      let coordSource = "";

      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        coordSource = "coordenadas diretas";
        console.log(`[CCIR] Fonte: coordenadas diretas do ativo: lat=${lat}, lon=${lon}`);
      } else if (campos.carCentroidLat != null && campos.carCentroidLon != null) {
        lat = parseFloat(String(campos.carCentroidLat));
        lon = parseFloat(String(campos.carCentroidLon));
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          coordSource = "centróide CAR salvo";
          console.log(`[CCIR] Fonte: centróide CAR salvo: lat=${lat}, lon=${lon}`);
        }
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        if (campos.carGeometria) {
          try {
            const geom = typeof campos.carGeometria === 'string' ? JSON.parse(campos.carGeometria) : campos.carGeometria;
            if (geom?.coordinates) {
              const coords = geom.type === 'Point' ? geom.coordinates :
                geom.type === 'Polygon' ? geom.coordinates[0] :
                geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : null;
              if (coords) {
                const flatCoords = geom.type === 'Point' ? [coords] : coords;
                const sumLon = flatCoords.reduce((s: number, c: number[]) => s + c[0], 0);
                const sumLat = flatCoords.reduce((s: number, c: number[]) => s + c[1], 0);
                lon = sumLon / flatCoords.length;
                lat = sumLat / flatCoords.length;
                coordSource = "geometria CAR salva";
                console.log(`[CCIR] Fonte: geometria CAR salva: lat=${lat}, lon=${lon}`);
              }
            }
          } catch (e) {
            console.warn(`[CCIR] Erro ao extrair coordenadas da geometria CAR:`, e);
          }
        }
      }

      const needsSicarionResolve = !Number.isFinite(lat) || !Number.isFinite(lon);
      const carCode = needsSicarionResolve ? (asset.carCodImovel || campos.codigoCar || campos.car_cod_imovel) : null;

      if (!needsSicarionResolve) {
        console.log(`[CCIR] Coordenadas resolvidas (fonte: ${coordSource}): lat=${lat}, lon=${lon}`);
      } else if (!carCode) {
        console.log(`[CCIR] Sem coordenadas e sem código CAR disponível para o ativo ${assetId}`);
      } else {
        console.log(`[CCIR] Sem coordenadas disponíveis. Resolução via Sicarion será tentada com CAR: ${carCode}`);
      }

      const enrichmentWork = async () => {
        if (needsSicarionResolve && carCode) {
          console.log(`[CCIR] Tentando resolver coordenadas via Sicarion com código CAR: ${carCode}`);
          try {
            const sicarionData = await sicarionFetch(`/api/sicar/${encodeURIComponent(carCode)}`);
            if (sicarionData) {
              const geom = sicarionData.geometry
                || (sicarionData.type === 'FeatureCollection' && sicarionData.features?.[0]?.geometry ? sicarionData.features[0].geometry : null);

              if (geom) {
                let centroid: { lat: number; lon: number } | null = null;

                if (geom.type === 'Point' && geom.coordinates) {
                  centroid = {
                    lat: Math.round(geom.coordinates[1] * 1e6) / 1e6,
                    lon: Math.round(geom.coordinates[0] * 1e6) / 1e6,
                  };
                } else {
                  centroid = computeCentroid(geom);
                }

                if (centroid) {
                  lat = centroid.lat;
                  lon = centroid.lon;
                  coordSource = "Sicarion (código CAR)";
                  console.log(`[CCIR] Fonte: Sicarion via código CAR: lat=${lat}, lon=${lon}`);

                  const coordPatch: Record<string, any> = {
                    latitude: centroid.lat,
                    longitude: centroid.lon,
                    carCentroidLat: centroid.lat,
                    carCentroidLon: centroid.lon,
                    carGeometria: geom,
                  };
                  await storage.mergeAssetCampos(assetId, coordPatch);
                  console.log(`[CCIR] Coordenadas resolvidas via Sicarion salvas no ativo ${assetId}`);
                } else {
                  console.warn(`[CCIR] Sicarion retornou geometria mas não foi possível calcular centróide para CAR: ${carCode}`);
                }
              } else {
                console.log(`[CCIR] Sicarion não retornou geometria para código CAR: ${carCode}`);
              }
            } else {
              console.log(`[CCIR] Sicarion não retornou dados para código CAR: ${carCode}`);
            }
          } catch (e) {
            console.warn(`[CCIR] Erro ao buscar geometria via Sicarion para CAR ${carCode}:`, e);
          }
        }

        const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);

        const searchPromises: Array<Promise<{ fonte: string; resultado: any | null; erro?: string; isDocSearch: boolean }>> = [];

        if (hasCoords) {
          searchPromises.push(
            (async () => {
              console.log(`[CCIR] Tentando SIGEF API Pública por coordenadas: lat=${lat}, lon=${lon}`);
              try {
                const r = await consultarSIGEFPublicoPorCoordenadas(lat, lon);
                if (r) {
                  console.log(`[CCIR] Dados obtidos via SIGEF API Pública (coordenadas)`);
                  return { fonte: 'SIGEF (coordenadas)', resultado: r, isDocSearch: false };
                }
                return { fonte: 'SIGEF (coordenadas)', resultado: null, erro: 'Área não coberta pelo SIGEF', isDocSearch: false };
              } catch (e: any) {
                const isTimeout = e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT';
                return { fonte: 'SIGEF (coordenadas)', resultado: null, erro: isTimeout ? 'SIGEF não respondeu (timeout)' : `Erro: ${e.message}`, isDocSearch: false };
              }
            })()
          );
        }

        const docsToSearch = documentosExtraidos.slice(0, 3);
        for (const doc of docsToSearch) {
          searchPromises.push(
            (async () => {
              console.log(`[CCIR] Tentando SIGEF API Pública por documento: ${doc.substring(0, 3)}***`);
              try {
                const r = await consultarSIGEFPorDocumento(doc);
                if (r) {
                  console.log(`[CCIR] Dados obtidos via SIGEF API Pública (documento ${doc.substring(0, 3)}***)`);
                  return { fonte: `SIGEF (documento ${doc.substring(0, 3)}***)`, resultado: r, isDocSearch: true };
                }
                return { fonte: `SIGEF (documento ${doc.substring(0, 3)}***)`, resultado: null, erro: 'Nenhuma parcela encontrada para este documento', isDocSearch: true };
              } catch (e: any) {
                const isTimeout = e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT';
                return { fonte: `SIGEF (documento ${doc.substring(0, 3)}***)`, resultado: null, erro: isTimeout ? 'SIGEF não respondeu (timeout)' : `Erro: ${e.message}`, isDocSearch: true };
              }
            })()
          );
        }

        let sigefProprietariosCompletos: any[] = [];

        if (searchPromises.length > 0) {
          const results = await Promise.allSettled(searchPromises);

          let coordResult: any = null;
          let docResult: any = null;

          for (const r of results) {
            if (r.status === 'fulfilled') {
              fontesTentadas.push({ fonte: r.value.fonte, status: r.value.resultado ? 'sucesso' : (r.value.erro || 'sem dados') });
              if (r.value.resultado) {
                if (r.value.resultado.proprietarios) {
                  for (const sp of r.value.resultado.proprietarios) {
                    if (sp.nome && !sp.nome.includes('*')) {
                      sigefProprietariosCompletos.push(sp);
                    }
                  }
                }
                if (r.value.isDocSearch && !docResult) {
                  docResult = { resultado: r.value.resultado, fonte: r.value.fonte };
                } else if (!r.value.isDocSearch && !coordResult) {
                  coordResult = { resultado: r.value.resultado, fonte: r.value.fonte };
                }
              }
            } else {
              fontesTentadas.push({ fonte: 'SIGEF', status: `Erro: ${r.reason?.message || 'desconhecido'}` });
            }
          }

          if (coordResult) {
            resultado = coordResult.resultado;
            resolvedFrom = 'sigef.publico';
            if (docResult && docResult.resultado.proprietarios) {
              for (const dp of docResult.resultado.proprietarios) {
                if (dp.nome || dp.cpfCnpj) {
                  const already = resultado.proprietarios.some((p: any) => p.nome === dp.nome && p.cpfCnpj === dp.cpfCnpj);
                  if (!already) {
                    resultado.proprietarios.push(dp);
                  }
                }
              }
            }
          } else if (docResult) {
            resultado = docResult.resultado;
            resolvedFrom = 'sigef.documento';
          }
        }

        if (!resultado && hasCoords) {
          if (isSicarDisponivel()) {
            console.log(`[CCIR] Fallback: SICAR/PostGIS para coordenadas ${lat}, ${lon}`);
            try {
              resultado = await consultarCCIRViaSICAR(lat, lon, campos.cafProdutores);
              if (resultado) {
                resolvedFrom = "sicar.postgis";
                fontesTentadas.push({ fonte: 'SICAR/PostGIS', status: 'sucesso' });
                console.log(`[CCIR] Dados obtidos via SICAR/PostGIS`);
              } else {
                fontesTentadas.push({ fonte: 'SICAR/PostGIS', status: 'Nenhum imóvel encontrado nas coordenadas' });
              }
            } catch (e: any) {
              fontesTentadas.push({ fonte: 'SICAR/PostGIS', status: `Erro: ${e.message}` });
            }
          }
        }

        if (resultado && resultado.proprietarios && sigefProprietariosCompletos.length > 0) {
          const hasMaskedProps = resultado.proprietarios.some((p: any) =>
            (p.nome || '').includes('*') || (p.cpfCnpj || '').includes('*'));
          if (hasMaskedProps) {
            const merged: any[] = [];
            for (const p of resultado.proprietarios) {
              const isMasked = (p.nome || '').includes('*') || (p.cpfCnpj || '').includes('*');
              if (!isMasked) {
                merged.push(p);
                continue;
              }
              const cafNameParts = (p.nome || '').replace(/\*/g, '').split(/\s+/).filter((w: string) => w.length > 2);
              const cafDocDigits = (p.cpfCnpj || '').replace(/\D/g, '').replace(/\*/g, '');
              const match = sigefProprietariosCompletos.find((sp: any) => {
                const sigefNameParts = (sp.nome || '').split(/\s+/);
                const nameMatch = cafNameParts.some((part: string) =>
                  sigefNameParts.some((sp2: string) => sp2.toLowerCase() === part.toLowerCase()));
                const sigefDoc = (sp.cpfCnpj || '').replace(/\D/g, '');
                const docMatch = cafDocDigits.length >= 3 && sigefDoc.includes(cafDocDigits.substring(0, 3));
                return nameMatch || docMatch;
              });
              if (match) {
                merged.push({ ...match, tipo: p.tipo || match.tipo });
              } else {
                merged.push(p);
              }
            }
            for (const sp of sigefProprietariosCompletos) {
              const already = merged.some((m: any) =>
                m.nome === sp.nome || ((m.cpfCnpj || '').replace(/\D/g, '') === (sp.cpfCnpj || '').replace(/\D/g, '')));
              if (!already) merged.push(sp);
            }
            resultado.proprietarios = merged;
            console.log(`[CCIR] Proprietários SIGEF (completos) priorizados sobre CAF (mascarados). Total: ${merged.length}`);
          }
        }

        if (resultado && resultado.proprietarios && campos.cafProdutores && Array.isArray(campos.cafProdutores) && campos.cafProdutores.length > 0) {
          const cafList = campos.cafProdutores;
          const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          const allCafPeople: Array<{ nome: string; cpf: string }> = [];
          for (const caf of cafList) {
            const cafCpf = (caf.cpf || caf.cpfCnpj || caf.documento || caf.cpfMascarado || '').replace(/\D/g, '');
            if (caf.nome && cafCpf.length >= 11 && !cafCpf.includes('*')) {
              allCafPeople.push({ nome: caf.nome, cpf: cafCpf });
            }
            if (caf.membros && Array.isArray(caf.membros)) {
              for (const m of caf.membros) {
                const mCpf = (m.cpf || '').replace(/\D/g, '');
                if (m.nome && mCpf.length >= 11 && !mCpf.includes('*')) {
                  allCafPeople.push({ nome: m.nome, cpf: mCpf });
                }
              }
            }
          }

          if (allCafPeople.length > 0) {
            resultado.proprietarios = resultado.proprietarios.map((p: any) => {
              const nomeMasked = (p.nome || '').includes('*');
              const cpfMasked = (p.cpfCnpj || '').includes('*');
              if (!nomeMasked && !cpfMasked) return p;

              const maskedDoc = (p.cpfCnpj || '');
              const maskedDigitsAndStars = maskedDoc.replace(/[^0-9*]/g, '');
              const prefixDigits = (maskedDigitsAndStars.match(/^(\d+)/) || ['', ''])[1];
              const suffixDigits = (maskedDigitsAndStars.match(/(\d+)$/) || ['', ''])[1];
              const visibleDigitCount = (maskedDigitsAndStars.match(/\d/g) || []).length;
              const propNameParts = (p.nome || '').replace(/\*/g, '').split(/\s+/).filter((w: string) => w.length >= 2);
              const propNameNorm = propNameParts.map((w: string) => normalize(w));

              const scoredMatches: Array<{ caf: typeof allCafPeople[0]; score: number }> = [];

              for (const caf of allCafPeople) {
                let score = 0;

                if (cpfMasked && visibleDigitCount >= 3 && (prefixDigits.length >= 2 || suffixDigits.length >= 2)) {
                  const prefixOk = !prefixDigits || caf.cpf.startsWith(prefixDigits);
                  const suffixOk = !suffixDigits || caf.cpf.endsWith(suffixDigits);
                  if (prefixOk && suffixOk) {
                    score += visibleDigitCount >= 5 ? 10 : 6;
                  }
                }

                if (propNameNorm.length >= 1) {
                  const cafNameNorm = caf.nome.split(/\s+/).map((w: string) => normalize(w));
                  const matchCount = propNameNorm.filter((part: string) =>
                    cafNameNorm.some((cn: string) => cn === part)
                  ).length;
                  if (matchCount >= 2) score += 5;
                  else if (matchCount === 1 && score > 0) score += 3;
                }

                if (score > 0) scoredMatches.push({ caf, score });
              }

              if (scoredMatches.length === 0) return p;

              scoredMatches.sort((a, b) => b.score - a.score);
              const best = scoredMatches[0];
              const secondBest = scoredMatches[1];
              if (secondBest && secondBest.score === best.score) return p;
              if (best.score < 3) return p;

              const cpfFormatado = best.caf.cpf.length === 14
                ? best.caf.cpf.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
                : best.caf.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
              return {
                ...p,
                nome: nomeMasked ? best.caf.nome : p.nome,
                cpfCnpj: cpfMasked ? cpfFormatado : p.cpfCnpj,
              };
            });
            console.log(`[CCIR] Cruzamento CAF aplicado aos proprietários mascarados. cafPeople=${allCafPeople.length}`);
          }
        }

        if (resultado && cpfCnpjManual && resultado.proprietarios) {
          const docJaPresente = resultado.proprietarios.some((p: any) => {
            const docLimpo = (p.cpfCnpj || '').replace(/\D/g, '').replace(/\*/g, '');
            return docLimpo.length > 0 && cpfCnpjManual.includes(docLimpo);
          });
          if (!docJaPresente) {
            resultado.proprietarios.push({
              nome: '',
              cpfCnpj: cpfCnpjManual,
              tipo: 'Informado manualmente',
            });
          }
        }

        return resultado;
      };

      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          console.warn(`[CCIR] Timeout global de ${ROUTE_TIMEOUT_MS / 1000}s atingido para ativo ${assetId}`);
          resolve(null);
        }, ROUTE_TIMEOUT_MS);
      });

      const TIMED_OUT_SENTINEL = Symbol('timed_out');
      const timeoutSentinel = timeoutPromise.then(() => TIMED_OUT_SENTINEL);
      const raceResult = await Promise.race([enrichmentWork(), timeoutSentinel]);
      const didTimeout = raceResult === TIMED_OUT_SENTINEL;
      resultado = didTimeout ? null : raceResult;

      if (didTimeout) {
        fontesTentadas.push({ fonte: 'Global', status: 'Timeout — consulta excedeu o tempo limite' });
      }

      if (!resultado) {
        const sugestoes: string[] = [];
        if (documentosExtraidos.length === 0) {
          sugestoes.push('Informe o CPF/CNPJ do proprietário para busca direta');
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          sugestoes.push('Preencha as coordenadas ou código CAR do ativo');
        }
        if (didTimeout) {
          sugestoes.push('Tente novamente — o SIGEF pode estar lento');
        }

        return res.status(404).json({
          message: didTimeout
            ? "Consulta CCIR excedeu o tempo limite."
            : "Não foi possível obter dados CCIR.",
          fontesTentadas: fontesTentadas.map(f => `${f.fonte} (${f.status})`),
          sugestao: sugestoes.join('. ') || 'Verifique se o ativo possui código CAR ou coordenadas válidas.',
          autoResolveAttempted: true,
          timedOut: didTimeout,
        });
      }

      const hasSubstantiveData = resultado.denominacao || resultado.codigoIncra || resultado.nirf ||
        resultado.proprietarios.length > 0 || resultado.classificacaoFundiaria;

      if (!hasSubstantiveData) {
        return res.status(404).json({
          message: "Nenhum dado CCIR encontrado.",
          fontesTentadas: fontesTentadas.map(f => `${f.fonte} (${f.status})`),
          sugestao: documentosExtraidos.length === 0 ? 'Informe o CPF/CNPJ do proprietário' : 'Verifique as coordenadas do ativo',
        });
      }

      const ccirPatch: Record<string, any> = {
        ccirProprietarios: resultado.proprietarios,
        ccirDenominacao: resultado.denominacao,
        ccirCodigoIncra: resultado.codigoIncra,
        ccirNirf: resultado.nirf,
        ccirModulosFiscais: resultado.modulosFiscais,
        ccirClassificacao: resultado.classificacaoFundiaria,
        ccirFracaoMinima: resultado.fracaoMinimaParcelamento,
        ccirSituacao: resultado.situacaoCadastral,
        ccirDataEmissao: resultado.dataEmissao,
        ccirAreaTotalIncra: resultado.areaTotalIncra,
        ccirConsultadoEm: new Date().toISOString(),
        ccirRawData: resultado.rawData,
      };

      await storage.mergeAssetCampos(assetId, ccirPatch);

      res.json({ success: true, ccir: ccirPatch, resolvedFrom, fontesTentadas: fontesTentadas.map(f => `${f.fonte} (${f.status})`) });
    } catch (error: any) {
      console.error("[CCIR] Erro:", error);
      res.status(500).json(payloadFalhaConsulta({
        fonte: "CCIR — consolidação fundiária (SIGEF + SNCR + CAR)",
        tierFonte: "T1",
        motivoFalha: error.message || "Erro ao consultar CCIR",
      }));
    }
  });

  app.post("/api/assets/:id/enriquecer-tudo", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const assetId = asset.id;
      const isTerraAgro = ["TERRA", "AGRO"].includes(asset.type);
      const isMinerario = isTipoMinerario(asset.type);
      const port = parseInt(process.env.PORT || "5000", 10);
      const baseUrl = `http://127.0.0.1:${port}`;
      const cookie = req.headers.cookie || "";

      type StepResult = { id: string; label: string; status: "success" | "error"; error?: string };
      const results: StepResult[] = [];

      // Executa uma rota interna preservando, em falha, o motivo específico
      // (mensagem do corpo JSON da resposta, timeout ou falha de rede) para
      // que o resumo do enriquecimento mostre algo acionável.
      type CallResult = { ok: boolean; error?: string };
      const resumirErro = (msg: string) => (msg.length > 220 ? `${msg.slice(0, 217)}…` : msg);
      const callInternal = async (method: string, path: string, body?: any): Promise<CallResult> => {
        try {
          const resp = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { "Content-Type": "application/json", "Cookie": cookie },
            body: method === "GET" ? undefined : JSON.stringify(body || {}),
            signal: AbortSignal.timeout(120000),
          });
          if (resp.ok) return { ok: true };
          let motivo = "";
          try {
            const data: any = await resp.json();
            if (typeof data?.message === "string") motivo = data.message.trim();
          } catch { /* corpo não-JSON */ }
          return { ok: false, error: resumirErro(motivo || `serviço respondeu HTTP ${resp.status}`) };
        } catch (e: any) {
          if (e?.name === "TimeoutError" || e?.name === "AbortError") {
            return { ok: false, error: "tempo esgotado (120s) — o serviço demorou para responder" };
          }
          return { ok: false, error: resumirErro(`falha de rede interna: ${e?.message || e}`) };
        }
      };
      const stepResult = (id: string, label: string, r: CallResult, fallback: string): StepResult =>
        r.ok ? { id, label, status: "success" } : { id, label, status: "error", error: r.error || fallback };

      const saveProgress = async (stepResults: StepResult[]) => {
        try {
          await storage.mergeAssetCampos(assetId, {
            enrichmentAllProgress: {
              steps: stepResults,
              updatedAt: new Date().toISOString(),
              running: true,
            },
          });
        } catch {}
      };

      const allStepDefs = isTerraAgro
        ? [
            { id: "sicar", label: "Geo & CAR" },
            { id: "embrapa_ambiental", label: "Embrapa + Ambiental" },
            { id: "ccir", label: "CCIR / INCRA" },
            { id: "deepintel", label: "Deep Intelligence" },
          ]
        : isMinerario
        ? [
            { id: "sigef_parcelas", label: "Parcelas SIGEF" },
            { id: "car_imoveis", label: "Imóveis CAR" },
            { id: "ccir", label: "CCIR / INCRA" },
            { id: "deepintel", label: "Deep Intelligence" },
          ]
        : [
            { id: "deepintel", label: "Deep Intelligence" },
          ];

      try {
        await storage.mergeAssetCampos(assetId, {
          enrichmentAllProgress: {
            steps: allStepDefs.map((s, i) => ({ ...s, status: i === 0 ? "running" : "pending" })),
            updatedAt: new Date().toISOString(),
            running: true,
          },
        });
      } catch {}

      if (isTerraAgro) {
        const sicar = await callInternal("POST", `/api/assets/${assetId}/enriquecer-sicar`);
        results.push(stepResult("sicar", "Geo & CAR", sicar, "Falha na consulta SICAR"));
        await saveProgress(results);

        const [embrapaRes, completoRes, ambientalRes] = await Promise.allSettled([
          callInternal("POST", `/api/assets/${assetId}/enriquecer-embrapa`, { force: true }),
          callInternal("POST", `/api/assets/${assetId}/enriquecer-completo`),
          callInternal("GET", `/api/assets/${assetId}/ambiental`),
        ]);
        const settle = (r: PromiseSettledResult<CallResult>): CallResult =>
          r.status === "fulfilled" ? r.value : { ok: false, error: "erro interno" };
        const partes = [
          { nome: "Embrapa", r: settle(embrapaRes) },
          { nome: "IBAMA/MapBiomas/NDVI", r: settle(completoRes) },
          { nome: "Ambiental", r: settle(ambientalRes) },
        ];
        const falhas = partes.filter((p) => !p.r.ok);
        const detalheFalhas = falhas.map((p) => `${p.nome}: ${p.r.error || "falha"}`).join("; ");
        if (falhas.length === 0) {
          results.push({ id: "embrapa_ambiental", label: "Embrapa + Ambiental", status: "success" });
        } else if (falhas.length === partes.length) {
          results.push({ id: "embrapa_ambiental", label: "Embrapa + Ambiental", status: "error", error: resumirErro(`Todas as consultas falharam — ${detalheFalhas}`) });
        } else {
          results.push({ id: "embrapa_ambiental", label: "Embrapa + Ambiental", status: "success", error: resumirErro(`Parcial — ${detalheFalhas}`) });
        }
        await saveProgress(results);

        const ccir = await callInternal("POST", `/api/enrichment/ccir/${assetId}`);
        results.push(stepResult("ccir", "CCIR / INCRA", ccir, "Falha na consulta CCIR"));
        await saveProgress(results);
      }

      if (isMinerario) {
        // Base fundiária em cadeia: SIGEF → CAR → CCIR (a CCIR consome os dois primeiros).
        // Cada etapa tolera falha individual e é reportada no resumo com o motivo real.
        const sigef = await callInternal("POST", `/api/assets/${assetId}/sigef-parcelas`);
        results.push(stepResult("sigef_parcelas", "Parcelas SIGEF", sigef, "Falha na consulta de parcelas SIGEF"));
        await saveProgress(results);

        // A rota de CAR re-tenta o SICAR internamente e deriva a UF das
        // parcelas SIGEF recém-salvas quando o cadastro não tem estado.
        const car = await callInternal("POST", `/api/assets/${assetId}/car-imoveis`);
        results.push(stepResult("car_imoveis", "Imóveis CAR", car, "Falha na consulta de imóveis CAR"));
        await saveProgress(results);

        const ccirMina = await callInternal("POST", `/api/enrichment/ccir/${assetId}`);
        results.push(stepResult("ccir", "CCIR / INCRA", ccirMina, "Falha na consolidação CCIR"));
        await saveProgress(results);
      }

      const di = await callInternal("POST", `/api/ai/deep-intel/${assetId}`);
      results.push(stepResult("deepintel", "Deep Intelligence", di, "Falha na análise inteligente"));

      await storage.mergeAssetCampos(assetId, {
        enrichmentAllProgress: {
          steps: results,
          updatedAt: new Date().toISOString(),
          running: false,
          completedAt: new Date().toISOString(),
        },
      });

      const errorCount = results.filter(r => r.status === "error").length;
      res.json({
        success: errorCount === 0,
        partial: errorCount > 0 && errorCount < results.length,
        steps: results,
        errorCount,
        totalSteps: results.length,
      });
    } catch (error: any) {
      console.error("[Enriquecer-Tudo] Erro:", error);
      res.status(500).json({ message: error.message || "Erro no enriquecimento completo" });
    }
  });

  // ── Backfill de sobreposição em hectares (admin) ─────────────────────────
  // Ativos MINA/JAZIDA consultados antes da padronização "X ha (Y%)" têm
  // sigefParcelas/carImoveis/ccirImoveis persistidos SEM sobreposicaoHa (por
  // decisão de design nunca inventamos "0 ha"). Esta rotina reexecuta a
  // consulta SIGEF/CAR + consolidação para esses ativos e grava via merge
  // atômico apenas as chaves alteradas.
  type BackfillErro = { assetId: number; nome: string | null; erro: string };
  let backfillSobreposicao: {
    running: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    total: number;
    processados: number;
    atualizados: number;
    erros: BackfillErro[];
  } = { running: false, startedAt: null, finishedAt: null, total: 0, processados: 0, atualizados: 0, erros: [] };

  const faltaHa = (itens: any[] | undefined | null): boolean =>
    Array.isArray(itens) && itens.length > 0 && itens.some((x: any) => x && x.sobreposicaoHa == null);

  function precisaBackfillSobreposicao(campos: any): boolean {
    return (
      faltaHa(campos?.sigefParcelas?.parcelas) ||
      faltaHa(campos?.carImoveis?.imoveis) ||
      faltaHa(campos?.ccirImoveis?.imoveis)
    );
  }

  // Reprocessa um ativo: reconsulta SIGEF e/ou CAR (só as fontes já persistidas)
  // e reconsolida a base fundiária, gravando apenas as chaves alteradas.
  async function backfillSobreposicaoAtivo(asset: any): Promise<boolean> {
    const assetId = asset.id as number;
    const campos = (asset.camposEspecificos as any) || {};
    const temSigef = Array.isArray(campos.sigefParcelas?.parcelas) && campos.sigefParcelas.parcelas.length > 0;
    const temCar = Array.isArray(campos.carImoveis?.imoveis) && campos.carImoveis.imoveis.length > 0;
    const temCcir = Array.isArray(campos.ccirImoveis?.imoveis) && campos.ccirImoveis.imoveis.length > 0;

    const geometry = await resolveProcessoGeometry(assetId, asset.orgId, asset);
    if (!geometry) throw new Error("geometria do processo indisponível");

    const patch: Record<string, any> = {};
    let sigefAtual = campos.sigefParcelas;
    let carAtual = campos.carImoveis;
    let sigefGeometrias: any[] = [];
    let carGeometrias: any[] = [];

    if (temSigef) {
      const { consultarParcelasSigef } = await import("../lib/sigef-parcelas");
      const resultado = await consultarParcelasSigef(geometry);
      if (!resultado.disponivel) throw new Error(resultado.erro || "serviço SIGEF indisponível");
      const { geometrias, ...resultadoSemGeometrias } = resultado;
      sigefGeometrias = geometrias || [];
      sigefAtual = resultadoSemGeometrias;
      const updatedAt = new Date().toISOString();
      patch.sigefParcelas = resultadoSemGeometrias;
      patch.sigefParcelasUpdatedAt = updatedAt;
      // preenche o cache de geometrias (mesma chave das rotas .../geometrias)
      try {
        const porCodigo = new Map(resultado.parcelas.filter((p) => p.codigoParcela).map((p) => [p.codigoParcela, p]));
        const parcelasCache = sigefGeometrias
          .filter((g: any) => g.codigoParcela && porCodigo.has(g.codigoParcela))
          .map((g: any) => {
            const p = porCodigo.get(g.codigoParcela)!;
            return {
              codigoParcela: g.codigoParcela,
              nomeArea: p.nomeArea ?? null,
              detentor: p.detentor ?? null,
              areaHa: p.areaHa ?? null,
              sobreposicaoHa: p.sobreposicaoHa ?? null,
              relacao: p.relacao,
              geometry: g.geometry,
            };
          });
        await setCached("sigef_geometrias", `${assetId}:${updatedAt}`, { parcelas: parcelasCache });
      } catch { /* cache é opcional */ }
    }

    if (temCar) {
      const ufs = resolveAssetUfs({ ...asset, camposEspecificos: { ...campos, sigefParcelas: sigefAtual } });
      if (ufs.length === 0) throw new Error("UF do ativo desconhecida — não foi possível reconsultar o CAR");
      const { consultarImoveisCar } = await import("../lib/car-imoveis");
      const resultado = await consultarImoveisCar(geometry, ufs);
      if (!resultado.disponivel) throw new Error(resultado.erro || "GeoServer do SICAR indisponível");
      const { geometrias, ...resultadoSemGeometrias } = resultado;
      carGeometrias = geometrias || [];
      carAtual = resultadoSemGeometrias;
      const updatedAt = new Date().toISOString();
      patch.carImoveis = resultadoSemGeometrias;
      patch.carImoveisUpdatedAt = updatedAt;
      try {
        const porCodigo = new Map(resultado.imoveis.filter((i) => i.codImovel).map((i) => [i.codImovel, i]));
        const imoveisCache = carGeometrias
          .filter((g: any) => g.codImovel && porCodigo.has(g.codImovel))
          .map((g: any) => {
            const i = porCodigo.get(g.codImovel)!;
            return {
              codImovel: g.codImovel,
              municipio: i.municipio ?? null,
              areaHa: i.areaHa ?? null,
              sobreposicaoHa: i.sobreposicaoHa ?? null,
              sobreposicaoPct: i.sobreposicaoPct ?? null,
              status: i.status ?? null,
              relacao: i.relacao,
              geometry: g.geometry,
            };
          });
        await setCached("car_geometrias", `${assetId}:${updatedAt}`, { imoveis: imoveisCache });
      } catch { /* cache é opcional */ }
    }

    // Reconsolida a base fundiária (ccirImoveis) quando ela já existia
    if (temCcir || (temSigef && temCar)) {
      const parcelasSobrepostas: any[] = (sigefAtual?.parcelas || []).filter((p: any) => p.relacao === "sobreposta");
      const carSobrepostos: any[] = (carAtual?.imoveis || []).filter((i: any) => i.relacao === "sobreposto");
      if (parcelasSobrepostas.length > 0 || carSobrepostos.length > 0) {
        let estadoSncr: "registro_existente" | "consultada_sem_registro" | "nao_consultada" = "consultada_sem_registro";
        let motivoEstadoSncr: string | null = null;
        try {
          const { preencherDetentoresDoCacheSncr } = await import("../lib/sncr-detentores");
          await preencherDetentoresDoCacheSncr(parcelasSobrepostas);
        } catch (sncrErr: any) {
          estadoSncr = "nao_consultada";
          motivoEstadoSncr = `cache SNCR indisponível: ${sncrErr?.message || String(sncrErr)}`;
        }

        let parcelaParaCar = new Map<string, string>();
        let casamentoInfo: { abaixoLimiar: Map<string, { codImovel: string; fracaoPct: number }>; limiarPct: number } | undefined;
        let casamentoRealizado = false;
        let casamentoIndisponivelMotivo: string | null = null;
        try {
          const { casarParcelasSigefComCar } = await import("../lib/car-imoveis");
          const casamento = await casarParcelasSigefComCar(
            geometry,
            resolveAssetUfs({ ...asset, camposEspecificos: { ...campos, sigefParcelas: sigefAtual, carImoveis: carAtual } }),
            parcelasSobrepostas.map((p: any) => p.codigoParcela).filter(Boolean),
            carSobrepostos.map((i: any) => i.codImovel).filter(Boolean),
            // reutiliza as geometrias das consultas recém-feitas — sem nova ida à rede
            { parcelas: sigefGeometrias as any, imoveis: carGeometrias as any },
          );
          parcelaParaCar = casamento.casados;
          casamentoInfo = { abaixoLimiar: casamento.abaixoLimiar, limiarPct: casamento.limiarPct };
          casamentoRealizado = true;
        } catch (matchErr: any) {
          console.warn(`[Backfill-Sobreposicao] Casamento SIGEF×CAR indisponível (ativo ${assetId}):`, matchErr.message);
          casamentoIndisponivelMotivo = `casamento SIGEF×CAR indisponível: ${matchErr?.message || String(matchErr)} — fontes exibidas separadamente`;
        }

        const { consolidarImoveisFundiarios } = await import("../lib/ccir-fusao");
        const imoveis = consolidarImoveisFundiarios(parcelasSobrepostas, carSobrepostos, parcelaParaCar, casamentoInfo);
        const comDetentor = imoveis.filter((i) => i.detentores.length > 0).length;
        if (estadoSncr !== "nao_consultada") {
          estadoSncr = comDetentor > 0 ? "registro_existente" : "consultada_sem_registro";
        }
        const ccirImoveis: any = {
          disponivel: true,
          consultadoEm: new Date().toISOString(),
          fonte: "SIGEF/INCRA (espelho ArcGIS) + SNCR (detentores) + SICAR (CAR)",
          // contrato de três estados no nível do módulo consolidado
          estadoConsulta: imoveis.length > 0 ? "registro_existente" : "consultada_sem_registro",
          situacaoRegistro: imoveis.length > 0 ? "indeterminada" : null,
          tierFonte: "T1",
          janelaCobertura: [sigefAtual?.janelaCobertura, carAtual?.janelaCobertura].filter(Boolean).join(" + ")
            || "bases SIGEF/SNCR/CAR conforme as consultas de origem persistidas no ativo",
          identificadorVinculo: { tipo: "geometria", valor: "imóveis sobrepostos ao polígono do processo ANM", proveniencia: "documento_oficial", origem: "SIGMINE + consultas SIGEF/CAR do ativo" },
          // disponibilidade explícita das etapas de enriquecimento
          estadoSncr,
          motivoEstadoSncr,
          casamentoRealizado,
          casamentoIndisponivelMotivo,
          totalImoveis: imoveis.length,
          comCodigoIncra: imoveis.filter((i) => i.codigoIncra).length,
          fundidosSigefCar: imoveis.filter((i) => i.origem === "SIGEF+CAR").length,
          naoConsolidados: imoveis.filter((i) => i.consolidacao === "nao_consolidado").length,
          comDetentor,
          observacao: "O CCIR (certificado) é emitido por imóvel no SNCR/INCRA. Os dados acima consolidam as fontes públicas (SIGEF, SNCR e CAR) para os imóveis identificados sobre o processo.",
          imoveis,
        };
        patch.ccirImoveis = ccirImoveis;
        patch.ccirImoveisUpdatedAt = ccirImoveis.consultadoEm;
      }
    }

    if (Object.keys(patch).length === 0) return false;
    await storage.mergeAssetCampos(assetId, patch);
    return true;
  }

  async function executarBackfillSobreposicao(candidatos: any[]) {
    for (const asset of candidatos) {
      try {
        const ok = await backfillSobreposicaoAtivo(asset);
        if (ok) backfillSobreposicao.atualizados++;
      } catch (e: any) {
        backfillSobreposicao.erros.push({ assetId: asset.id, nome: asset.name ?? null, erro: e?.message || String(e) });
        console.error(`[Backfill-Sobreposicao] Ativo ${asset.id} falhou:`, e?.message || e);
      } finally {
        backfillSobreposicao.processados++;
      }
      // respeita o rate limit das fontes públicas (SIGEF ArcGIS / SICAR GeoServer)
      await new Promise((r) => setTimeout(r, 3000));
    }
    backfillSobreposicao.running = false;
    backfillSobreposicao.finishedAt = new Date().toISOString();
    console.log(`[Backfill-Sobreposicao] Concluído: ${backfillSobreposicao.atualizados}/${backfillSobreposicao.total} atualizados, ${backfillSobreposicao.erros.length} erros`);
  }

  app.post("/api/admin/backfill-sobreposicao", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (user?.role !== "admin" && user?.role !== "superadmin") {
      return res.status(403).json({ message: "Acesso restrito a administradores" });
    }
    if (backfillSobreposicao.running) {
      return res.status(409).json({ message: "Backfill de sobreposição já em andamento", status: backfillSobreposicao });
    }
    try {
      const todos = await storage.getAssets();
      const candidatos = todos.filter(
        (a: any) => isTipoMinerario(a.type) && precisaBackfillSobreposicao(a.camposEspecificos as any)
      );
      if (req.query.dryRun === "1" || req.query.dryRun === "true") {
        return res.json({
          dryRun: true,
          candidatos: candidatos.map((a: any) => ({ id: a.id, nome: a.name ?? null })),
          total: candidatos.length,
        });
      }
      backfillSobreposicao = {
        running: candidatos.length > 0,
        startedAt: new Date().toISOString(),
        finishedAt: candidatos.length === 0 ? new Date().toISOString() : null,
        total: candidatos.length,
        processados: 0,
        atualizados: 0,
        erros: [],
      };
      if (candidatos.length > 0) {
        // roda em background, sequencial (respeitando as fontes) — acompanhar via GET .../status
        executarBackfillSobreposicao(candidatos).catch((e) => {
          console.error("[Backfill-Sobreposicao] Erro fatal:", e?.message || e);
          backfillSobreposicao.running = false;
          backfillSobreposicao.finishedAt = new Date().toISOString();
        });
      }
      res.json({
        message: candidatos.length > 0
          ? `Backfill iniciado em background para ${candidatos.length} ativo(s). Acompanhe em GET /api/admin/backfill-sobreposicao/status`
          : "Nenhum ativo precisa de backfill — todos já têm sobreposição em hectares",
        total: candidatos.length,
      });
    } catch (e: any) {
      console.error("[Backfill-Sobreposicao] Erro ao iniciar:", e?.message || e);
      res.status(500).json({ message: "Erro ao iniciar o backfill de sobreposição" });
    }
  });

  app.get("/api/admin/backfill-sobreposicao/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (user?.role !== "admin" && user?.role !== "superadmin") {
      return res.status(403).json({ message: "Acesso restrito a administradores" });
    }
    res.json(backfillSobreposicao);
  });
}
