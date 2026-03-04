import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import {
  norionCafRegistros,
  companies,
  leads,
} from "@shared/schema";
import {
  eq,
  and,
  desc,
  asc,
  ilike,
  isNull,
  isNotNull,
  sql,
  inArray,
} from "drizzle-orm";
import { randomBytes } from "crypto";
import type { CafLead, CafCrawlerJob } from "../services/caf-crawler";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
  next();
}

function getOrgId(req: Request): number {
  const user = req.user as any;
  return user?.orgId || Number(process.env.DEFAULT_ORG_ID) || 1;
}

const varredurasAtivas = new Map<string, CafCrawlerJob>();

function mapLeadToRegistro(lead: CafLead, orgId: number) {
  return {
    orgId,
    nomeTitular: lead.nome,
    cpfTitular: lead.cpfMascarado || null,
    numeroUFPA: lead.nufpa,
    municipio: lead.municipio || null,
    uf: lead.uf || null,
    areaHa: lead.areaHa,
    condicaoPosse: lead.condicaoPosse || null,
    atividadePrincipal: lead.atividade || null,
    enquadramentoPronaf: lead.enquadramentoPronaf ? "Sim" : "Não",
    composicaoFamiliar: lead.membros || [],
    entidadeNome: lead.entidadeCadastradora || null,
    validade: lead.dataValidade || null,
    dataInscricao: lead.dataInscricao || null,
    numImoveis: lead.numImoveis || 1,
    status: lead.situacao === "ATIVA"
      ? "ativo"
      : lead.situacao === "INATIVA"
      ? "vencido"
      : "pendente",
    norionProfile: lead.norionProfile || "baixo",
    classificacao: "pendente" as const,
    dadosExtras: {
      idUfpa: lead.idUfpa,
      grauParentesco: lead.grauParentesco,
      situacaoOriginal: lead.situacao,
      extraidoEm: lead.extraidoEm,
    },
    companyId: null,
  };
}

async function enviarParaSdr(registroId: number, orgId: number) {
  const [registro] = await db
    .select()
    .from(norionCafRegistros)
    .where(
      and(
        eq(norionCafRegistros.id, registroId),
        eq(norionCafRegistros.orgId, orgId)
      )
    )
    .limit(1);

  if (!registro) throw new Error("Registro não encontrado");
  if (registro.companyId) throw new Error("Já enviado ao SDR");

  const [company] = await db
    .insert(companies)
    .values({
      orgId,
      legalName: registro.nomeTitular,
      tradeName: registro.nomeTitular,
      cnpj: null,
      address: {
        municipio: registro.municipio || "",
        uf: registro.uf || "",
      },
      tags: ["produtor_rural", "caf", registro.norionProfile || "baixo"],
      notes: [
        `NUFPA: ${registro.numeroUFPA}`,
        `Área: ${registro.areaHa ? `${registro.areaHa} ha` : "não informado"}`,
        `Condição de posse: ${registro.condicaoPosse || "não informado"}`,
        `Atividade: ${registro.atividadePrincipal || "não informado"}`,
        `PRONAF: ${registro.enquadramentoPronaf}`,
        `Validade CAF: ${registro.validade || "não informado"}`,
        `Entidade: ${registro.entidadeNome || "não informado"}`,
      ].join("\n"),
      enrichmentData: {
        origem: "CAF",
        nufpa: registro.numeroUFPA,
        areaHa: registro.areaHa,
        condicaoPosse: registro.condicaoPosse,
        atividadePrincipal: registro.atividadePrincipal,
        enquadramentoPronaf: registro.enquadramentoPronaf,
        validade: registro.validade,
        composicaoFamiliar: registro.composicaoFamiliar,
      },
      enrichedAt: new Date(),
      norionProfile: registro.norionProfile || "baixo",
    })
    .returning();

  const score =
    registro.norionProfile === "alto" ? 80 :
    registro.norionProfile === "medio" ? 50 : 20;

  const [lead] = await db
    .insert(leads)
    .values({
      orgId,
      companyId: company.id,
      status: "new",
      score,
      scoreBreakdownJson: {
        norionProfile: registro.norionProfile,
        areaHa: registro.areaHa,
        pronaf: registro.enquadramentoPronaf === "Sim",
        situacao: registro.status,
      },
      source: "CAF",
    })
    .returning();

  await db
    .update(norionCafRegistros)
    .set({
      companyId: company.id,
      classificacao: "enviado_sdr",
      updatedAt: new Date(),
      dadosExtras: {
        ...(registro.dadosExtras as any),
        enviadoSdrEm: new Date().toISOString(),
        leadId: lead.id,
      },
    })
    .where(eq(norionCafRegistros.id, registroId));

  return { company, lead };
}

