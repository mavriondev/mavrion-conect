import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import { matchesRegion } from "./matching";
import { enriquecerFazenda, consultarNDVIGrid } from "../enrichment/agro";
import { sql } from "drizzle-orm";
import { consultarEmbargoIbama, consultarEmbargoIbamaCoordenadas } from "../lib/ibama";
import { getUsoTerraMapBiomas } from "../lib/mapbiomas";
import { getNDVISentinel } from "../lib/sentinel";

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

      const camposEsp = (novoAtivo.camposEspecificos as any) || {};
      if (camposEsp.origemAtivo === "oferta_recebida" || camposEsp.origemAtivo === "indicacao") {
        setImmediate(async () => {
          try {
            const allInvestors = await storage.getInvestors();
            let autoMatches = 0;
            for (const investor of allInvestors) {
              const tipos = (investor.assetTypes as string[]) || [];
              const regioes = (investor.regionsOfInterest as string[]) || [];
              const tipoOk = tipos.length === 0 || tipos.includes(novoAtivo.type);
              const regiaoOk = matchesRegion(novoAtivo.location || novoAtivo.estado, regioes);
              if (tipoOk && regiaoOk) {
                const [existing] = await db.select().from(matchSuggestions).where(
                  and(
                    eq(matchSuggestions.assetId, novoAtivo.id),
                    eq(matchSuggestions.investorProfileId, investor.id)
                  )
                );
                if (!existing) {
                  await db.insert(matchSuggestions).values({
                    orgId: novoAtivo.orgId,
                    assetId: novoAtivo.id,
                    investorProfileId: investor.id,
                    score: 60,
                    reasonsJson: { reasons: ["Ativo recebido por oferta — match prioritário"], penalties: [], origem: "oferta_automatica" },
                    status: "new",
                  });
                  autoMatches++;
                }
              }
            }
            if (autoMatches > 0) {
              sendNotification({
                id: notifId(),
                type: "new_match",
                orgId: novoAtivo.orgId,
                title: "Novo ativo por oferta",
                message: `"${novoAtivo.title}" foi cadastrado e ${autoMatches} match(es) gerados automaticamente`,
                link: `/ativos/${novoAtivo.id}`,
                createdAt: new Date().toISOString(),
              });
            }
          } catch (err) { console.error("Auto-matching oferta error:", err); }
        });
      }

      res.status(201).json(novoAtivo);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json(err.errors);
      res.status(500).json({ message: "Internal Error" });
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
          const params = new URLSearchParams({
            where: `PROCESSO='${processo}'`,
            outFields: "PROCESSO",
            returnGeometry: "true",
            geometryType: "esriGeometryPolygon",
            outSR: "4326",
            f: "json",
          });
          const anmResp = await fetch(`${ANM_URL}?${params.toString()}`);
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
                const camposAtual = (await db.execute(sql`SELECT campos_especificos FROM assets WHERE id = ${assetId}`)) as any;
                const campos = camposAtual.rows?.[0]?.campos_especificos || {};
                const newCampos = { ...campos, latitude: centLat, longitude: centLng, codigoIbge, municipio: municipioNome };
                await db.execute(
                  sql`UPDATE assets SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326), campos_especificos = ${JSON.stringify(newCampos)}::jsonb WHERE id = ${assetId}`
                );
              } catch {}

              return res.json({ geometry });
            }
          }
        } catch (anmErr: any) {
          console.error("ANM geometry fallback error:", anmErr.message);
        }
      }

      return res.json({ geometry: null });
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.patch("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

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

      const novosEsp = req.body.camposEspecificos as any;
      const espAtual = asset.camposEspecificos as any;
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
      res.json(updated);
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.delete("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      await storage.deleteAsset(Number(req.params.id));
      res.status(204).end();
    } catch (err) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.post("/api/matching/assets/:id/enriquecer-embrapa", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const asset = await storage.getAsset(Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      const campos = (asset.camposEspecificos as any) || {};
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
      const updated = await storage.updateAsset(Number(req.params.id), {
        camposEspecificos: {
          ...campos,
          latitude: lat,
          longitude: lon,
          codigoIbge: codIBGE || campos.codigoIbge || null,
          embrapa: embrapaCompat,
          enrichmentAgro: resultado,
          embrapaUpdatedAt: now,
        },
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
        const campos = (asset.camposEspecificos as any) || {};
        const lat = Number(campos.latitude);
        const lon = Number(campos.longitude);
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

      const campos = (asset.camposEspecificos as any) || {};
      await storage.updateAsset(Number(req.params.id), {
        camposEspecificos: {
          ...campos,
          ndviGrid: {
            ...resultado,
            polygon,
          },
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

    const campos = (asset.camposEspecificos as any) || {};
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
        ? getUsoTerraMapBiomas(lat, lon)
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

    const camposAtualizados = {
      ...campos,
      enriquecimentoCompleto: resultados,
      temEmbargoIbama,
      enriquecimentoCompletoEm: new Date().toISOString(),
    };

    await storage.updateAsset(asset.id, { camposEspecificos: camposAtualizados });

    res.json({
      message: `Enriquecimento concluído${erros.length > 0 ? ` (${erros.join(", ")} indisponíveis)` : ""}`,
      resultados,
      temEmbargoIbama,
      erros,
    });
  });
}
