/**
 * Parecer consolidado v3 — fluxo "extrair, não narrar".
 *
 * O modelo NÃO escreve NENHUMA frase do corpo: ele apenas SELECIONA pares
 * {tipo, fatos} — um tipo de enunciado do catálogo fixo de templates
 * (CATALOGO_TIPOS_PARECER) e os fatos numerados que o sustentam. Cada frase
 * publicada é montada por template determinístico exclusivamente com texto
 * fixo + valores do catálogo de fatos; texto livre do modelo NUNCA é
 * publicado (fica, no máximo, como diagnóstico em erro registrado).
 * Campo vazio ⇒ a frase correspondente não existe.
 *
 * - Todo fato do catálogo carrega valor, fonte, data da consulta e
 *   identificador de vínculo; campo sem fonte é rejeitado como ERRO
 *   REGISTRADO (nunca null silencioso).
 * - Grandezas descritas por mais de uma fonte passam pelo detector de
 *   conflitos ANTES do catálogo: grandeza em conflito não vira fato — os
 *   dois valores são exibidos com flag de revisão humana (nunca escolhemos).
 * - Saída aceita: FATO/DERIVADO de fontes T1/T2. Hipóteses só existem em
 *   seção própria rotulada.
 */
import {
  detectarConflitos,
  detectarVocabularioProibido,
  normalizarTexto,
  type ChecagemContradicao,
  type ConflitoDetectado,
  type Enunciado,
  type GrandezaComparavel,
  type RemocaoAdversarial,
  type TierEnunciado,
} from "./enunciados";
import {
  buildProcessoAnmCampos,
  filtrarEventosReais,
  filtrarTahPorProcesso,
  montarQuadroCamadas,
  faixaAnosEscopo,
  type EscopoBases,
} from "./relatorio-vinculos";
import { separarPublicacoesDiario, separarBarragensTitular, avisoCertidoesVinculo } from "./consulta-contrato";
import { anexarVigenciaCalculada, obterVigenciaCalculada } from "./vigencia-alvara";

export interface FatoCatalogado {
  id: string; // "F1"…
  campo: string;
  valor: string;
  fonte: string;
  dataConsulta: string;
  identificador: string;
  tier: Extract<TierEnunciado, "T1" | "T2">;
}

export interface CatalogoFatos {
  fatos: FatoCatalogado[];
  conflitos: ConflitoDetectado[];
}

const fmtDataBr = (v: any): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("pt-BR");
};

