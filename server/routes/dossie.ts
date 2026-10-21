// Rotas do "Dossiê da Jazida" — fontes públicas gratuitas:
// CFEM (produção real), DOU (publicações oficiais), SIGBM (barragens de mineração)
// e certidões do titular (PGFN/CNJ/CEIS).
import type { Express, Request, Response, NextFunction } from "express";
import {
  importCfemCsv, isCfemImportRunning, setCfemImportRunning,
  getCfemByProcesso, getCfemByCnpj, getCfemMunicipioContext, getCfemStats, splitProcesso,
} from "../lib/cfem-importer";
import { consultarBarragens, importSigbmCsv, getSigbmStats, isSigbmImportRunning } from "../lib/sigbm-importer";
import { consultarDou } from "../lib/dou";
import { consultarQueridoDiario } from "../lib/querido-diario";
import { consultarCertidoes } from "../lib/certidoes";
import {
  importPgfnDividaAtiva, isPgfnImportRunning, setPgfnImportRunning, getPgfnStats,
  PGFN_CATEGORIAS, type PgfnCategoria,
} from "../lib/pgfn-importer";
import { getCached, setCached } from "../cache";
import { cnpjValido, montarIdentificadorCnpj, payloadFalhaConsulta, type IdentificadorVinculo } from "../lib/consulta-contrato";
import { storage } from "../storage";

