import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getOrgId } from "../lib/tenant";
import { carregarAtivoGeo, executarVerificacoes, gravarVerificacoes } from "../lib/verificacoes-terra";
import {
  CHAVES_VERIFICACAO, confirmarVerificacao, estaVencida, type Achado, type OrigemConfirmacao, type Verificacao,
} from "../lib/confianca-dados";

function linhaParaVerificacao(r: any): Verificacao {
  return {
    chave: r.chave, rotulo: r.rotulo ?? r.chave, estado: r.estado, achado: r.achado,
    valor: r.valor_json, unidade: r.unidade ?? undefined, fonte: r.fonte ?? "",
    consultadoEm: new Date(r.consultado_em).toISOString(),
    confirmadoPor: r.confirmado_por ?? undefined, observacao: r.observacao ?? undefined,
  };
}

async function assetDaOrg(assetId: number, orgId: number): Promise<boolean> {
  const r = await db.execute(sql`SELECT 1 FROM assets WHERE id = ${assetId} AND org_id = ${orgId}`);
  return ((r as any).rows?.length || 0) > 0;
}

/** Vigente por chave: confirmação humana mais recente vence a automática; a automática mais recente vem junto para mostrar divergência. */
async function lerVigentes(assetId: number) {
  const rows = (await db.execute(sql`
    SELECT * FROM asset_verificacoes WHERE asset_id = ${assetId} ORDER BY consultado_em DESC, id DESC
  `) as any).rows as any[];
  const porChave = new Map<string, { conf?: Verificacao; auto?: Verificacao }>();
  for (const r of rows) {
    const v = linhaParaVerificacao(r);
    const e = porChave.get(v.chave) || {};
    if (v.estado === "confirmado") { if (!e.conf) e.conf = v; } else if (!e.auto) e.auto = v;
    porChave.set(v.chave, e);
  }
  return [...porChave.entries()].map(([chave, e]) => {
    const vigente = (e.conf || e.auto)!;
    return {
      ...vigente,
      desatualizada: estaVencida(vigente),
      automaticaMaisRecente: e.conf && e.auto ? e.auto : undefined,
      divergencia: !!(e.conf && e.auto && e.conf.achado !== e.auto.achado && e.auto.estado !== "sem_dado"),
    };
  }).sort((a, b) => a.chave.localeCompare(b.chave));
}

export function registerVerificacoesRoutes(app: Express) {
  app.get("/api/assets/:id/verificacoes", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      if (!(await assetDaOrg(assetId, getOrgId(req)))) return res.status(404).json({ message: "Ativo não encontrado" });
      res.json({ verificacoes: await lerVigentes(assetId) });
    } catch (e: any) { res.status(500).json({ message: "Erro interno" }); }
  });

  app.get("/api/assets/:id/verificacoes/historico", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      if (!(await assetDaOrg(assetId, getOrgId(req)))) return res.status(404).json({ message: "Ativo não encontrado" });
      const chave = typeof req.query.chave === "string" ? req.query.chave : null;
      const rows = (await db.execute(chave
        ? sql`SELECT * FROM asset_verificacoes WHERE asset_id = ${assetId} AND chave = ${chave} ORDER BY consultado_em DESC, id DESC LIMIT 200`
        : sql`SELECT * FROM asset_verificacoes WHERE asset_id = ${assetId} ORDER BY consultado_em DESC, id DESC LIMIT 500`) as any).rows as any[];
      res.json({ historico: rows.map(linhaParaVerificacao) });
    } catch { res.status(500).json({ message: "Erro interno" }); }
  });

  // Executa as consultas (pode levar dezenas de segundos) e grava no histórico.
  app.post("/api/assets/:id/verificacoes/executar", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const ativo = await carregarAtivoGeo(assetId, orgId);
      if (!ativo) return res.status(422).json({ message: "Ativo sem polígono cadastrado — cadastre/importe o polígono antes." });
      const vs = await executarVerificacoes(ativo);
      await gravarVerificacoes(assetId, orgId, vs);
      res.json({ verificacoes: await lerVigentes(assetId) });
    } catch (e: any) {
      console.error("[Verificacoes] erro:", e.message);
      res.status(500).json({ message: "Erro ao executar verificações" });
    }
  });

  // Confirmação humana (vendedor / documento / visita) — vira o valor vigente.
  app.post("/api/assets/:id/verificacoes/:chave/confirmar", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const assetId = Number(req.params.id);
      const orgId = getOrgId(req);
      const chave = String(req.params.chave);
      if (!CHAVES_VERIFICACAO[chave]) return res.status(400).json({ message: "Verificação desconhecida" });
      if (!(await assetDaOrg(assetId, orgId))) return res.status(404).json({ message: "Ativo não encontrado" });
      const { achado, valor, confirmadoPor, observacao } = req.body || {};
      if (!["detectado", "nao_detectado"].includes(achado)) return res.status(400).json({ message: "achado deve ser detectado ou nao_detectado" });
      const atual = (await lerVigentes(assetId)).find((v) => v.chave === chave) || null;
      const v = confirmarVerificacao(atual, {
        chave, achado: achado as Achado, valor, confirmadoPor: confirmadoPor as OrigemConfirmacao,
        observacao: typeof observacao === "string" ? observacao.slice(0, 500) : undefined,
      });
      await gravarVerificacoes(assetId, orgId, [v]);
      res.json({ verificacoes: await lerVigentes(assetId) });
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Dados inválidos" });
    }
  });
}