export function registerCafExtratorRoutes(app: Express) {

  app.get("/api/caf-extrator/testar", requireAuth, async (req: Request, res: Response) => {
    try {
      const { consultarNufpa } = await import("../services/caf-crawler");
      const nufpa = (req.query.nufpa as string) || "RS032025.01.002731822CAF";
      const lead = await consultarNufpa(nufpa);
      res.json({ success: !!lead, nufpa, data: lead });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/caf-extrator/varredura", requireAuth, async (req: Request, res: Response) => {
    try {
      const { executarCrawlerCAF } = await import("../services/caf-crawler");
      const orgId = getOrgId(req);
      const {
        uf = "MG", ano = 2025, mes = 1,
        seqInicio = 1, seqFim = 100,
        areaMinHa = 0, areaMaxHa = 0,
        delayMs = 1100,
        apenasProprietario = false,
        apenasAtivos = true,
        apenasComPronaf = false,
        municipio, codIBGE,
        modo = "paginado",
      } = req.body;

      const jobId = randomBytes(8).toString("hex");
      const job: CafCrawlerJob = {
        id: jobId,
        orgId: String(orgId),
        modo: modo as "paginado" | "sequencial" | "municipio",
        uf, ano, mes, seqInicio, seqFim,
        municipio, codIBGE,
        areaMinHa, areaMaxHa,
        delayMs: Math.max(500, Number(delayMs) || 1100),
        apenasProprietario, apenasAtivos, apenasComPronaf,
        status: "pendente",
        progresso: 0,
        totalVaridos: 0, totalEncontrados: 0,
        totalSalvos: 0, totalErros: 0,
        iniciadoEm: null, concluidoEm: null,
      };

      varredurasAtivas.set(jobId, job);

      executarCrawlerCAF(
        job,
        (updated) => { varredurasAtivas.set(jobId, { ...updated }); },
        async (lead) => {
          try {
            const [existente] = await db
              .select({ id: norionCafRegistros.id })
              .from(norionCafRegistros)
              .where(
                and(
                  eq(norionCafRegistros.orgId, orgId),
                  eq(norionCafRegistros.numeroUFPA, lead.nufpa)
                )
              )
              .limit(1);

            if (!existente) {
              await db.insert(norionCafRegistros).values(mapLeadToRegistro(lead, orgId));
            }
          } catch (e: any) {
            console.error(`[CAF] Erro ao salvar ${lead.nufpa}:`, e.message);
          }
        }
      ).catch((err) => {
        const j = varredurasAtivas.get(jobId);
        if (j) { j.status = "erro"; j.mensagemErro = err.message; }
      });

      res.json({ jobId, status: "iniciada", job });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/caf-extrator/varredura/:id", requireAuth, (req, res) => {
    const job = varredurasAtivas.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Não encontrada" });
    res.json(job);
  });

  app.post("/api/caf-extrator/varredura/:id/cancelar", requireAuth, async (req, res) => {
    try {
      const { cancelarJob } = await import("../services/caf-crawler");
      if (!varredurasAtivas.has(req.params.id)) return res.status(404).json({ error: "Não encontrada" });
      cancelarJob(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/caf-extrator/varreduras", requireAuth, (_req, res) => {
    res.json(Array.from(varredurasAtivas.values()));
  });

  app.get("/api/caf-extrator/varredura/:id/stream", requireAuth, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const end = () => { clearInterval(interval); res.end(); };
    const interval = setInterval(() => {
      const job = varredurasAtivas.get(req.params.id);
      if (!job) { res.write(`data: ${JSON.stringify({ error: "not_found" })}\n\n`); end(); return; }
      res.write(`data: ${JSON.stringify(job)}\n\n`);
      if (["concluido", "erro", "pausado"].includes(job.status)) end();
    }, 1500);

    req.on("close", end);
  });

  app.get("/api/caf-extrator/registros", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId   = getOrgId(req);
      const page     = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(200, parseInt(req.query.pageSize as string) || 50);
      const offset   = (page - 1) * pageSize;
      const orderDir = req.query.order === "asc" ? "asc" : "desc";
      const orderBy  = (req.query.orderBy as string) || "createdAt";

      const conditions = [eq(norionCafRegistros.orgId, orgId)];

      if (req.query.status)
        conditions.push(eq(norionCafRegistros.status, req.query.status as string));

      if (req.query.classificacao)
        conditions.push(eq(norionCafRegistros.classificacao, req.query.classificacao as string));

      if (req.query.norionProfile)
        conditions.push(eq(norionCafRegistros.norionProfile, req.query.norionProfile as string));

      if (req.query.uf)
        conditions.push(eq(norionCafRegistros.uf, (req.query.uf as string).toUpperCase()));

      if (req.query.enviado === "true")
        conditions.push(isNotNull(norionCafRegistros.companyId));
      else if (req.query.enviado === "false")
        conditions.push(isNull(norionCafRegistros.companyId));

      if (req.query.busca) {
        const termo = `%${req.query.busca}%`;
        conditions.push(
          sql`(${ilike(norionCafRegistros.nomeTitular, termo)} OR ${ilike(norionCafRegistros.municipio, termo)} OR ${ilike(norionCafRegistros.numeroUFPA, termo)})`
        );
      }

      const where = and(...conditions);

      const colMap: Record<string, any> = {
        createdAt:     norionCafRegistros.createdAt,
        nomeTitular:   norionCafRegistros.nomeTitular,
        areaHa:        norionCafRegistros.areaHa,
        norionProfile: norionCafRegistros.norionProfile,
        municipio:     norionCafRegistros.municipio,
        classificacao: norionCafRegistros.classificacao,
      };
      const col = colMap[orderBy] || norionCafRegistros.createdAt;
      const orderExpr = orderDir === "asc" ? asc(col) : desc(col);

      const [data, countResult, sumarioResult] = await Promise.all([
        db
          .select()
          .from(norionCafRegistros)
          .where(where)
          .orderBy(orderExpr)
          .limit(pageSize)
          .offset(offset),

        db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(norionCafRegistros)
          .where(where),

        db
          .select({
            total:        sql<number>`cast(count(*) as int)`,
            ativos:       sql<number>`cast(sum(case when status = 'ativo' then 1 else 0 end) as int)`,
            pendentes:    sql<number>`cast(sum(case when classificacao = 'pendente' then 1 else 0 end) as int)`,
            qualificados: sql<number>`cast(sum(case when classificacao = 'qualificado' then 1 else 0 end) as int)`,
            descartados:  sql<number>`cast(sum(case when classificacao = 'descartado' then 1 else 0 end) as int)`,
            enviadosSdr:  sql<number>`cast(sum(case when classificacao = 'enviado_sdr' then 1 else 0 end) as int)`,
            perfilAlto:   sql<number>`cast(sum(case when norion_profile = 'alto' then 1 else 0 end) as int)`,
            perfilMedio:  sql<number>`cast(sum(case when norion_profile = 'medio' then 1 else 0 end) as int)`,
            perfilBaixo:  sql<number>`cast(sum(case when norion_profile = 'baixo' then 1 else 0 end) as int)`,
          })
          .from(norionCafRegistros)
          .where(eq(norionCafRegistros.orgId, orgId)),
      ]);

      res.json({
        success: true,
        data,
        total: countResult[0]?.count ?? 0,
        page,
        pageSize,
        totalPages: Math.ceil((countResult[0]?.count ?? 0) / pageSize),
        sumario: sumarioResult[0] ?? {},
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/caf-extrator/registros/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = getOrgId(req);
      const [registro] = await db
        .select()
        .from(norionCafRegistros)
        .where(and(
          eq(norionCafRegistros.id, parseInt(req.params.id)),
          eq(norionCafRegistros.orgId, orgId)
        ))
        .limit(1);

      if (!registro) return res.status(404).json({ error: "Não encontrado" });
      res.json({ success: true, data: registro });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/caf-extrator/registros/:id/classificar", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = getOrgId(req);
      const { classificacao, notas } = req.body;

      const validas = ["pendente", "qualificado", "descartado"];
      if (!validas.includes(classificacao)) {
        return res.status(400).json({ error: `classificacao inválida. Use: ${validas.join(", ")}` });
      }

      const [atual] = await db
        .select({ dadosExtras: norionCafRegistros.dadosExtras })
        .from(norionCafRegistros)
        .where(and(
          eq(norionCafRegistros.id, parseInt(req.params.id)),
          eq(norionCafRegistros.orgId, orgId)
        ))
        .limit(1);

      if (!atual) return res.status(404).json({ error: "Não encontrado" });

      const [atualizado] = await db
        .update(norionCafRegistros)
        .set({
          classificacao,
          updatedAt: new Date(),
          dadosExtras: {
            ...(atual.dadosExtras as any || {}),
            notasClassificacao: notas ?? null,
            classificadoEm: new Date().toISOString(),
          },
        })
        .where(eq(norionCafRegistros.id, parseInt(req.params.id)))
        .returning();

      res.json({ success: true, data: atualizado });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/caf-extrator/registros/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = getOrgId(req);
      await db
        .delete(norionCafRegistros)
        .where(and(
          eq(norionCafRegistros.id, parseInt(req.params.id)),
          eq(norionCafRegistros.orgId, orgId)
        ));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/caf-extrator/registros/lote", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = getOrgId(req);
      const { ids } = req.body as { ids: number[] };

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids é obrigatório e deve ser um array" });
      }

      await db
        .delete(norionCafRegistros)
        .where(
          and(
            eq(norionCafRegistros.orgId, orgId),
            inArray(norionCafRegistros.id, ids)
          )
        );

      res.json({ success: true, deletados: ids.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/caf-extrator/registros/:id/enviar-sdr", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = getOrgId(req);
      const resultado = await enviarParaSdr(parseInt(req.params.id), orgId);
      res.json({ success: true, ...resultado });
    } catch (err: any) {
      const status = err.message === "Já enviado ao SDR" ? 409 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.post("/api/caf-extrator/registros/enviar-sdr-lote", requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = getOrgId(req);
      const { ids } = req.body as { ids: number[] };

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids é obrigatório" });
      }

      const resultado = { enviados: 0, jaEnviados: 0, erros: 0 };

      for (const id of ids) {
        try {
          await enviarParaSdr(id, orgId);
          resultado.enviados++;
        } catch (err: any) {
          if (err.message === "Já enviado ao SDR") resultado.jaEnviados++;
          else resultado.erros++;
        }
      }

      res.json({ success: true, ...resultado });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/caf-extrator/municipios/:uf", requireAuth, async (req: Request, res: Response) => {
    try {
      const { default: axios } = await import("axios");
      const uf = req.params.uf.toUpperCase();
      const r = await axios.get(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
        { timeout: 10000 }
      );
      res.json({
        success: true,
        data: r.data.map((m: any) => ({ nome: m.nome, codIBGE: m.id.toString() })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