export function registerDossieRoutes(app: Express) {
  const ensureAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    next();
  };

  const ensureAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as { role?: string } | undefined;
    if (user?.role !== "admin" && user?.role !== "superadmin") {
      return res.status(403).json({ message: "Acesso restrito a administradores" });
    }
    next();
  };

  // ── CFEM ──

  app.post("/api/cfem/importar", ensureAdmin, async (req: Request, res: Response) => {
    if (isCfemImportRunning()) {
      return res.status(409).json({ message: "Importação CFEM já em andamento" });
    }
    // ?anos=2020,2021 importa só os anos indicados; sem parâmetro importa tudo
    const anosParam = String(req.query.anos || "").trim();
    const anos = anosParam
      ? anosParam.split(",").map(a => parseInt(a, 10)).filter(a => a >= 1980 && a <= 2100)
      : undefined;

    setCfemImportRunning(true);
    res.json({ message: `Importação CFEM iniciada em background${anos ? ` (anos ${anos.join(", ")})` : " (histórico completo)"}` });

    try {
      const result = await importCfemCsv(anos);
      console.log(`[CFEM Route] Importação concluída: ${result.imported} registros agregados`);
    } catch (err: unknown) {
      console.error("[CFEM Route] Erro na importação:", err instanceof Error ? err.message : String(err));
    } finally {
      setCfemImportRunning(false);
    }
  });

  app.get("/api/cfem/status", ensureAuth, async (_req: Request, res: Response) => {
    try {
      const stats = await getCfemStats();
      res.json({ ...stats, importRunning: isCfemImportRunning() });
    } catch {
      res.status(500).json({ message: "Erro ao obter status CFEM" });
    }
  });

  // Dossiê CFEM completo: processo + titular (CNPJ) + contexto do município
  app.get("/api/cfem/dossie", ensureAuth, async (req: Request, res: Response) => {
    const processo = String(req.query.processo || "").trim();
    const cnpj = String(req.query.cnpj || "").replace(/\D/g, "");
    try {
      const codigoMunicipio = String(req.query.municipio || "").replace(/\D/g, "");
      if (!processo && !cnpj) {
        return res.status(400).json(payloadFalhaConsulta({
          fonte: "CFEM — Arrecadação (dados abertos ANM)",
          tierFonte: "T1",
          motivoFalha: "Pré-condição ausente: informe o processo ANM ou o CNPJ do titular",
        }));
      }

      const stats = await getCfemStats();
      if (stats.totalRegistros === 0) {
        return res.json(payloadFalhaConsulta({
          fonte: "CFEM — Arrecadação (dados abertos ANM)",
          tierFonte: "T1",
          motivoFalha: "Base CFEM ainda não importada. Um administrador precisa rodar a importação (Admin → importar CFEM).",
          identificadorVinculo: processo
            ? { tipo: "processo_anm", valor: processo, proveniencia: "documento_oficial" }
            : (cnpj.length === 14 ? { tipo: "cnpj", valor: cnpj, proveniencia: "desconhecida" } : null),
          extras: { baseImportada: false },
        }));
      }

      const registrosProcesso = processo ? await getCfemByProcesso(processo) : [];
      const porAnoProcesso = new Map<number, { ano: number; valorTotal: number; substancias: Set<string> }>();
      for (const r of registrosProcesso) {
        const item = porAnoProcesso.get(r.ano) || { ano: r.ano, valorTotal: 0, substancias: new Set<string>() };
        item.valorTotal += r.valorRecolhido || 0;
        if (r.substancia) item.substancias.add(r.substancia);
        porAnoProcesso.set(r.ano, item);
      }
      const anosProcesso = Array.from(porAnoProcesso.values())
        .sort((a, b) => b.ano - a.ano)
        .map(x => ({ ano: x.ano, valorTotal: Math.round(x.valorTotal * 100) / 100, substancias: Array.from(x.substancias) }));
      const totalProcesso = anosProcesso.reduce((s, x) => s + x.valorTotal, 0);

      const titular = cnpj.length === 14 ? await getCfemByCnpj(cnpj) : null;

      // contexto do município: usa o código informado ou o dos próprios registros do processo
      const codMun = codigoMunicipio || registrosProcesso[0]?.codigoMunicipio || "";
      const municipio = codMun ? await getCfemMunicipioContext(codMun) : null;

      const { numero, ano } = splitProcesso(processo);
      const temRegistro = registrosProcesso.length > 0 || Boolean(titular && titular.porAno.length > 0);
      res.json({
        disponivel: true,
        baseImportada: true,
        // três estados: base coberta e sem recolhimento = "consultada sem registro"
        estadoConsulta: temRegistro ? "registro_existente" : "consultada_sem_registro",
        // arrecadação CFEM é histórico de recolhimento — fonte não classifica situação
        situacaoRegistro: temRegistro ? "indeterminada" : null,
        tierFonte: "T1",
        janelaCobertura: `arrecadação CFEM anos ${stats.anoMin ?? "?"}–${stats.anoMax ?? "?"} (dados abertos ANM)`,
        identificadorVinculo: processo
          ? { tipo: "processo_anm", valor: processo, proveniencia: "documento_oficial" }
          : (cnpj.length === 14 ? { tipo: "cnpj", valor: cnpj, proveniencia: "desconhecida" } : null),
        baseAnos: { de: stats.anoMin, ate: stats.anoMax },
        processo: processo ? {
          numero, anoProcesso: ano,
          jaProduziu: registrosProcesso.length > 0,
          totalRecolhido: Math.round(totalProcesso * 100) / 100,
          porAno: anosProcesso,
          detalhes: registrosProcesso.slice(0, 100).map(r => ({
            ano: r.ano, substancia: r.substancia, quantidade: r.quantidade, unidade: r.unidade,
            valorRecolhido: r.valorRecolhido, municipio: r.municipio, uf: r.uf, cpfCnpj: r.cpfCnpj,
          })),
        } : null,
        titular: titular && (titular.porAno.length > 0 || cnpj) ? {
          cnpj,
          jaRecolheu: titular.porAno.length > 0,
          totalRecolhido: Math.round(titular.totalValor * 100) / 100,
          processosDistintos: titular.processosDistintos,
          porAno: titular.porAno.slice(0, 15),
          substancias: titular.substancias,
        } : null,
        municipio,
        fonte: "CFEM — Arrecadação (dados abertos ANM)",
        consultadoEm: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[CFEM] Erro no dossiê:", err.message);
      res.status(500).json(payloadFalhaConsulta({
        fonte: "CFEM — Arrecadação (dados abertos ANM)",
        tierFonte: "T1",
        motivoFalha: `Erro inesperado ao consultar CFEM: ${err?.message || String(err)}`,
        identificadorVinculo: processo
          ? { tipo: "processo_anm", valor: processo, proveniencia: "documento_oficial" }
          : (cnpj.length === 14 ? { tipo: "cnpj", valor: cnpj, proveniencia: "desconhecida" } : null),
      }));
    }
  });

  // ── PGFN (dívida ativa da União — dados abertos trimestrais) ──

  app.post("/api/pgfn/importar", ensureAdmin, async (req: Request, res: Response) => {
    if (isPgfnImportRunning()) {
      return res.status(409).json({ message: "Importação PGFN já em andamento" });
    }
    // ?categorias=FGTS,PREVIDENCIARIO,NAO_PREVIDENCIARIO limita as categorias;
    // ?trimestre=2026_trimestre_02 força um trimestre (padrão: o mais recente)
    const catParam = String(req.query.categorias || "").trim().toUpperCase();
    const categorias = catParam
      ? (catParam.split(",").map(c => c.trim()).filter(c => c in PGFN_CATEGORIAS) as PgfnCategoria[])
      : undefined;
    if (catParam && (!categorias || categorias.length === 0)) {
      return res.status(400).json({ message: `Categorias inválidas. Use: ${Object.keys(PGFN_CATEGORIAS).join(", ")}` });
    }
    const trimestre = String(req.query.trimestre || "").trim() || undefined;
    if (trimestre && !/^\d{4}_trimestre_\d{2}$/.test(trimestre)) {
      return res.status(400).json({ message: "Trimestre inválido. Formato: 2026_trimestre_02" });
    }

    setPgfnImportRunning(true);
    res.json({ message: `Importação PGFN iniciada em background${categorias ? ` (${categorias.join(", ")})` : " (todas as categorias)"}${trimestre ? ` — trimestre ${trimestre}` : ""}` });

    try {
      const result = await importPgfnDividaAtiva({ categorias, trimestre });
      console.log(`[PGFN Route] Importação concluída: ${result.imported} devedores (ref. ${result.referencia})`);
    } catch (err: unknown) {
      console.error("[PGFN Route] Erro na importação:", err instanceof Error ? err.message : String(err));
    } finally {
      setPgfnImportRunning(false);
    }
  });

  app.get("/api/pgfn/status", ensureAuth, async (_req: Request, res: Response) => {
    try {
      const stats = await getPgfnStats();
      res.json({ ...stats, importRunning: isPgfnImportRunning() });
    } catch {
      res.status(500).json({ message: "Erro ao obter status PGFN" });
    }
  });

  // ── SIGBM (barragens) ──

  app.post("/api/sigbm/importar", ensureAdmin, async (_req: Request, res: Response) => {
    if (isSigbmImportRunning()) {
      return res.status(409).json({ message: "Importação SIGBM já em andamento" });
    }
    // Como as demais bases: responde já e importa em background — o resultado
    // fica em import_status ('sigbm') e aparece no painel de saúde.
    res.json({ message: "Importação SIGBM iniciada em background" });
    try {
      const result = await importSigbmCsv();
      console.log(`[SIGBM Route] Importação concluída: ${result.imported} barragens`);
    } catch (err: unknown) {
      console.error("[SIGBM Route] Erro na importação:", err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/api/sigbm/status", ensureAuth, async (_req: Request, res: Response) => {
    try {
      res.json(await getSigbmStats());
    } catch {
      res.status(500).json({ message: "Erro ao obter status SIGBM" });
    }
  });

  app.get("/api/sigbm/barragens", ensureAuth, async (req: Request, res: Response) => {
    const cnpj = String(req.query.cnpj || "");
    const nomeTitular = String(req.query.nome || "");
    try {
      const lat = req.query.lat != null && req.query.lat !== "" ? Number(req.query.lat) : undefined;
      const lon = req.query.lon != null && req.query.lon !== "" ? Number(req.query.lon) : undefined;
      const raioKm = Math.min(200, Math.max(5, Number(req.query.raio) || 50));
      if ((lat == null || lon == null || isNaN(lat) || isNaN(lon)) && !cnpj && !nomeTitular) {
        return res.status(400).json(payloadFalhaConsulta({
          fonte: "SIGBM/ANM — extrato público de barragens de mineração",
          tierFonte: "T1",
          motivoFalha: "Pré-condição ausente: informe coordenadas (lat/lon) ou CNPJ/nome do titular",
        }));
      }
      const result = await consultarBarragens({
        cnpj, nomeTitular,
        lat: lat != null && !isNaN(lat) ? lat : undefined,
        lon: lon != null && !isNaN(lon) ? lon : undefined,
        raioKm,
      });
      res.json(result);
    } catch (err: any) {
      console.error("[SIGBM] Erro na consulta:", err.message);
      const cnpjDigits = cnpj.replace(/\D/g, "");
      res.json(payloadFalhaConsulta({
        fonte: "SIGBM/ANM — extrato público de barragens de mineração",
        tierFonte: "T1",
        motivoFalha: `Erro inesperado ao consultar barragens SIGBM: ${err?.message || String(err)}`,
        identificadorVinculo: cnpjDigits.length === 14
          ? { tipo: "cnpj", valor: cnpjDigits, proveniencia: "desconhecida" }
          : (nomeTitular.trim().length >= 5 ? { tipo: "nome", valor: nomeTitular.trim(), proveniencia: "desconhecida" } : null),
      }));
    }
  });

  // ── DOU (Imprensa Nacional) ──

  app.get("/api/dou/publicacoes", ensureAuth, async (req: Request, res: Response) => {
    const processo = String(req.query.processo || "").trim();
    const titular = String(req.query.titular || "").trim();
    try {
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      if (!processo && !titular) {
        return res.status(400).json(payloadFalhaConsulta({
          fonte: "Diário Oficial da União — Imprensa Nacional (busca gratuita)",
          tierFonte: "T2",
          motivoFalha: "Pré-condição ausente: informe o processo ANM ou o nome do titular",
        }));
      }
      const result = await consultarDou({ processo, titular, refresh });
      res.json(result);
    } catch (err: any) {
      console.error("[DOU] Erro na consulta:", err.message);
      res.json(payloadFalhaConsulta({
        fonte: "Diário Oficial da União — Imprensa Nacional (busca gratuita)",
        tierFonte: "T2",
        motivoFalha: `Erro inesperado ao consultar o DOU: ${err?.message || String(err)}`,
        identificadorVinculo: processo
          ? { tipo: "processo_anm", valor: processo, proveniencia: "documento_oficial" }
          : (titular ? { tipo: "nome", valor: titular, proveniencia: "desconhecida" } : null),
      }));
    }
  });

  // ── Querido Diário (diários oficiais municipais) ──

  app.get("/api/dou/municipal", ensureAuth, async (req: Request, res: Response) => {
    const processo = String(req.query.processo || "").trim();
    const titular = String(req.query.titular || "").trim();
    const municipio = String(req.query.municipio || "").trim();
    const uf = String(req.query.uf || "").trim();
    try {
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      if (!processo && !titular) {
        return res.status(400).json(payloadFalhaConsulta({
          fonte: "Querido Diário — Open Knowledge Brasil (diários oficiais municipais)",
          tierFonte: "T2",
          motivoFalha: "Pré-condição ausente: informe o processo ANM ou o nome do titular",
        }));
      }
      if (!municipio) {
        return res.status(400).json(payloadFalhaConsulta({
          fonte: "Querido Diário — Open Knowledge Brasil (diários oficiais municipais)",
          tierFonte: "T2",
          motivoFalha: "Pré-condição ausente: informe o município do ativo",
          identificadorVinculo: processo
            ? { tipo: "processo_anm", valor: processo, proveniencia: "documento_oficial", origem: "número do processo ANM informado na consulta" }
            : null,
        }));
      }
      const result = await consultarQueridoDiario({ processo, titular, municipio, uf, refresh });
      res.json(result);
    } catch (err: any) {
      console.error("[QueridoDiario] Erro na consulta:", err.message);
      res.json(payloadFalhaConsulta({
        fonte: "Querido Diário — Open Knowledge Brasil (diários oficiais municipais)",
        tierFonte: "T2",
        motivoFalha: `Erro inesperado ao consultar o Querido Diário: ${err?.message || String(err)}`,
        identificadorVinculo: processo
          ? { tipo: "processo_anm", valor: processo, proveniencia: "documento_oficial" }
          : (titular ? { tipo: "nome", valor: titular, proveniencia: "desconhecida" } : null),
        extras: { municipio, uf },
      }));
    }
  });

  // ── Certidões do titular (PGFN / CNJ DataJud / CEIS) ──

  app.get("/api/dossie/certidoes-titular", ensureAuth, async (req: Request, res: Response) => {
    const cnpj = String(req.query.cnpj || "").replace(/\D/g, "");
    try {
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      if (!cnpjValido(cnpj)) {
        return res.status(400).json(payloadFalhaConsulta({
          fonte: "Certidões do titular — PGFN, CNJ DataJud e CEIS",
          tierFonte: "T1",
          motivoFalha: "CNPJ inválido (14 dígitos e dígitos verificadores conferidos) — resolva o CNPJ do titular primeiro",
        }));
      }

      // Proveniência do CNPJ do vínculo: lê anmTitular.cnpjFonte do ativo
      // (org-checked). CNPJ resolvido por nome via agregador (CNPJA) propaga
      // "vinculação não confirmada por documento" às certidões derivadas dele.
      let identificadorVinculo: IdentificadorVinculo | null = null;
      const assetIdRaw = String(req.query.assetId || "").trim();
      if (/^\d+$/.test(assetIdRaw)) {
        try {
          const user = req.user as any;
          const asset = await storage.getAsset(Number(assetIdRaw));
          if (asset && asset.orgId === user?.orgId) {
            const tit = (asset.camposEspecificos as any)?.anmTitular?.titular;
            const cnpjAtivo = String(tit?.cnpj || "").replace(/\D/g, "");
            // só herda a proveniência se o CNPJ consultado é o mesmo gravado no ativo
            if (cnpjAtivo === cnpj) {
              identificadorVinculo = montarIdentificadorCnpj(cnpj, tit?.cnpjFonte || null);
            }
          }
        } catch { /* proveniência é best-effort — sem ela fica "desconhecida" */ }
      }

      // v2: cache separado por proveniência (o rótulo de vínculo integra o payload)
      const cacheKey = `certidoes_titular:v2:${cnpj}:${identificadorVinculo?.proveniencia || "sem_proveniencia"}`;
      if (!refresh) {
        const cached = await getCached<any>("anm_enrich", cacheKey);
        if (cached) return res.json(cached);
      }
      const certidoes = await consultarCertidoes(cnpj, identificadorVinculo);
      const result = { disponivel: true, ...certidoes, consultadoEm: new Date().toISOString() };
      // só cacheia quando nenhuma fonte falhou (evita fixar indisponibilidade)
      if (!certidoes.erros || certidoes.erros.length === 0) {
        await setCached("anm_enrich", cacheKey, result);
      }
      res.json(result);
    } catch (err: any) {
      console.error("[Certidões Titular] Erro:", err.message);
      res.json(payloadFalhaConsulta({
        fonte: "Certidões do titular — PGFN, CNJ DataJud e CEIS",
        tierFonte: "T1",
        motivoFalha: `Erro inesperado ao consultar certidões do titular: ${err?.message || String(err)}`,
        identificadorVinculo: cnpj.length === 14 ? montarIdentificadorCnpj(cnpj, null) : null,
      }));
    }
  });
}
