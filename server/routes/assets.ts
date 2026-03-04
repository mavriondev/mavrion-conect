import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { api } from "@shared/routes";
import { z } from "zod";
import { matchSuggestions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendNotification, notifId } from "../notifications";
import { matchesRegion } from "./matching";
import { enriquecerFazenda } from "../enrichment/agro";
import { sql } from "drizzle-orm";

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

  app.patch("/api/matching/assets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
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

      if (resultado.solo?.phh2o !== null || resultado.solo?.clay !== null) {
        const ndviEstimado = Math.min(1, Math.max(0,
          0.5 + (resultado.solo?.soc ? resultado.solo.soc / 100 : 0) + (resultado.solo?.clay ? (resultado.solo.clay > 15 && resultado.solo.clay < 60 ? 0.1 : -0.05) : 0)
        ));
        embrapaCompat.ndvi = {
          ndvi: parseFloat(ndviEstimado.toFixed(2)),
          classificacao: ndviEstimado >= 0.7 ? 'Vegetação densa e saudável' : ndviEstimado >= 0.4 ? 'Vegetação moderada' : 'Vegetação escassa',
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

      const updated = await storage.updateAsset(Number(req.params.id), {
        camposEspecificos: {
          ...campos,
          latitude: lat,
          longitude: lon,
          codigoIbge: codIBGE || campos.codigoIbge || null,
          embrapa: embrapaCompat,
          enrichmentAgro: resultado,
        },
      });

      res.json({ success: true, dados: embrapaCompat, ativo: updated });
    } catch (err: any) {
      console.error("Erro enriquecimento agro:", err.message);
      res.status(500).json({ message: err.message || "Erro ao enriquecer ativo" });
    }
  });

  app.get("/api/embrapa/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { getZoneamentoAgricola } = await import("../lib/embrapa");
      await getZoneamentoAgricola("3509502");
      res.json({ status: "online", message: "Conexão com Embrapa OK" });
    } catch (err: any) {
      res.json({ status: "offline", message: err.message });
    }
  });
}
