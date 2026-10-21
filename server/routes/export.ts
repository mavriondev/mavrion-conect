import type { Express } from "express";
import type { IStorage } from "../storage";
import { sendExport, type ExportColumn } from "../export";
import { getOrgId } from "../lib/tenant";
import { renderAssetReportPdf, generateConsolidatedAnalysis, hashConsolidatedInsumos, ReportBusyError } from "../lib/asset-report";
import {
  anexarVigenciaCalculada,
  ConflitoVigenciaAlvaraError,
  hashInsumosVigenciaDoAtivo,
  obterVigenciaCalculada,
} from "../lib/vigencia-alvara";
import { PARECER_VERSAO } from "../lib/parecer-consolidado";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getAssetGeometry } from "../lib/asset-geometry";
import { getProcessoFromCache, parseEventosScmHtml } from "../lib/scm-scraper";
import { completarCamadasRestricao } from "../lib/restricoes-cruzamento";
import { filtrarEventosReais } from "../lib/relatorio-vinculos";
import { getEventosByProcesso } from "../lib/anm-eventos-importer";
import { getSeiFromCache } from "../lib/sei-scraper";

// Busca dados do SCM cacheados para o processo ANM do ativo (tolerante ao formato com/sem pontos)
async function getScmDataForAsset(asset: any): Promise<any | null> {
  const campos = (asset.camposEspecificos || {}) as any;
  const attrs = (asset.attributesJson || {}) as any;
  const processoAnm: string | undefined = campos.processoAnm || attrs.anmProcesso || asset.anmProcesso;
  if (!processoAnm) return null;
  // getProcessoFromCache normaliza o formato (pontos, zeros à esquerda)
  const cached = await getProcessoFromCache(processoAnm);
  if (!cached) return null;
  const { rawHtml, ...rest } = cached as any;
  // Best-effort: se a página SCM em cache já contiver a tabela de eventos,
  // extrai para popular o histórico (nenhuma outra fonte alimenta eventos).
  let eventosScm: Array<{ data: string | null; descricao: string }> = [];
  if (rawHtml) {
    try { eventosScm = parseEventosScmHtml(rawHtml); } catch { /* best-effort */ }
  }
  return { ...rest, eventosScm };
}

// Faixa de anos das bases locais (TAH/CFEM) — qualifica conclusões negativas
// no PDF e no digest da IA. Cache em memória (6h): MIN/MAX mudam raramente e
// não podem custar uma varredura por PDF.
let _escopoCache: { at: number; escopo: any } | null = null;
async function getEscopoBases(): Promise<any | null> {
  if (_escopoCache && Date.now() - _escopoCache.at < 6 * 60 * 60 * 1000) return _escopoCache.escopo;
  try {
    const [tahR, cfemR] = await Promise.all([
      db.execute(sql`SELECT MIN(ano_base) AS ano_min, MAX(ano_base) AS ano_max FROM tah_titulares`),
      db.execute(sql`SELECT MIN(ano) AS ano_min, MAX(ano) AS ano_max FROM cfem_arrecadacao`),
    ]);
    const faixa = (r: any) => (r && r.ano_min != null && r.ano_max != null)
      ? { anoMin: Number(r.ano_min), anoMax: Number(r.ano_max) } : null;
    const escopo = {
      tah: faixa((tahR as any).rows?.[0]),
      cfem: faixa((cfemR as any).rows?.[0]),
    };
    _escopoCache = { at: Date.now(), escopo };
    return escopo;
  } catch {
    // sem base local: a nota sai como "período não determinado nesta geração"
    return null;
  }
}


