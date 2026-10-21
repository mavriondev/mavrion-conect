import type { Express } from "express";
import { storage } from "../storage";
import { getOrgId } from "../lib/tenant";
import { getAssetGeometry } from "../lib/asset-geometry";
import { construirCatalogoEvidencias } from "../lib/jazida-evidencias";
import { executarPesquisaComplementar, FONTES_COMPLEMENTARES, type FonteId } from "../lib/pesquisa-complementar";
import { parseAssetId } from "./anm-enrichment";

/**
 * Rotas do módulo de jazidas: catálogo de evidências (leitura determinística
 * dos dados persistidos) e pesquisa complementar (fontes públicas gratuitas
 * + Hub API), persistida em camposEspecificos.anmPesquisaComplementar por
 * merge atômico — nunca regrava o objeto inteiro.
 */
export function registerJazidaPesquisaRoutes(app: Express) {
  const ensureAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  };

  async function carregarAtivo(req: any, res: any) {
    const assetId = parseAssetId(req.params.id);
    if (!assetId) { res.status(400).json({ message: "ID do ativo inválido" }); return null; }
    const asset = await storage.getAsset(assetId);
    if (!asset || asset.orgId !== getOrgId(req)) { res.status(404).json({ message: "Ativo não encontrado" }); return null; }
    return asset;
  }

  app.get("/api/jazida/:id/evidencias", ensureAuth, async (req, res) => {
    try {
      const asset = await carregarAtivo(req, res);
      if (!asset) return;
      let geometry: any = null;
      try { geometry = await getAssetGeometry(asset.id, asset.orgId!); } catch { geometry = null; }
      res.json(construirCatalogoEvidencias(asset, geometry));
    } catch (err: any) {
      console.error("[Jazida evidências]", err?.message);
      res.status(500).json({ message: "Erro ao montar o catálogo de evidências" });
    }
  });

  app.get("/api/jazida/fontes-complementares", ensureAuth, (_req, res) => {
    res.json(FONTES_COMPLEMENTARES);
  });

  app.post("/api/jazida/:id/pesquisa-complementar", ensureAuth, async (req, res) => {
    try {
      const asset = await carregarAtivo(req, res);
      if (!asset) return;
      const c = (asset.camposEspecificos || {}) as any;
      const attrs = (asset.attributesJson || {}) as any;
      const lat = Number(c.latitude), lon = Number(c.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return res.status(400).json({ message: "Ativo sem coordenadas válidas (latitude/longitude) — vincule o processo ANM ou informe o ponto de referência" });
      }
      const fontesPedidas = Array.isArray(req.body?.fontes)
        ? (req.body.fontes as unknown[]).filter((f): f is FonteId => typeof f === "string" && FONTES_COMPLEMENTARES.some((x) => x.id === f))
        : undefined;
      const resultado = await executarPesquisaComplementar({
        lat, lon,
        substancia: String(c.substancia || attrs.anmSubstancia || ""),
        uf: asset.estado || c.uf || null,
        municipio: asset.municipio || null,
        processoAnm: c.processoAnm || attrs.anmProcesso || null,
        raioKm: 25,
        refresh: req.body?.refresh === true,
        fontes: fontesPedidas,
      }, c.anmPesquisaComplementar || null);
      await storage.mergeAssetCampos(asset.id, {
        anmPesquisaComplementar: resultado,
        anmPesquisaComplementarUpdatedAt: resultado.consultadoEm,
      });
      // mergeAssetCampos devolve a linha crua (snake_case); reler pelo storage
      const atualizado = (await storage.getAsset(asset.id)) || asset;
      let geometry: any = null;
      try { geometry = await getAssetGeometry(asset.id, asset.orgId!); } catch { geometry = null; }
      res.json({ pesquisa: resultado, evidencias: construirCatalogoEvidencias(atualizado, geometry) });
    } catch (err: any) {
      console.error("[Jazida pesquisa complementar]", err?.message);
      res.status(500).json({ message: "Erro ao executar a pesquisa complementar" });
    }
  });
}
