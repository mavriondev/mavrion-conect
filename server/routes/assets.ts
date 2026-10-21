import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions, type CamposEspecificos } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import { matchesRegion } from "./matching";
import { getOrgId } from "../lib/tenant";
import { runMatchingForAsset } from "../lib/auto-match";
import { enriquecerFazenda, consultarNDVIGrid, consultarCCIR, consultarCCIRViaSICAR, consultarParcelaSIGEFPorCoordenadas } from "../enrichment/agro";
import { sql } from "drizzle-orm";
import { consultarEmbargoIbama, consultarEmbargoIbamaCoordenadas, consultarEmbargoIbamaMunicipio } from "../lib/ibama";
import { getUsoTerraMapBiomas } from "../lib/mapbiomas";
import { consultarDeterINPE } from "../lib/deter-inpe";
import { getNDVISentinel } from "../lib/sentinel";
import { getProducaoMunicipio } from "../lib/contexto-regional";
import { consultarApiPaginadaPublica, calcularPerfilNorion } from "../services/caf-crawler";
import { getCached, setCached } from "../cache";

const MAVRION_API_URL = "https://api.mavrionconnect.com.br";
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
  app.get(api.matching.assets.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    const assetsList = await storage.getAssets(user?.orgId);
    res.json(assetsList);
  });

  app.post(api.matching.assets.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const input = api.matching.assets.create.input.parse(req.body);
      if (input.priceAsking !== undefined && input.priceAsking !== null && input.priceAsking < 0) {
        return res.status(400).json({ message: "Preço não pode ser negativo" });
      }
      const novoAtivo = await storage.createAsset(input);

      setImmediate(() => {
        runMatchingForAsset(novoAtivo.id, novoAtivo.orgId, storage, db).catch(err =>
          console.error(`[Auto-match] Falha para ativo ${novoAtivo.id}:`, err.message)
        );
      });

      res.status(201).json(novoAtivo);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.get("/api/matching/assets/geo/terra", async (req, res) => {
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

  app.get("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      const allDeals = await storage.getDeals?.() ?? [];
      const linkedDeals = allDeals.filter((d: any) =>
        d.assetId === asset.id ||
        d.title?.toLowerCase().includes((asset.title || "").toLowerCase().slice(0, 15))
      ).map((d: any) => ({
        id: d.id,
        title: d.title,
        stageId: d.stageId,
        stageName: d.stage?.name || null,
        amountEstimate: d.amountEstimate,
        pipelineType: d.pipelineType,
        createdAt: d.createdAt,
      }));

      const emNegociacao = linkedDeals.length > 0;

      res.json({ ...asset, linkedDeals, emNegociacao });
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get("/api/matching/assets/:id/geometry", async (req, res) => {
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

      if (row?.type === "MINA" && row?.anm_processo) {
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
              const geometry = { type: "Polygon", coordinates };

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
                const camposAtual = (await db.execute(sql`SELECT campos_especificos, municipio FROM assets WHERE id = ${assetId}`)) as any;
                const existingRow = camposAtual.rows?.[0];
                const campos = existingRow?.campos_especificos || {};
                const newCampos = { ...campos, latitude: centLat, longitude: centLng, codigoIbge, municipio: municipioNome };

                if (!existingRow?.municipio && municipioNome) {
                  await db.execute(
                    sql`UPDATE assets SET municipio = ${municipioNome}, campos_especificos = ${JSON.stringify(newCampos)}::jsonb WHERE id = ${assetId}`
                  );
                } else {
                  await db.execute(
                    sql`UPDATE assets SET campos_especificos = ${JSON.stringify(newCampos)}::jsonb WHERE id = ${assetId}`
                  );
                }
              } catch (updateErr) {
                console.warn("Failed to update asset campos/municipio:", updateErr);
              }

              return res.json({ geometry, municipio: municipioNome, codigoIbge });
            }
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
                const camposAtual = (await db.execute(sql`SELECT campos_especificos FROM assets WHERE id = ${assetId}`)) as any;
                const campos = camposAtual.rows?.[0]?.campos_especificos || {};
                const newCampos = {
                  ...campos,
                  ...(centroid ? { latitude: centroid.lat, longitude: centroid.lon } : {}),
                  codigoIbge: String(sicarionData.cod_municipio_ibge || sicarionData.properties?.cod_municipio_ibge || campos.codigoIbge || ""),
                  sicarStatus: sicarionData.ind_status || sicarionData.properties?.status_imovel,
                  sicarCondicao: sicarionData.condicao || sicarionData.properties?.condicao,
                  sicarTipo: sicarionData.ind_tipo || sicarionData.properties?.tipo_imovel,
                  sicarModuloFiscal: sicarionData.m_fiscal || sicarionData.properties?.m_fiscal,
                  sicarDataCriacao: sicarionData.dat_criacao || sicarionData.properties?.dat_criacao,
                  sicarDataAtualizacao: sicarionData.data_atualizacao || sicarionData.properties?.data_atualizacao,
                  sicarFonte: "SICARIOn API",
                  sicarConsultadoEm: new Date().toISOString(),
                };
                await db.execute(sql`UPDATE assets SET campos_especificos = ${JSON.stringify(newCampos)}::jsonb WHERE id = ${assetId}`);
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

  app.patch("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      const novoLog: any[] = [];
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
    FII_CRI: ["tipoFundo", "rentabilidadeAnual", "vacanciaMedia", "qtdImoveis", "segmentoImoveis", "dividendYield", "situacaoDocumental", "observacoesQualitativas"],
  };

  app.patch("/api/matching/assets/:id/enrichment", async (req, res) => {
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

      setImmediate(() => {
        runMatchingForAsset(updated.id, updated.orgId, storage, db).catch(err =>
          console.error(`[Auto-match enrich] Falha para ativo ${updated.id}:`, err.message)
        );
      });

      res.json({ ...updated, enrichmentProgress: progress });
    } catch (err: any) {
      console.error("[Enrichment PATCH]", err.message);
      res.status(500).json({ message: "Erro ao salvar enriquecimento" });
    }
  });

  app.get("/api/matching/assets/:id/enrichment-fields", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const type = String(req.query.type || "NEGOCIO");
    res.json({ fields: ENRICHMENT_FIELDS[type] || ENRICHMENT_FIELDS["NEGOCIO"] });
  });

  app.delete("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });
      await storage.deleteAsset(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/matching/assets/:id/enriquecer-sicar", async (req, res) => {
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
          status: sicarEnriched.sicarStatus,
          condicao: sicarEnriched.sicarCondicao,
          tipo: sicarEnriched.sicarTipo,
          moduloFiscal: sicarEnriched.sicarModuloFiscal,
          area: sicarEnriched.sicarArea,
          municipio: sicarEnriched.sicarMunicipio,
          uf: sicarEnriched.sicarUf,
          dataCriacao: sicarEnriched.sicarDataCriacao,
          dataAtualizacao: sicarEnriched.sicarDataAtualizacao,
          codigoIbge: sicarEnriched.codigoIbge,
          temGeometria: !!geometry,
          fonte: "SICARIOn API",
          consultadoEm: sicarEnriched.sicarConsultadoEm,
        },
      });
    } catch (err) {
      console.error("[enriquecer-sicar] Erro:", (err as Error).message);
      res.status(500).json({ message: "Erro ao consultar SICAR" });
    }
  });

  app.post("/api/matching/assets/:id/enriquecer-embrapa", async (req, res) => {
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
          fonte: 'SoilGrids/ISRIC',
        };
      }

      if (resultado.zarc.length > 0) {
        embrapaCompat.zoneamento = {
          culturas: resultado.zarc.map(z => ({
            nome: z.cultura,
            risco: z.aptidao === 'Apto' ? 'baixo' : z.aptidao === 'Inapto' ? 'alto' : 'medio',
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
      } else if (resultado.solo?.phh2o !== null || resultado.solo?.clay !== null) {
        const ndviEstimado = Math.min(1, Math.max(0,
          0.5 + (resultado.solo?.soc ? resultado.solo.soc / 100 : 0) + (resultado.solo?.clay ? (resultado.solo.clay > 15 && resultado.solo.clay < 60 ? 0.1 : -0.05) : 0)
        ));
        embrapaCompat.ndvi = {
          ndvi: parseFloat(ndviEstimado.toFixed(2)),
          classificacao: ndviEstimado >= 0.7 ? 'Vegetação densa e saudável' : ndviEstimado >= 0.4 ? 'Vegetação moderada' : 'Vegetação escassa',
          fonte: 'Estimado (SoilGrids)',
        };
      }

      if (resultado.clima) {
        const tempMedia = resultado.clima.temperaturaMinMedia && resultado.clima.temperaturaMaxMedia
          ? parseFloat(((resultado.clima.temperaturaMinMedia + resultado.clima.temperaturaMaxMedia) / 2).toFixed(1))
          : 0;
        embrapaCompat.clima = {
          precipitacaoMedia: resultado.clima.precipitacaoMedia,
          temperaturaMedia: tempMedia,
          temperaturaMax: resultado.clima.temperaturaMaxMedia,
          temperaturaMin: resultado.clima.temperaturaMinMedia,
          indiceSeca: resultado.resumo || '',
          fonte: resultado.clima.fonte,
        };
      } else {
        embrapaCompat.clima = {
          precipitacaoMedia: 0,
          temperaturaMedia: 0,
          indiceSeca: resultado.resumo || '',
        };
      }

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

  app.post("/api/matching/assets/:id/ndvi-grid", async (req, res) => {
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

  app.post("/api/matching/assets/:id/enriquecer-completo", async (req, res) => {
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
  });

  app.get("/api/matching/assets/:id/ambiental", async (req, res) => {
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
            "Distrito Federal": "DF" }[ufName] || "";
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

  app.post("/api/matching/assets/:id/contexto-regional", async (req, res) => {
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

  app.post("/api/matching/assets/:id/enriquecer-caf", async (req, res) => {
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
        return res.status(502).json({ message: "API do CAF indisponível no momento" });
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
        return { ...lead, perfil: calcularPerfilNorion(lead) };
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

  app.post("/api/enrichment/ccir/:assetId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });

    try {
      const user = req.user as any;
      const assetId = Number(req.params.assetId);
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.orgId !== user?.orgId) {
        return res.status(404).json({ message: "Ativo não encontrado" });
      }

      let cpfCnpj = req.body?.cpfCnpj as string | undefined;
      let resolvedFrom = "manual";
      const campos = (asset.camposEspecificos as any) || {};

      if (!cpfCnpj || typeof cpfCnpj !== "string" || cpfCnpj.replace(/\D/g, "").length < 11) {
        if (campos.cnpj && typeof campos.cnpj === "string" && campos.cnpj.replace(/\D/g, "").length >= 11) {
          cpfCnpj = campos.cnpj;
          resolvedFrom = "camposEspecificos.cnpj";
          console.log(`[CCIR] Auto-resolved document from camposEspecificos.cnpj`);
        }

        if (!cpfCnpj && asset.linkedCompanyId) {
          const company = await storage.getCompany(asset.linkedCompanyId);
          if (company?.cnpj && company.cnpj.replace(/\D/g, "").length >= 11) {
            cpfCnpj = company.cnpj;
            resolvedFrom = "linkedCompany.cnpj";
            console.log(`[CCIR] Auto-resolved document from linked company (id=${asset.linkedCompanyId})`);
          }
        }

        if (!cpfCnpj && campos.latitude && campos.longitude) {
          console.log(`[CCIR] Attempting SIGEF coordinate-based resolution`);
          const sigefDoc = await consultarParcelaSIGEFPorCoordenadas(campos.latitude, campos.longitude);
          if (sigefDoc && sigefDoc.replace(/\D/g, "").length >= 11) {
            cpfCnpj = sigefDoc;
            resolvedFrom = "sigef.coordenadas";
            console.log(`[CCIR] Auto-resolved document from SIGEF coordinates`);
          }
        }
      }

      let resultado: any = null;

      if (cpfCnpj) {
        resultado = await consultarCCIR(cpfCnpj);
      }

      if (!resultado && campos.latitude && campos.longitude) {
        console.log(`[CCIR] Trying SICAR/PostGIS local lookup for coordinates ${campos.latitude}, ${campos.longitude}`);
        resultado = await consultarCCIRViaSICAR(
          parseFloat(campos.latitude),
          parseFloat(campos.longitude),
          campos.cafProdutores
        );
        if (resultado) {
          resolvedFrom = "sicar.postgis";
        }
      }

      if (!resultado) {
        if (!cpfCnpj) {
          return res.status(400).json({
            message: "Não foi possível determinar o CPF/CNPJ automaticamente. Informe manualmente.",
            autoResolveAttempted: true,
          });
        }
        return res.status(502).json({ message: "Não foi possível consultar o CCIR." });
      }

      const hasSubstantiveData = resultado.denominacao || resultado.codigoIncra || resultado.nirf ||
        resultado.proprietarios.length > 0 || resultado.classificacaoFundiaria;

      if (!hasSubstantiveData) {
        return res.status(404).json({ message: "Nenhum dado CCIR encontrado." });
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

      res.json({ success: true, ccir: ccirPatch, resolvedFrom });
    } catch (error: any) {
      console.error("[CCIR] Erro:", error);
      res.status(500).json({ message: error.message || "Erro ao consultar CCIR" });
    }
  });
}