export function registerExportRoutes(app: Express, storage: IStorage) {
  // Relatório PDF completo do ativo, gerado a partir dos dados (não screenshot)
  app.get("/api/assets/:id/relatorio.pdf", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const assetId = Number(req.params.id);
      if (!Number.isFinite(assetId)) return res.status(400).json({ message: "ID inválido" });
      const storedAsset = await storage.getAsset(assetId);
      if (!storedAsset || storedAsset.orgId !== getOrgId(req)) {
        return res.status(404).json({ message: "Ativo não encontrado" });
      }
      let asset: any = storedAsset;

      // Dados do SCM (CNPJ oficial do titular) — não bloqueia se indisponível
      try {
        (asset as any).__scmData = await getScmDataForAsset(asset);
      } catch {
        (asset as any).__scmData = null;
      }

      // Geometria para o mapa do relatório (não bloqueia se indisponível)
      try {
        (asset as any).__reportGeometry = await getAssetGeometry(assetId, asset.orgId);
      } catch {
        (asset as any).__reportGeometry = null;
      }

      // Parecer consolidado (IA): reusa se gerado nas últimas 24h; senão gera
      // agora e persiste. Falha da IA não impede o relatório.
      const campos = (asset.camposEspecificos || {}) as any;

      // Histórico de eventos ANM: fonte primária é a base local de eventos
      // (dados abertos ANM — microdados SCM); fallback best-effort no rawHtml
      // do SCM em cache. Só em memória para esta geração (nada é persistido).
      // Quando nenhuma fonte tem eventos, o PDF mostra nota explícita de
      // indisponibilidade em vez de omitir a seção.
      try {
        const scmData = (asset as any).__scmData;
        const processoRef = campos.processoAnm || (asset.attributesJson as any)?.anmProcesso || (asset as any).anmProcesso;
        let temEventosReais = filtrarEventosReais(campos.anmHistorico?.eventos, processoRef).length > 0;
        if (processoRef) {
          const local = await getEventosByProcesso(String(processoRef));
          if (local.total > 0) {
            campos.anmHistorico = {
              eventos: local.eventos,
              fonte: local.fonte,
              dataBase: local.dataBase,
              consultadoEm: new Date().toISOString(),
            };
            (asset as any).camposEspecificos = campos;
            temEventosReais = true;
          }
        }
        if (Array.isArray(scmData?.eventosScm) && scmData.eventosScm.length > 0 && !temEventosReais) {
          campos.anmHistorico = {
            eventos: scmData.eventosScm,
            fonte: "SCM/ANM — página da consulta em cache",
            consultadoEm: scmData?.consultadoEm || null,
          };
          (asset as any).camposEspecificos = campos;
        }
      } catch { /* best-effort */ }

      // Ponto único do fluxo: depois que o histórico foi resolvido, calcula e
      // anexa a vigência uma única vez. Todos os consumidores abaixo recebem
      // este mesmo objeto; nenhum prompt ou renderizador refaz a cadeia.
      asset = anexarVigenciaCalculada(asset);
      const vigenciaAlvara = obterVigenciaCalculada(asset);
      const registroVigencia = {
        ...vigenciaAlvara,
        insumosHash: hashInsumosVigenciaDoAtivo(asset),
        processoAnm: campos.processoAnm || (asset.attributesJson as any)?.anmProcesso || asset.anmProcesso || null,
        consultadoEm: campos.anmHistorico?.consultadoEm || null,
      };
      const registroAnterior = campos.vigenciaAlvaraCalculada;
      const anteriorComparavel = registroAnterior
        ? { ...registroAnterior, calculadoEm: undefined }
        : null;
      if (JSON.stringify(anteriorComparavel) !== JSON.stringify(registroVigencia)) {
        campos.vigenciaAlvaraCalculada = { ...registroVigencia, calculadoEm: new Date().toISOString() };
        (asset as any).camposEspecificos = campos;
        try {
          await storage.mergeAssetCampos(assetId, { vigenciaAlvaraCalculada: campos.vigenciaAlvaraCalculada });
        } catch (e: any) {
          console.error("[Export] Falha ao persistir memória da vigência:", e.message);
        }
      }

      // SEI — processo administrativo (documentos e andamentos): só do cache
      // sei_consultas (a consulta ao vivo exige captcha manual — nunca roda na
      // geração). Só em memória para esta geração; sem cache o payload fica
      // ausente e a seção "Disponibilidade das fontes" mostra "não consultada".
      try {
        const processoRef = campos.processoAnm || (asset.attributesJson as any)?.anmProcesso || (asset as any).anmProcesso;
        const nupRef = (asset as any).__scmData?.nup || null;
        if (processoRef || nupRef) {
          const sei = await getSeiFromCache({ nup: nupRef, processo: processoRef ? String(processoRef) : null });
          if (sei) {
            const { rawHtml, ...rest } = sei as any;
            const nDocs = Array.isArray((rest as any).documentos) ? (rest as any).documentos.length : 0;
            const nAndamentos = Array.isArray((rest as any).andamentos) ? (rest as any).andamentos.length : 0;
            campos.anmSei = {
              disponivel: true,
              ...rest,
              // contrato de três estados: cache com conteúdo = registro
              // existente; cache vazio = consultada sem registro
              estadoConsulta: nDocs + nAndamentos > 0 ? "registro_existente" : "consultada_sem_registro",
              situacaoRegistro: nDocs + nAndamentos > 0 ? "indeterminada" : null,
              tierFonte: "T1",
              janelaCobertura: "pesquisa pública SEI/ANM — conteúdo da última consulta em cache (não é consulta ao vivo)",
            };
            (asset as any).camposEspecificos = campos;
          }
        }
      } catch { /* best-effort: sem cache SEI, a telemetria acusa "não consultada" */ }

      // Escopo das bases locais (TAH/CFEM) — anexado ANTES do hash: entra no
      // digest para a IA qualificar conclusões negativas (só faixas de anos,
      // dado real que muda apenas quando as bases são reimportadas).
      (asset as any).__escopoBases = (asset.type === "MINA" || campos.processoAnm) ? await getEscopoBases() : null;

      // Camadas de restrição: todo relatório roda o conjunto completo
      // (FUNAI + CNUC + embargos + cavernas + quilombolas + assentamentos);
      // camada que falhar aparece como "não consultada" — nunca some.
      if (asset.type === "MINA") {
        try {
          const deltaCamadas = await completarCamadasRestricao(campos);
          if (Object.keys(deltaCamadas).length > 0) {
            Object.assign(campos, deltaCamadas);
            (asset as any).camposEspecificos = campos;
            // merge atômico: persiste só o delta, sem regravar o objeto inteiro
            await storage.mergeAssetCampos(assetId, deltaCamadas);
          }
        } catch (e: any) {
          console.error("[Export] Falha ao completar camadas de restrição:", e.message);
        }
      }
      // Cache por hash dos insumos (determinismo): só regenera quando os
      // dados de entrada mudarem — não por TTL. Mesmo input ⇒ mesmo parecer.
      // Payload em formato antigo (sem versao 2 / enunciados classificados)
      // também força regeneração: prosa livre nunca volta a ser exibida.
      const prev = campos.iaRelatorioConsolidado;
      const insumosAtuais = hashConsolidatedInsumos(asset);
      if (!prev || prev.versao !== PARECER_VERSAO || prev.insumosHash !== insumosAtuais) {
        const parecer = await generateConsolidatedAnalysis(asset);
        if (parecer) {
          campos.iaRelatorioConsolidado = parecer;
          (asset as any).camposEspecificos = campos;
          try {
            // merge atômico: persiste só o parecer, sem regravar o objeto inteiro
            await storage.mergeAssetCampos(assetId, { iaRelatorioConsolidado: parecer });
          } catch (e: any) {
            console.error("[Export] Falha ao persistir parecer consolidado:", e.message);
          }
        }
      }

      // Aviso fora do PDF: quando o parecer não existe nesta geração (nunca
      // gerado e a geração acima falhou) ou só existe em formato antigo (não
      // renderizável), o header sinaliza ao frontend para trocar o toast de
      // sucesso por um aviso claro — o download segue normal e o PDF mantém a
      // nota interna de indisponibilidade.
      if (!campos.iaRelatorioConsolidado || campos.iaRelatorioConsolidado.versao !== PARECER_VERSAO) {
        res.setHeader("X-Parecer-Ia", "indisponivel");
      }

      const pdf = await renderAssetReportPdf(asset);
      const safeName = String(asset.title || "ativo").replace(/[^\w\-]+/g, "_").slice(0, 60);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Relatorio_${safeName}.pdf"`);
      res.send(pdf);
    } catch (e: any) {
      console.error("[Export] Erro relatório PDF:", e.message);
      if (e instanceof ReportBusyError) {
        return res.status(429).json({ message: e.message });
      }
      if (e instanceof ConflitoVigenciaAlvaraError) {
        return res.status(409).json({ message: e.message, dataCanonica: e.dataCanonica });
      }
      // não expor detalhes internos do renderizador ao cliente
      res.status(500).json({ message: "Erro ao gerar o relatório PDF. Tente novamente." });
    }
  });

  app.get("/api/export/companies", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const format = (req.query.format as string) || "xlsx";
      const companies = await storage.getCompanies();

      const columns: ExportColumn[] = [
        { header: "Razão Social", key: "legalName" },
        { header: "Nome Fantasia", key: "tradeName" },
        { header: "CNPJ", key: "cnpj" },
        { header: "CNAE Principal", key: "cnaePrincipal" },
        { header: "Porte", key: "porte" },
        { header: "UF", key: "address", format: (v: any) => v?.state || "" },
        { header: "Município", key: "address", format: (v: any) => v?.city || "" },
        { header: "Telefones", key: "phones", format: (v: any) => Array.isArray(v) ? v.join(", ") : "" },
        { header: "Emails", key: "emails", format: (v: any) => Array.isArray(v) ? v.join(", ") : "" },
        { header: "Website", key: "website" },
        { header: "Importado em", key: "createdAt", format: (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "" },
      ];

      sendExport(res, companies as any[], columns, format, "empresas");
    } catch (err: any) {
      console.error("Export companies error:", err);
      res.status(500).json({ message: "Erro ao exportar empresas" });
    }
  });

  app.get("/api/export/assets", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const format = (req.query.format as string) || "xlsx";
      const assets = await storage.getAssets();

      const typeLabels: Record<string, string> = {
        TERRA: "Terras/Fazendas", MINA: "Mineração", NEGOCIO: "Negócio/M&A",
        FII_CRI: "Ativo legado", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio",
      };

      const columns: ExportColumn[] = [
        { header: "Título", key: "title" },
        { header: "Tipo", key: "type", format: (v: any) => typeLabels[v] || v || "" },
        { header: "Município", key: "municipio" },
        { header: "Estado", key: "estado" },
        { header: "Área (ha)", key: "areaHa", format: (v: any) => v != null ? String(v) : "" },
        { header: "Preço Pedido (R$)", key: "priceAsking", format: (v: any) => v ? Number(v).toFixed(2) : "" },
        { header: "Matrícula", key: "matricula" },
        { header: "Status Docs", key: "docsStatus" },
        { header: "Tags", key: "tags", format: (v: any) => Array.isArray(v) ? v.join(", ") : "" },
        { header: "Processo ANM", key: "anmProcesso" },
        { header: "Criado em", key: "createdAt", format: (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "" },
      ];

      sendExport(res, assets as any[], columns, format, "ativos");
    } catch (err: any) {
      console.error("Export assets error:", err);
      res.status(500).json({ message: "Erro ao exportar ativos" });
    }
  });
}