const parseData = (v: any): Date | null => {
  if (!v) return null;
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const primeiro = (...vals: any[]): string | null => {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return null;
};

const fmtNumBr = (v: any, dec = 2): string => {
  const n = Number(v);
  if (v == null || v === "" || isNaN(n)) return String(v ?? "");
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
};

const fmtMoedaBr = (v: any): string => {
  const n = Number(v);
  if (v == null || v === "" || isNaN(n)) return String(v ?? "");
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

// ── Grandezas comparáveis entre fontes (conflitos) ──────────────

/** Monta as grandezas que descrevem o MESMO dado vindo de fontes diferentes
 *  (área, titular, fase, UF, substância) para o detector de conflitos. */
export function montarGrandezasProcesso(asset: any, c: any, scm: any | null): GrandezaComparavel[] {
  const live = c?.anmLiveData || {};
  const liveFeature = Array.isArray(live?.features) ? (live.features[0]?.attributes || live.features[0] || {}) : live;
  const g: GrandezaComparavel[] = [];

  g.push({
    grandeza: "Área do processo (ha)", tipo: "numero", toleranciaPct: 2,
    valores: [
      { valor: liveFeature?.AREA_HA, fonte: "SIGMINE" },
      { valor: scm?.areaHa, fonte: "SCM/ANM" },
      { valor: asset?.areaHa, fonte: "cadastro do ativo" },
    ],
  });
  g.push({
    grandeza: "Titular", tipo: "texto",
    valores: [
      { valor: liveFeature?.NOME, fonte: "SIGMINE" },
      { valor: scm?.titularNome, fonte: "SCM/ANM" },
    ],
  });
  g.push({
    grandeza: "Fase", tipo: "texto",
    valores: [
      { valor: c?.faseAnm, fonte: "cadastro do ativo" },
      { valor: liveFeature?.FASE, fonte: "SIGMINE" },
      { valor: scm?.fase, fonte: "SCM/ANM" },
    ],
  });
  g.push({
    grandeza: "UF", tipo: "texto",
    valores: [
      { valor: liveFeature?.UF, fonte: "SIGMINE" },
      { valor: scm?.uf, fonte: "SCM/ANM" },
    ],
  });
  g.push({
    grandeza: "Substância", tipo: "texto",
    valores: [
      { valor: c?.substancia, fonte: "cadastro do ativo" },
      { valor: liveFeature?.SUBS, fonte: "SIGMINE" },
    ],
  });
  return g;
}

// Rótulos de buildProcessoAnmCampos afetados por cada grandeza em conflito —
// grandeza conflitada NÃO vira fato (os dois valores vão para a seção de
// conflitos com flag de revisão humana).
const GRANDEZA_PARA_CAMPO: Record<string, string> = {
  "Área do processo (ha)": "Área (ha)",
  "Titular": "Titular",
  "Fase": "Fase",
  "UF": "UF",
  "Substância": "Substância",
};

// ── Catálogo de fatos ───────────────────────────────────────────

/**
 * Catálogo determinístico de fatos do dossiê: cada fato tem valor, fonte,
 * data da consulta, identificador e tier (T1 = fonte oficial consultada,
 * T2 = declarado no cadastro / vínculo indireto documentado).
 * Fato sem data de consulta rastreável NÃO entra (disciplina > cobertura).
 */
export function montarCatalogoFatos(asset: any): CatalogoFatos {
  asset = anexarVigenciaCalculada(asset);
  const c = (asset?.camposEspecificos || {}) as any;
  const scm = (asset as any)?.__scmData || null;
  const escopo: EscopoBases | null = (asset as any)?.__escopoBases || null;
  const processo: string | null = c.processoAnm || asset?.anmProcesso || null;
  const idBase = processo || `ativo ${asset?.id ?? ""}`.trim();
  const cadastroEm = fmtDataBr(asset?.createdAt);

  const grandezas = montarGrandezasProcesso(asset, c, scm);
  const conflitos = detectarConflitos(grandezas);
  const camposConflitados = new Set(conflitos.map((cf) => GRANDEZA_PARA_CAMPO[cf.grandeza]).filter(Boolean));

  const fatos: FatoCatalogado[] = [];
  const add = (campo: string, valor: any, fonte: string | null, data: any, tier: "T1" | "T2", identificador?: string | null) => {
    const v = primeiro(valor);
    const f = primeiro(fonte);
    const d = fmtDataBr(data);
    const idv = primeiro(identificador, idBase);
    if (!v || !f || !d || !idv) return; // sem fonte/data/id ⇒ não é fato publicável
    fatos.push({ id: `F${fatos.length + 1}`, campo, valor: v, fonte: f, dataConsulta: d, identificador: idv, tier });
  };

  // Identificação (cadastro)
  add("Título do ativo", asset?.title, "cadastro do ativo", asset?.createdAt, "T2", `ativo ${asset?.id ?? ""}`);
  add("Tipo do ativo", asset?.type, "cadastro do ativo", asset?.createdAt, "T2", `ativo ${asset?.id ?? ""}`);
  const local = [asset?.location, asset?.municipio, asset?.estado].filter(Boolean).join(" — ");
  add("Localização", local, "cadastro do ativo", asset?.createdAt, "T2", `ativo ${asset?.id ?? ""}`);
  add("Preço pedido", asset?.priceAsking != null ? fmtMoedaBr(asset.priceAsking) : null, "cadastro do ativo", asset?.createdAt, "T2", `ativo ${asset?.id ?? ""}`);
  add("Matrícula", asset?.matricula, "cadastro do ativo", asset?.createdAt, "T2", `ativo ${asset?.id ?? ""}`);

  // Nº do processo — identificador central do dossiê. Vira fato com a fonte
  // que o sustenta: SCM consultado (T1) ou, na falta, o cadastro datado (T2).
  if (processo) {
    if (scm?.consultadoEm) add("Nº do processo", processo, "SCM/ANM (consulta pública)", scm.consultadoEm, "T1", processo);
    else add("Nº do processo", processo, "cadastro do ativo", asset?.createdAt, "T2", processo);
  }

  // Processo ANM — fallback campo a campo com origem (cadastro/SIGMINE/SCM);
  // campos de grandeza em conflito ficam FORA do catálogo.
  const campos = buildProcessoAnmCampos(asset, c, scm);
  const vigenciaAlvara = obterVigenciaCalculada(asset);
  for (const cp of campos) {
    if (cp.label === "Validade" && vigenciaAlvara.status === "determinado") continue;
    if (camposConflitados.has(cp.label)) continue;
    const fonteTxt = cp.fonte || "cadastro do ativo";
    const ehLive = /SIGMINE/i.test(fonteTxt);
    const ehScm = /SCM/i.test(fonteTxt);
    const data = ehLive ? c.anmLiveDataUpdatedAt : ehScm ? scm?.consultadoEm : asset?.createdAt;
    add(cp.label, cp.valor, fonteTxt, data, ehLive || ehScm ? "T1" : "T2", processo);
  }

  if (vigenciaAlvara.status === "determinado") {
    const dataFonteVigencia = primeiro(
      c.anmHistorico?.consultadoEm,
      c.anmHistoricoUpdatedAt,
      scm?.consultadoEm,
      c.anmLiveDataUpdatedAt,
    );
    add(
      "Validade",
      vigenciaAlvara.dataVigenciaAtual,
      `${vigenciaAlvara.fonte} — cálculo determinístico`,
      dataFonteVigencia,
      "T1",
      processo,
    );
    add(
      "Memória de cálculo da vigência",
      vigenciaAlvara.memoriaCalculo,
      `${vigenciaAlvara.fonte} — cálculo determinístico`,
      dataFonteVigencia,
      "T1",
      processo,
    );
  }

  // Eventos ANM — último evento real
  const eventos = filtrarEventosReais(c.anmHistorico?.eventos, processo) as any[];
  if (eventos.length > 0) {
    const comData = eventos
      .map((e) => ({ e, d: parseData(e?.data) }))
      .filter((x) => x.d) as Array<{ e: any; d: Date }>;
    const ultimo = comData.length > 0 ? comData.reduce((a, b) => (b.d > a.d ? b : a)) : null;
    add(
      "Eventos do processo (Cadastro Mineiro)",
      ultimo
        ? `${eventos.length} evento(s); último: ${String(ultimo.e.descricao || "").slice(0, 140)} em ${fmtDataBr(ultimo.e.data)}`
        : `${eventos.length} evento(s) registrados`,
      c.anmHistorico?.fonte || "Eventos ANM (Cadastro Mineiro)",
      c.anmHistorico?.consultadoEm ?? c.anmHistoricoUpdatedAt ?? c.anmLiveDataUpdatedAt,
      "T1",
      processo,
    );
  }

  // TAH — só vínculo não-ambíguo (número completo)
  const tahV = filtrarTahPorProcesso(c.anmTah, processo);
  if (!tahV.ambiguo && Array.isArray(tahV.rows) && tahV.rows.length > 0) {
    const anos = tahV.rows.map((r: any) => Number(r?.ano_base ?? r?.anoBase)).filter((n: number) => Number.isFinite(n));
    const faixa = anos.length > 0 ? `${Math.min(...anos)}–${Math.max(...anos)}` : "—";
    add(
      "TAH do processo",
      `${tahV.rows.length} registro(s) de TAH, anos-base ${faixa} (cobertura da base: ${faixaAnosEscopo(escopo?.tah)})`,
      "Base TAH/ANM (dados abertos importados)",
      primeiro(c.anmTah?.consultadoEm, c.anmTah?.importadoEm, c.anmTah?.atualizadoEm) ?? "importação local — ver Escopo das bases",
      "T1",
      processo,
    );
  }

  // CFEM — resposta válida nos dois sentidos, limitada à cobertura da base
  const cfem = c.anmCfem;
  if (cfem?.disponivel && cfem.processo) {
    const p = cfem.processo;
    let valor: string;
    if (p.jaProduziu) {
      const anosCfem = (Array.isArray(p.porAno) ? p.porAno : []).map((x: any) => Number(x?.ano)).filter((n: number) => Number.isFinite(n));
      const ult = anosCfem.length > 0 ? Math.max(...anosCfem) : null;
      valor = `CFEM recolhida pelo processo: total ${fmtMoedaBr(p.totalRecolhido)}${ult ? `, último ano com recolhimento: ${ult}` : ""}`;
    } else {
      valor = `Sem recolhimento de CFEM pelo processo na base coberta (${faixaAnosEscopo(escopo?.cfem)}) — sem produção comercializada registrada nesse período`;
    }
    add("CFEM (produção real)", valor, cfem.fonte || "CFEM/ANM (dados abertos)", primeiro(cfem.consultadoEm) ?? "importação local — ver Escopo das bases", "T1", processo);
  }

  // DOU — só publicações casadas pelo número do processo
  if (c.anmDou?.disponivel) {
    const { confirmadas } = separarPublicacoesDiario(c.anmDou, processo);
    if (confirmadas.length > 0) {
      const datas = confirmadas.map((p: any) => p?.data).filter(Boolean);
      add(
        "Publicações no DOU (vinculadas ao processo)",
        `${confirmadas.length} publicação(ões) casada(s) pelo número do processo${datas.length > 0 ? `; mais recente: ${datas[0]}` : ""}`,
        c.anmDou.fonte || "Imprensa Nacional (DOU)",
        c.anmDou.consultadoEm,
        "T1",
        processo,
      );
    }
  }

  // SEI — processo administrativo (cache da pesquisa pública)
  const sei = c.anmSei;
  if (sei?.disponivel) {
    const docs = Array.isArray(sei.documentos) ? sei.documentos.length : 0;
    const ands = Array.isArray(sei.andamentos) ? sei.andamentos.length : 0;
    add(
      "SEI — processo administrativo",
      `NUP ${primeiro(sei.nupFormatado, sei.nup) ?? "—"}${sei.tipoProcedimento ? `, tipo: ${sei.tipoProcedimento}` : ""}; ${docs} documento(s) e ${ands} andamento(s) na lista pública`,
      "SEI/ANM (pesquisa pública, cache)",
      primeiro(sei.consultadoEm, sei.dataGeracao),
      "T1",
      primeiro(sei.nupFormatado, sei.nup, processo),
    );
  }

  // Certidões do titular — só com vínculo do CNPJ confirmado por documento
  const cert = c.anmCertidoesTitular;
  if (cert?.disponivel && !avisoCertidoesVinculo(cert)) {
    if (cert.pgfn) {
      add(
        "Dívida ativa (PGFN)",
        cert.pgfn.temDebitoAtivo ? `POSSUI dívida ativa — ${cert.pgfn.situacao || "situação registrada na fonte"}` : (cert.pgfn.situacao || "Sem débitos inscritos"),
        "PGFN (dados abertos de dívida ativa)",
        cert.consultadoEm,
        "T1",
        cert.cnpj,
      );
    }
    if (cert.cnj) {
      add("Processos judiciais (DataJud/CNJ)", `${cert.cnj.totalProcessos ?? 0} processo(s) localizados`, "DataJud/CNJ", cert.consultadoEm, "T1", cert.cnpj);
    }
    if (cert.ceis) {
      add(
        "Sanções (CEIS)",
        cert.ceis.sancionado ? `SANCIONADO — ${(cert.ceis.sancoes || []).length} sanção(ões) vigente(s)` : "Nenhuma sanção vigente",
        "CEIS (Portal da Transparência)",
        cert.consultadoEm,
        "T1",
        cert.cnpj,
      );
    }
  }

  // Barragens — só as vinculadas ao titular por CNPJ
  if (c.anmBarragens?.disponivel) {
    const { confirmadas } = separarBarragensTitular(c.anmBarragens);
    if (confirmadas.length > 0) {
      add(
        "Barragens do titular (SIGBM)",
        `${confirmadas.length} barragem(ns) vinculada(s) ao titular por CNPJ`,
        c.anmBarragens.fonte || "SIGBM/ANM",
        c.anmBarragens.consultadoEm,
        "T1",
        processo,
      );
    }
  }

  // Restrições — camadas com ocorrência/sobreposição (data exigida)
  if (c.anmRestricoes || c.anmFunai || c.anmFunaiTerras) {
    const quadro = montarQuadroCamadas(c);
    const dataRestr = primeiro(c.anmRestricoes?.consultadoEm, c.anmRestricoes?.consultado_em, c.anmFunaiTerras?.consultadoEm);
    if (dataRestr) {
      for (const l of quadro.linhas) {
        if (!l.consultada) continue;
        if (l.status === "SOBREPOSIÇÃO DIRETA" || /ocorrência\(s\)/.test(l.status)) {
          add(
            `Restrição — ${l.label}`,
            `${l.status}${l.destaque ? ` (${l.destaque})` : ""}`,
            "Cruzamento de restrições (INDE/IBGE/órgãos oficiais)",
            dataRestr,
            "T1",
            processo,
          );
        }
      }
    }
  }

  // Fundiário — SIGEF / CAR / CCIR consolidado
  const sigef = c.sigefParcelas;
  if (sigef) {
    const cob = sigef.coberturaPct != null ? `${fmtNumBr(sigef.coberturaPct)}% de cobertura certificada` : "cobertura a verificar";
    add(
      "SIGEF — parcelas certificadas",
      `${fmtNumBr(sigef.totalSobrepostas ?? 0, 0)} parcela(s) sobre o processo, ${cob}`,
      sigef.fonte || "SIGEF/INCRA",
      sigef.consultadoEm,
      "T1",
      processo,
    );
  }
  const car = c.carImoveis;
  if (car) {
    add(
      "CAR — imóveis declarados",
      `${fmtNumBr(car.totalSobrepostos ?? 0, 0)} imóvel(is) CAR sobre o processo${car.coberturaPct != null ? `, ${fmtNumBr(car.coberturaPct)}% de cobertura` : ""}`,
      car.fonte || "SICAR",
      car.consultadoEm,
      "T1",
      processo,
    );
  }
  if (c.ccirCodigoIncra) {
    add("CCIR/INCRA", `Código INCRA ${c.ccirCodigoIncra}${c.ccirDenominacao ? ` — ${c.ccirDenominacao}` : ""}`, "CCIR/INCRA", c.ccirConsultadoEm, "T1", String(c.ccirCodigoIncra));
  }

  // Terreno (análise geográfica própria sobre o polígono)
  if (asset?.geoAltMed != null) {
    add(
      "Terreno — altitude/declividade",
      `Altitude média ${fmtNumBr(asset.geoAltMed)} m${asset.geoDeclivityMed != null ? `; declividade média ${fmtNumBr(asset.geoDeclivityMed)}%` : ""}`,
      "Análise geográfica do polígono (SRTM/OSM)",
      asset.geoAnalyzedAt,
      "T1",
      idBase,
    );
  }

  return { fatos, conflitos };
}

/** Catálogo formatado para o prompt do modelo — uma linha por fato. */
export function formatarCatalogoParaPrompt(fatos: FatoCatalogado[]): string {
  return fatos
    .map((f) => `${f.id} | ${f.campo}: ${f.valor} | fonte: ${f.fonte} | consulta: ${f.dataConsulta} | id: ${f.identificador} | ${f.tier}`)
    .join("\n");
}

// ── Catálogo fixo de templates (tipos de enunciado publicáveis) ─
//
// Única forma de um item do modelo virar frase do corpo: selecionar um tipo
// daqui e citar fatos que satisfaçam a regra do tipo. A frase publicada é
// SEMPRE a saída de `montar` — texto fixo + valores dos fatos citados.
// Texto livre do modelo nunca chega ao corpo do relatório.

export interface TipoEnunciadoParecer {
  /** Orientação exibida ao modelo no prompt (quando selecionar o tipo). */
  quandoUsar: string;
  /** Regra determinística exibível junto do enunciado publicado. */
  regra: string;
  /** Seleciona os fatos-âncora entre os citados; null ⇒ regra não satisfeita. */
  selecionar: (citados: FatoCatalogado[]) => FatoCatalogado[] | null;
  /** Monta a frase apenas com texto fixo + valores dos fatos-âncora. */
  montar: (ancoras: FatoCatalogado[]) => string;
}

const refConsulta = (f: FatoCatalogado) => `(${f.fonte}, consulta em ${f.dataConsulta})`;

const umPorCampo = (campo: string) => (citados: FatoCatalogado[]) => {
  const f = citados.find((x) => x.campo === campo);
  return f ? [f] : null;
};
const umPorCampoComValor = (campo: string, padraoNormalizado: RegExp) => (citados: FatoCatalogado[]) => {
  const f = citados.find((x) => x.campo === campo && padraoNormalizado.test(normalizarTexto(x.valor)));
  return f ? [f] : null;
};
const umPorPrefixo = (prefixo: string) => (citados: FatoCatalogado[]) => {
  const f = citados.find((x) => x.campo.startsWith(prefixo));
  return f ? [f] : null;
};
const primeiroCitado = (citados: FatoCatalogado[]) => (citados.length > 0 ? [citados[0]] : null);

const PENDENCIAS_TITULAR: Array<[string, RegExp]> = [
  ["Dívida ativa (PGFN)", /possui divida ativa/],
  ["Sanções (CEIS)", /^sancionado/],
  ["Processos judiciais (DataJud/CNJ)", /^[1-9]\d* processo/],
];
const umaPendenciaTitular = (citados: FatoCatalogado[]) => {
  const f = citados.find((x) => PENDENCIAS_TITULAR.some(([campo, padrao]) => x.campo === campo && padrao.test(normalizarTexto(x.valor))));
  return f ? [f] : null;
};

export const CATALOGO_TIPOS_PARECER: Record<
  "prioridades" | "riscos" | "encaminhamentos",
  Record<string, TipoEnunciadoParecer>
> = {
  prioridades: {
    verificar_na_fonte: {
      quandoUsar: "o dado que o comprador deve confirmar primeiro na fonte primária (cite exatamente o fato a confirmar)",
      regra: "frase montada por template fixo sobre o primeiro fato citado, sem juízo adicional",
      selecionar: primeiroCitado,
      montar: ([f]) => `Confirmar na fonte primária: ${f.campo} — registro atual: ${f.valor} ${refConsulta(f)}.`,
    },
    confirmar_titularidade: {
      quandoUsar: "quando o catálogo tem o fato 'Titular' e a titularidade é decisiva para a transação",
      regra: "aplicável somente com o fato 'Titular' entre os citados; template fixo sobre esse fato",
      selecionar: umPorCampo("Titular"),
      montar: ([f]) => `Confirmar a titularidade do processo: ${f.valor} ${refConsulta(f)}.`,
    },
    verificar_validade: {
      quandoUsar: "quando o catálogo tem o fato 'Validade' (prazo do título) e ele precisa de conferência",
      regra: "aplicável somente com o fato 'Validade' entre os citados; template fixo sobre esse fato",
      selecionar: umPorCampo("Validade"),
      montar: ([f]) => `Verificar o prazo registrado do título: validade ${f.valor} ${refConsulta(f)}.`,
    },
  },
  riscos: {
    fase_sem_titulo_de_lavra: {
      quandoUsar: "quando o valor do fato 'Fase' contém requerimento, pesquisa ou disponibilidade (não há concessão de lavra vigente)",
      regra: "aplicável somente quando o valor do fato 'Fase' contém 'requerimento', 'pesquisa' ou 'disponibilidade'",
      selecionar: umPorCampoComValor("Fase", /requerimento|pesquisa|disponibilidade/),
      montar: ([f]) => `Fase atual do processo: "${f.valor}" ${refConsulta(f)} — não há concessão de lavra vigente nessa fase.`,
    },
    divida_ativa_titular: {
      quandoUsar: "quando o fato 'Dívida ativa (PGFN)' registra POSSUI dívida ativa",
      regra: "aplicável somente quando o valor do fato 'Dívida ativa (PGFN)' contém 'possui dívida ativa'",
      selecionar: umPorCampoComValor("Dívida ativa (PGFN)", /possui divida ativa/),
      montar: ([f]) => `Pendência fiscal do titular — ${f.campo}: ${f.valor} ${refConsulta(f)}.`,
    },
    sancao_vigente_titular: {
      quandoUsar: "quando o fato 'Sanções (CEIS)' registra SANCIONADO",
      regra: "aplicável somente quando o valor do fato 'Sanções (CEIS)' começa com 'sancionado'",
      selecionar: umPorCampoComValor("Sanções (CEIS)", /^sancionado/),
      montar: ([f]) => `Sanção vigente do titular — ${f.campo}: ${f.valor} ${refConsulta(f)}.`,
    },
    processos_judiciais_titular: {
      quandoUsar: "quando o fato 'Processos judiciais (DataJud/CNJ)' registra 1 ou mais processos localizados",
      regra: "aplicável somente quando o valor do fato 'Processos judiciais (DataJud/CNJ)' registra contagem maior que zero",
      selecionar: umPorCampoComValor("Processos judiciais (DataJud/CNJ)", /^[1-9]\d* processo/),
      montar: ([f]) => `Litígios do titular — ${f.campo}: ${f.valor} ${refConsulta(f)}.`,
    },
    restricao_socioambiental: {
      quandoUsar: "um por fato 'Restrição — …' do catálogo (camada com ocorrência/sobreposição)",
      regra: "aplicável somente com um fato 'Restrição — …' entre os citados; template fixo sobre esse fato",
      selecionar: umPorPrefixo("Restrição — "),
      montar: ([f]) => `Restrição sobre a área do processo — ${f.campo.replace(/^Restrição — /, "")}: ${f.valor} ${refConsulta(f)}.`,
    },
    sem_producao_registrada: {
      quandoUsar: "quando o fato 'CFEM (produção real)' registra ausência de recolhimento no período coberto",
      regra: "aplicável somente quando o valor do fato 'CFEM (produção real)' começa com 'sem recolhimento'",
      selecionar: umPorCampoComValor("CFEM (produção real)", /^sem recolhimento/),
      montar: ([f]) => `${f.valor} ${refConsulta(f)}.`,
    },
    barragem_do_titular: {
      quandoUsar: "quando o catálogo tem o fato 'Barragens do titular (SIGBM)'",
      regra: "aplicável somente com o fato 'Barragens do titular (SIGBM)' entre os citados; template fixo sobre esse fato",
      selecionar: umPorCampo("Barragens do titular (SIGBM)"),
      montar: ([f]) => `Responsabilidade do titular por barragem de mineração: ${f.valor} ${refConsulta(f)}.`,
    },
  },
  encaminhamentos: {
    consultar_fonte_primaria: {
      quandoUsar: "próximo passo objetivo: reconsultar um registro do catálogo na fonte primária",
      regra: "frase montada por template fixo sobre o primeiro fato citado, sem juízo adicional",
      selecionar: primeiroCitado,
      montar: ([f]) => `Reconsultar "${f.campo}" na fonte primária (${f.fonte}) — registro atual, de ${f.dataConsulta}: ${f.valor}.`,
    },
    tratar_pendencia_titular: {
      quandoUsar: "quando um fato de pendência do titular (PGFN possui dívida / CEIS sancionado / DataJud com processos) está no catálogo",
      regra: "aplicável somente com fato de pendência do titular (PGFN 'possui dívida ativa', CEIS 'sancionado' ou DataJud com contagem > 0) entre os citados",
      selecionar: umaPendenciaTitular,
      montar: ([f]) => `Endereçar antes da transação a pendência registrada do titular — ${f.campo}: ${f.valor} ${refConsulta(f)}.`,
    },
    aprofundar_restricao: {
      quandoUsar: "um por fato 'Restrição — …' que exige manifestação do órgão responsável",
      regra: "aplicável somente com um fato 'Restrição — …' entre os citados; template fixo sobre esse fato",
      selecionar: umPorPrefixo("Restrição — "),
      montar: ([f]) => `Obter manifestação do órgão responsável sobre "${f.campo.replace(/^Restrição — /, "")}": ${f.valor} ${refConsulta(f)}.`,
    },
    acompanhar_movimentacao: {
      quandoUsar: "quando o catálogo tem movimentação registrada (Eventos do processo ou SEI)",
      regra: "aplicável somente com o fato 'Eventos do processo (Cadastro Mineiro)' ou 'SEI — processo administrativo' entre os citados",
      selecionar: (citados) => {
        const f = citados.find((x) => x.campo === "Eventos do processo (Cadastro Mineiro)" || x.campo === "SEI — processo administrativo");
        return f ? [f] : null;
      },
      montar: ([f]) => `Acompanhar a movimentação registrada do processo — ${f.valor} ${refConsulta(f)}.`,
    },
  },
};

/** Catálogo de tipos formatado para o prompt do modelo. */
export function formatarTiposParaPrompt(): string {
  const linhas: string[] = [];
  for (const secao of ["prioridades", "riscos", "encaminhamentos"] as const) {
    linhas.push(`${secao}:`);
    for (const [tipo, def] of Object.entries(CATALOGO_TIPOS_PARECER[secao])) {
      linhas.push(`- "${tipo}": ${def.quandoUsar}`);
    }
  }
  return linhas.join("\n");
}

// ── Validação dos itens selecionados pelo modelo ────────────────

export interface ItemParecerBruto {
  tipo?: any;
  fatos?: any;
  texto?: any; // ignorado para publicação — no máximo diagnóstico de rejeição
  motivo?: any;
}

export interface ErroRegistrado {
  campo: string;
  motivo: string;
  texto: string;
}

export interface ViolacaoVocabulario {
  campo: string;
  texto: string;
  termos: string[];
}

export interface ItemParecerValidado {
  tipo: string;
  /** Frase publicável — SEMPRE a saída do template do tipo, nunca texto do modelo. */
  texto: string;
  /** Fatos-âncora efetivamente usados pelo template. */
  fatos: string[];
}

export interface ParecerValidado {
  prioridades: ItemParecerValidado[];
  riscos: ItemParecerValidado[];
  encaminhamentos: ItemParecerValidado[];
  hipoteses: Array<{ texto: string; motivo: string | null }>;
  erros: ErroRegistrado[];
  violacoes: ViolacaoVocabulario[];
}

const MAX_ITENS_POR_CAMPO = 8;
const MAX_CHARS_ITEM = 700;

/**
 * Valida a seleção do modelo contra o catálogo de fatos E o catálogo de
 * tipos. O texto do modelo NUNCA é publicado:
 * - tipo ausente/fora do catálogo ⇒ erro registrado (texto livre não publica);
 * - item sem NENHUM fato válido citado ⇒ erro registrado (nunca null
 *   silencioso);
 * - fatos citados que não satisfazem a regra do tipo ⇒ erro registrado;
 * - a frase validada é a saída do template (`montar`) sobre os fatos-âncora;
 * - vocabulário proibido na frase montada (valor de fonte contaminado) ⇒
 *   violação com direito a um reprocesso; persistindo, vira lacuna declarada;
 * - hipóteses não exigem fato (são conjecturas rotuladas), só texto — e só
 *   aparecem em seção própria, nunca no corpo.
 */
export function validarParecerEstruturado(bruto: any, fatos: FatoCatalogado[]): ParecerValidado {
  const porId = new Map(fatos.map((f) => [f.id, f]));
  const erros: ErroRegistrado[] = [];
  const violacoes: ViolacaoVocabulario[] = [];

  const validarCampo = (campo: "prioridades" | "riscos" | "encaminhamentos"): ItemParecerValidado[] => {
    const arr = Array.isArray(bruto?.[campo]) ? bruto[campo] : [];
    const tiposDaSecao = CATALOGO_TIPOS_PARECER[campo];
    const validos: ItemParecerValidado[] = [];
    const vistos = new Set<string>();
    for (const raw of arr.slice(0, MAX_ITENS_POR_CAMPO * 2)) {
      const item = raw as ItemParecerBruto;
      const diagnostico = (String(item?.texto ?? "").trim() || JSON.stringify({ tipo: item?.tipo, fatos: item?.fatos })).slice(0, MAX_CHARS_ITEM);
      const tipo = String(item?.tipo ?? "").trim();
      const def = tipo ? tiposDaSecao[tipo] : undefined;
      if (!def) {
        erros.push({
          campo,
          motivo: tipo
            ? `tipo "${tipo}" fora do catálogo de templates — texto livre do modelo não é publicável`
            : "item sem tipo do catálogo de templates — texto livre do modelo não é publicável",
          texto: diagnostico,
        });
        continue;
      }
      const citados = (Array.isArray(item?.fatos) ? item.fatos : [])
        .map((x: any) => porId.get(String(x).trim().toUpperCase()))
        .filter(Boolean) as FatoCatalogado[];
      if (citados.length === 0) {
        erros.push({
          campo,
          motivo: "enunciado sem fonte — nenhum fato válido do catálogo citado (campo rejeitado e registrado como erro)",
          texto: diagnostico,
        });
        continue;
      }
      const ancoras = def.selecionar(citados);
      if (!ancoras || ancoras.length === 0) {
        erros.push({
          campo,
          motivo: `fatos citados não satisfazem a regra do tipo "${tipo}" (${def.regra}) — template não montável`,
          texto: diagnostico,
        });
        continue;
      }
      const texto = def.montar(ancoras).slice(0, MAX_CHARS_ITEM);
      const chave = `${tipo}|${ancoras.map((f) => f.id).sort().join(",")}`;
      if (vistos.has(chave) || vistos.has(texto)) continue;
      vistos.add(chave);
      vistos.add(texto);
      const termos = detectarVocabularioProibido(texto);
      if (termos.length > 0) {
        violacoes.push({ campo, texto, termos });
        continue;
      }
      if (validos.length < MAX_ITENS_POR_CAMPO) validos.push({ tipo, texto, fatos: ancoras.map((f) => f.id) });
    }
    return validos;
  };

  const hipoteses: Array<{ texto: string; motivo: string | null }> = (Array.isArray(bruto?.hipoteses) ? bruto.hipoteses : [])
    .map((h: any) => ({
      texto: String(h?.texto ?? "").trim().slice(0, MAX_CHARS_ITEM),
      motivo: primeiro(h?.motivo),
    }))
    .filter((h: any) => h.texto)
    .slice(0, 6);

  return {
    prioridades: validarCampo("prioridades"),
    riscos: validarCampo("riscos"),
    encaminhamentos: validarCampo("encaminhamentos"),
    hipoteses,
    erros,
    violacoes,
  };
}

// ── Montagem por template (determinística) ──────────────────────

const tierPior = (tiers: Array<"T1" | "T2">): "T1" | "T2" => (tiers.includes("T2") ? "T2" : "T1");

const juntarFontes = (fs: FatoCatalogado[]): { fonte: string; dataConsulta: string; identificador: string } => {
  const fontes = Array.from(new Set(fs.map((f) => f.fonte)));
  const datas = fs.map((f) => ({ raw: f.dataConsulta, d: parseData(f.dataConsulta) }));
  const comData = datas.filter((x) => x.d) as Array<{ raw: string; d: Date }>;
  const maisRecente = comData.length > 0 ? comData.reduce((a, b) => (b.d > a.d ? b : a)).raw : datas[0]?.raw ?? "";
  return { fonte: fontes.join("; "), dataConsulta: maisRecente, identificador: fs[0]?.identificador ?? "" };
};

function enunciadoDeFatos(texto: string, fs: FatoCatalogado[], origem: string): Enunciado {
  const j = juntarFontes(fs);
  return {
    categoria: "FATO",
    tier: tierPior(fs.map((f) => f.tier)),
    texto,
    fonte: j.fonte,
    dataConsulta: j.dataConsulta,
    identificador: j.identificador,
    insumos: fs.map((f) => f.id),
    origem,
  };
}

/**
 * Síntese determinística do dossiê — frases montadas por template a partir
 * do catálogo de fatos. Campo vazio ⇒ a frase correspondente NÃO existe
 * (sem contorno, sem menção vaga).
 */
export function montarSintese(fatos: FatoCatalogado[]): Enunciado[] {
  const por = (campo: string) => fatos.find((f) => f.campo === campo);
  const frases: Enunciado[] = [];

  // Identificação
  {
    const t = por("Título do ativo");
    const tipo = por("Tipo do ativo");
    const loc = por("Localização");
    const usados = [t, tipo, loc].filter(Boolean) as FatoCatalogado[];
    if (t) {
      const partes = [`Ativo "${t.valor}"`];
      if (tipo) partes.push(`(${tipo.valor})`);
      if (loc) partes.push(`— ${loc.valor}`);
      frases.push(enunciadoDeFatos(`${partes.join(" ")}.`, usados, "sintese"));
    }
  }

  // Processo minerário
  {
    const num = por("Nº do processo");
    const detalhes: Array<[string, FatoCatalogado | undefined]> = [
      ["fase", por("Fase")],
      ["situação", por("Situação")],
      ["titular", por("Titular")],
      ["área", por("Área (ha)")],
      ["substância", por("Substância")],
      ["UF", por("UF")],
      ["validade cadastrada", por("Validade")],
    ];
    const presentes = detalhes.filter(([, f]) => f) as Array<[string, FatoCatalogado]>;
    if (num && presentes.length > 0) {
      const corpoTxt = presentes.map(([rotulo, f]) => `${rotulo}: ${f.valor}${rotulo === "área" ? " ha" : ""}`).join("; ");
      frases.push(enunciadoDeFatos(`Processo ANM ${num.valor} — ${corpoTxt}.`, [num, ...presentes.map(([, f]) => f)], "sintese"));
    }
  }

  // Movimentação, obrigações e publicações — uma frase por fato existente
  const diretos: Array<[string, (f: FatoCatalogado) => string]> = [
    ["Eventos do processo (Cadastro Mineiro)", (f) => `Movimentação no Cadastro Mineiro: ${f.valor}.`],
    ["TAH do processo", (f) => `${f.valor}.`],
    ["CFEM (produção real)", (f) => `${f.valor}.`],
    ["Publicações no DOU (vinculadas ao processo)", (f) => `${f.valor}.`],
    ["SEI — processo administrativo", (f) => `${f.valor}.`],
    ["Dívida ativa (PGFN)", (f) => `Dívida ativa (PGFN) do titular: ${f.valor}.`],
    ["Processos judiciais (DataJud/CNJ)", (f) => `Processos judiciais do titular (DataJud/CNJ): ${f.valor}.`],
    ["Sanções (CEIS)", (f) => `Sanções (CEIS) do titular: ${f.valor}.`],
    ["Barragens do titular (SIGBM)", (f) => `${f.valor}.`],
    ["SIGEF — parcelas certificadas", (f) => `Base fundiária (SIGEF): ${f.valor}.`],
    ["CAR — imóveis declarados", (f) => `Base fundiária (CAR): ${f.valor}.`],
    ["Terreno — altitude/declividade", (f) => `${f.valor}.`],
  ];
  for (const [campo, template] of diretos) {
    const f = por(campo);
    if (f) frases.push(enunciadoDeFatos(template(f), [f], "sintese"));
  }

  return frases;
}

/** Converte um item validado (tipo + fatos-âncora) em Enunciado DERIVADO com
 *  a regra do template e os insumos exibíveis (os fatos usados). */
export function itemParaEnunciado(
  item: ItemParecerValidado,
  origem: "prioridade" | "risco" | "encaminhamento",
  fatosPorId: Map<string, FatoCatalogado>,
): Enunciado {
  const citados = item.fatos.map((id) => fatosPorId.get(id)).filter(Boolean) as FatoCatalogado[];
  const j = juntarFontes(citados);
  const secao = origem === "prioridade" ? "prioridades" : origem === "risco" ? "riscos" : "encaminhamentos";
  const def = CATALOGO_TIPOS_PARECER[secao][item.tipo];
  return {
    categoria: "DERIVADO",
    tier: tierPior(citados.map((f) => f.tier)),
    texto: item.texto,
    fonte: j.fonte,
    dataConsulta: j.dataConsulta,
    identificador: j.identificador,
    regra: `template determinístico "${item.tipo}" montado exclusivamente com os fatos citados (${item.fatos.join(", ")})${def ? ` — ${def.regra}` : ""}`,
    insumos: citados.map((f) => `${f.id} — ${f.campo}: ${f.valor}`),
    origem,
    templateId: item.tipo,
    fatosIds: item.fatos,
  };
}

/**
 * Remonta um DERIVADO persistido a partir de templateId+fatosIds. O campo
 * `texto` persistido é deliberadamente ignorado: mesmo um payload adulterado
 * não consegue publicar prosa que não seja produzida pelo template.
 */
export function reconstruirEnunciadoPersistido(
  persistido: any,
  origem: "prioridade" | "risco" | "encaminhamento",
  fatos: FatoCatalogado[],
): Enunciado | null {
  const campo = origem === "prioridade" ? "prioridades" : origem === "risco" ? "riscos" : "encaminhamentos";
  const validado = validarParecerEstruturado({
    [campo]: [{ tipo: persistido?.templateId, fatos: persistido?.fatosIds }],
  }, fatos);
  const item = validado[campo][0];
  if (!item) return null;
  return itemParaEnunciado(item, origem, new Map(fatos.map((f) => [f.id, f])));
}

/** Riscos que independem de seleção do modelo: cada fato de restrição
 * socioambiental vira um item do template fixo correspondente. */
export function montarRiscosDeterministicos(fatos: FatoCatalogado[]): ItemParecerValidado[] {
  return fatos
    .filter((f) => f.campo.startsWith("Restrição — "))
    .map((f) => ({
      tipo: "restricao_socioambiental",
      fatos: [f.id],
      texto: CATALOGO_TIPOS_PARECER.riscos.restricao_socioambiental.montar([f]),
    }));
}

// ── Contradições estruturadas (guardas para o passo adversarial) ─

/** Guardas determinísticas: padrões que, se aparecerem num enunciado,
 *  contradizem um dado estruturado do dossiê. Aplicados sobre texto
 *  normalizado (minúsculas, sem acento). */
export function montarContradicoes(asset: any): ChecagemContradicao[] {
  const c = (asset?.camposEspecificos || {}) as any;
  const processo: string | null = c.processoAnm || asset?.anmProcesso || null;
  const guardas: ChecagemContradicao[] = [];

  const cfemProc = c.anmCfem?.disponivel ? c.anmCfem?.processo : null;
  if (cfemProc?.jaProduziu) {
    guardas.push({
      descricao: "a base CFEM registra recolhimentos do processo (produção comercializada)",
      padrao: /nunca (recolheu|produziu)|sem recolhimento de cfem|sem producao comercializada/,
    });
  } else if (cfemProc && !cfemProc.jaProduziu) {
    guardas.push({
      descricao: "a base CFEM NÃO registra recolhimento do processo no período coberto",
      padrao: /\bcfem recolhida\b|\brecolheu cfem\b|\bproducao comercializada registrada\b/,
    });
  }

  const tahV = filtrarTahPorProcesso(c.anmTah, processo);
  if (!tahV.ambiguo && Array.isArray(tahV.rows) && tahV.rows.length > 0) {
    guardas.push({
      descricao: "há registros de TAH vinculados ao processo na base importada",
      padrao: /nenhum registro de tah|sem registro de tah|nao ha registro de tah/,
    });
  }

  if (c.anmRestricoes || c.anmFunai || c.anmFunaiTerras) {
    const quadro = montarQuadroCamadas(c);
    const temOcorrencia = quadro.linhas.some((l) => l.consultada && (l.status === "SOBREPOSIÇÃO DIRETA" || /ocorrência\(s\)/.test(l.status)));
    if (temOcorrencia) {
      guardas.push({
        descricao: "o quadro de restrições registra ocorrência/sobreposição em pelo menos uma camada",
        padrao: /sem restricoes|nenhuma restricao|livre de restricoes|sem ocorrencias em todas as camadas/,
      });
    }
  }

  if (c.anmDou?.disponivel) {
    const { confirmadas } = separarPublicacoesDiario(c.anmDou, processo);
    if (confirmadas.length > 0) {
      guardas.push({
        descricao: "há publicações no DOU casadas pelo número do processo",
        padrao: /nenhuma publicacao no dou|sem publicacoes no dou/,
      });
    }
  }

  const cert = c.anmCertidoesTitular;
  if (cert?.disponivel && !avisoCertidoesVinculo(cert) && cert.pgfn) {
    if (cert.pgfn.temDebitoAtivo) {
      guardas.push({
        descricao: "a PGFN registra dívida ativa do titular",
        padrao: /sem divida ativa|sem debitos inscritos|nada consta na pgfn/,
      });
    } else {
      guardas.push({
        descricao: "a PGFN NÃO registra dívida ativa do titular na consulta realizada",
        padrao: /possui divida ativa|inscrito em divida ativa/,
      });
    }
  }

  return guardas;
}

// ── Payload persistido (v3) ─────────────────────────────────────

export const PARECER_VERSAO = 3 as const;

export interface ParecerConsolidado {
  versao: typeof PARECER_VERSAO;
  insumosHash: string;
  geradoEm: string;
  modelo: string;
  /** Frases determinísticas montadas por template a partir do catálogo. */
  sintese: Enunciado[];
  /** Itens selecionados pelo modelo (tipo+fatos), montados por template e convertidos em DERIVADOS. */
  prioridades: Enunciado[];
  riscos: Enunciado[];
  encaminhamentos: Enunciado[];
  /** Conjecturas rotuladas — nunca entram no corpo. */
  hipoteses: Array<{ texto: string; motivo: string | null }>;
  /** Catálogo usado na geração (para exibir refs de forma estável). */
  fatos: FatoCatalogado[];
  /** Campos rejeitados na validação (sem fonte / sem texto) — erro registrado. */
  errosRegistrados: ErroRegistrado[];
  /** Campos rebaixados a lacuna após reprocesso (vocabulário persistente). */
  lacunasDisciplina: Array<{ campo: string; motivo: string }>;
  /** Remoções do passo adversarial (exibidas em limitações). */
  remocoes: RemocaoAdversarial[];
}
