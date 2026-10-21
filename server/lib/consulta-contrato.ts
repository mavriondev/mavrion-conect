/**
 * Contrato comum de resultado de consulta ("três estados") + tier de fonte +
 * proveniência do identificador de vínculo.
 *
 * Toda fonte consumida pelo relatório deve expor:
 *  - estadoConsulta: consultada_sem_registro | registro_existente | nao_consultada
 *    ("não consultada" cobre também consulta tentada e falhada — nunca vira
 *    silêncio nem "sem registro");
 *  - situacaoRegistro (aberta/encerrada) quando a fonte informar;
 *  - consultadoEm + janelaCobertura (janela temporal que a base cobre);
 *  - tierFonte: T1 base oficial casada por identificador único; T2 publicação
 *    oficial que exige interpretação de texto (DOU/Querido Diário); T3
 *    agregador comercial ou fonte secundária (CNPJA, Datastone);
 *  - identificadorVinculo + proveniência: como o registro foi ligado ao ativo
 *    (nº do processo ANM, CNPJ, geometria...) e de onde veio esse identificador.
 *
 * Registro sem identificador confirmado é REBAIXADO (tier efetivo T3) e
 * rotulado "vinculação não confirmada" — exibe-se, mas não vira fato.
 *
 * Módulo puro (sem imports de db/rede) para ser testável isoladamente e
 * importável por qualquer camada sem ciclo.
 */

export type EstadoConsulta = "registro_existente" | "consultada_sem_registro" | "nao_consultada";
/**
 * Situação do registro encontrado — campo OBRIGATÓRIO do contrato:
 *  - "aberta"/"encerrada" quando a fonte informa a situação;
 *  - "indeterminada" quando o registro existe mas a fonte não classifica;
 *  - null quando não há registro (consultada sem registro / não consultada).
 */
export type SituacaoRegistro = "aberta" | "encerrada" | "indeterminada";
export type TierFonte = "T1" | "T2" | "T3";

export type ProvenienciaIdentificador =
  | "documento_oficial"     // extraído de base/documento oficial (SCM, TAH, DSProcesso, SIGMINE)
  | "cadastro_usuario"      // informado manualmente pelo usuário
  | "resolvido_por_nome"    // resolvido por busca de nome em agregador comercial (CNPJA/Datastone)
  | "desconhecida";

export type TipoIdentificador = "processo_anm" | "cnpj" | "nome" | "geometria" | "nup" | "codigo_imovel";

export interface IdentificadorVinculo {
  tipo: TipoIdentificador;
  valor: string;
  proveniencia: ProvenienciaIdentificador;
  /** rótulo humano de onde veio (ex.: "SCM", "TAH", "CNPJA") */
  origem?: string | null;
}

export interface MetaConsulta {
  estadoConsulta: EstadoConsulta;
  /** obrigatório: aberta/encerrada (fonte informa), indeterminada (registro sem classificação) ou null (sem registro/não consultada) */
  situacaoRegistro: SituacaoRegistro | null;
  consultadoEm?: string | null;
  /** janela temporal coberta pela base (ex.: "TAH 2010–2025", "acervo completo do DOU") */
  janelaCobertura?: string | null;
  fonte?: string | null;
  tierFonte: TierFonte;
  /** presente quando o registro foi rebaixado por vínculo não confirmado */
  tierFonteOriginal?: TierFonte;
  rebaixadoMotivo?: string;
  identificadorVinculo?: IdentificadorVinculo | null;
  /** false = "vinculação não confirmada" — exibir rotulado, nunca derivar fato */
  vinculoConfirmado?: boolean | null;
  motivoVinculoNaoConfirmado?: string | null;
}

export const TEXTO_VINCULO_NAO_CONFIRMADO = "vinculação não confirmada";

// ── Proveniência do CNPJ do titular ─────────────────────────────────────────

/**
 * Mapeia o valor de `cnpjFonte` gravado em anmTitular (SCM/TAH/DSProcesso/
 * CNPJA/manual/métodos do smart-resolve) para a proveniência do identificador.
 */
export function provenienciaCnpj(cnpjFonte: string | null | undefined): ProvenienciaIdentificador {
  const f = String(cnpjFonte || "").trim().toLowerCase();
  if (!f) return "desconhecida";
  if (f === "scm" || f === "tah" || f === "dsprocesso" || f === "tah_dados_abertos" || f === "sigmine") {
    return "documento_oficial";
  }
  if (f === "manual" || f.startsWith("manual")) return "cadastro_usuario";
  if (f.includes("cnpja") || f.includes("datastone") || f === "smart_resolve" || f.startsWith("ai_") || f.includes("_ai")) {
    return "resolvido_por_nome";
  }
  return "desconhecida";
}

export function descreverProveniencia(p: ProvenienciaIdentificador): string {
  switch (p) {
    case "documento_oficial": return "obtido de documento/base oficial (ANM)";
    case "cadastro_usuario": return "informado manualmente pelo usuário";
    case "resolvido_por_nome": return "resolvido por nome via agregador comercial (não confirmado por documento oficial)";
    default: return "proveniência não registrada";
  }
}

/** Vínculo por CNPJ conta como confirmado quando o CNPJ veio de documento oficial ou do próprio usuário. */
export function cnpjVinculoConfirmado(p: ProvenienciaIdentificador): boolean {
  return p === "documento_oficial" || p === "cadastro_usuario";
}

export function montarIdentificadorCnpj(cnpj: string, cnpjFonte: string | null | undefined): IdentificadorVinculo {
  const proveniencia = provenienciaCnpj(cnpjFonte);
  return { tipo: "cnpj", valor: cnpj, proveniencia, origem: cnpjFonte || null };
}

/**
 * Validação estrutural de CNPJ: 14 dígitos, não repetido, dígitos
 * verificadores mod-11 corretos. Pré-condição de consulta — CNPJ inválido
 * nunca chega às fontes; a rota responde o contrato de falha (400).
 */
export function cnpjValido(cnpj: string | null | undefined): boolean {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (len: 12 | 13): number => {
    const pesos = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

// ── Rebaixamento de tier por vínculo não confirmado ─────────────────────────

/**
 * Aplica a regra "registro sem identificador confirmado é rebaixado e
 * rotulado": quando vinculoConfirmado === false, o tier efetivo vira T3 e o
 * original fica registrado em tierFonteOriginal.
 */
export function aplicarRebaixamento<T extends MetaConsulta>(meta: T): T {
  if (meta.vinculoConfirmado === false && meta.tierFonte !== "T3") {
    return {
      ...meta,
      tierFonteOriginal: meta.tierFonte,
      tierFonte: "T3" as TierFonte,
      rebaixadoMotivo: meta.motivoVinculoNaoConfirmado || TEXTO_VINCULO_NAO_CONFIRMADO,
    };
  }
  return meta;
}

// ── Falha operacional de consulta: payload padrão ───────────────────────────

/**
 * Constrói o payload padrão de consulta que FALHOU (erro, timeout, base
 * indisponível): estado "não consultada" com o contrato completo — tier,
 * data da tentativa, janela (null = cobertura indisponível), identificador
 * de vínculo/proveniência quando conhecido e o motivo da falha. Toda fonte
 * do relatório e todo catch de rota devem responder neste formato; falha
 * operacional nunca vira silêncio, payload nu nem "sem registro".
 */
export function payloadFalhaConsulta(opts: {
  fonte: string;
  tierFonte: TierFonte;
  motivoFalha: string;
  janelaCobertura?: string | null;
  identificadorVinculo?: IdentificadorVinculo | null;
  extras?: Record<string, unknown>;
}) {
  return {
    disponivel: false as const,
    estadoConsulta: "nao_consultada" as EstadoConsulta,
    situacaoRegistro: null as SituacaoRegistro | null,
    tierFonte: opts.tierFonte,
    janelaCobertura: opts.janelaCobertura ?? null,
    identificadorVinculo: opts.identificadorVinculo ?? null,
    fonte: opts.fonte,
    consultadoEm: new Date().toISOString(),
    motivoFalha: opts.motivoFalha,
    // compat: consumidores existentes exibem "message"
    message: opts.motivoFalha,
    ...(opts.extras || {}),
  };
}

// ── Vínculo por identificador nos diários (DOU / Querido Diário) ────────────

const soDigitos = (s: unknown): string => String(s ?? "").replace(/\D/g, "");

/**
 * Um termo de busca é "termo de processo ANM" quando não contém letras e seus
 * dígitos coincidem com os do processo (cobre as variantes "886.371/2008" e
 * "886371/2008"). Sem o processo de referência, aceita o padrão NNN.NNN/AAAA.
 */
export function termoEhProcessoAnm(termo: string | null | undefined, processo?: string | null): boolean {
  const t = String(termo || "").trim();
  if (!t || /[a-zA-ZÀ-úà-ú]/.test(t)) return false;
  const td = soDigitos(t);
  if (td.length < 6) return false;
  const pd = soDigitos(processo);
  if (pd) return td === pd;
  return /^\d{1,6}[./ ]?\d{0,6}[/. ]?\d{2,4}$/.test(t);
}

export interface VinculoDiario {
  /** qual identificador casou: número do processo (confirmado) ou só nome do titular */
  por: "processo_anm" | "nome_titular" | "desconhecido";
  termo: string | null;
  confirmado: boolean;
}

/**
 * Classifica o vínculo de uma publicação de diário (DOU/Querido Diário) a
 * partir dos termos que casaram. Funciona com o payload novo (`vinculo` já
 * gravado, ou `termosCasados`) e com caches antigos (só `termoBusca`).
 * Publicação sem termo registrado é conservadoramente NÃO confirmada.
 */
export function classificarVinculoDiario(pub: any, processo?: string | null): VinculoDiario {
  if (pub && typeof pub === "object" && pub.vinculo && typeof pub.vinculo.confirmado === "boolean") {
    return {
      por: pub.vinculo.por === "processo_anm" ? "processo_anm" : pub.vinculo.por === "nome_titular" ? "nome_titular" : "desconhecido",
      termo: pub.vinculo.termo ?? pub.termoBusca ?? null,
      confirmado: pub.vinculo.confirmado,
    };
  }
  const termos: string[] = Array.isArray(pub?.termosCasados) && pub.termosCasados.length > 0
    ? pub.termosCasados
    : (pub?.termoBusca ? [pub.termoBusca] : []);
  const termoProcesso = termos.find((t) => termoEhProcessoAnm(t, processo));
  if (termoProcesso) return { por: "processo_anm", termo: termoProcesso, confirmado: true };
  const termoNome = termos.find((t) => !termoEhProcessoAnm(t, processo));
  if (termoNome) return { por: "nome_titular", termo: termoNome, confirmado: false };
  return { por: "desconhecido", termo: null, confirmado: false };
}

export interface PublicacoesSeparadas {
  /** casadas pelo número do processo — podem virar fato/alerta */
  confirmadas: any[];
  /** casadas só por nome do titular (ou sem termo registrado) — apenas exibição rotulada */
  naoConfirmadas: any[];
}

/**
 * Separa as publicações de um payload de DOU/Querido Diário (novo ou legado)
 * entre vínculo confirmado por número de processo e vínculo não confirmado.
 * Itens não confirmados NÃO devem gerar alerta, prazo, vigência nem entrar
 * como fato nos insumos da IA.
 */
export function separarPublicacoesDiario(payload: any, processo?: string | null): PublicacoesSeparadas {
  const pubs: any[] = Array.isArray(payload?.publicacoes) ? payload.publicacoes : [];
  const confirmadas: any[] = [];
  const naoConfirmadas: any[] = [];
  for (const pub of pubs) {
    const v = classificarVinculoDiario(pub, processo);
    if (v.confirmado) confirmadas.push(pub);
    else naoConfirmadas.push(pub);
  }
  return { confirmadas, naoConfirmadas };
}

// ── Barragens SIGBM: vínculo com o titular ──────────────────────────────────

/**
 * Separa as barragens atribuídas ao titular entre vínculo confirmado (CNPJ do
 * empreendedor) e vínculo não confirmado (casadas só por nome). Itens não
 * confirmados NÃO viram fato/alerta nem entram nos insumos da IA — apenas
 * exibição rotulada. Payloads legados sem marcador de vínculo passam como
 * confirmados (o refresh da consulta SIGBM carimba o vínculo linha a linha).
 */
export function separarBarragensTitular(payload: any): { confirmadas: any[]; naoConfirmadas: any[] } {
  const rows: any[] = Array.isArray(payload?.doTitular) ? payload.doTitular : [];
  const payloadPorNome = payload?.matchPor === "nome_empreendedor";
  const confirmadas: any[] = [];
  const naoConfirmadas: any[] = [];
  for (const b of rows) {
    const v = b && typeof b === "object" ? (b as any).vinculo : null;
    const naoConf = v && typeof v.confirmado === "boolean" ? v.confirmado === false : payloadPorNome;
    (naoConf ? naoConfirmadas : confirmadas).push(b);
  }
  return { confirmadas, naoConfirmadas };
}

// ── Certidões: aviso herdado da proveniência do CNPJ ────────────────────────

/**
 * Rótulo obrigatório quando as certidões foram consultadas com CNPJ resolvido
 * por nome (sem documento oficial): todo consumidor (PDF, digest, prompt)
 * exibe/propaga este aviso — o resultado não é tratado como fato do titular.
 */
export function avisoCertidoesVinculo(cert: any): string | null {
  if (!cert || cert.vinculoConfirmadoPorDocumento !== false) return null;
  return typeof cert.avisoVinculo === "string" && cert.avisoVinculo.length > 0
    ? cert.avisoVinculo
    : `CNPJ consultado foi resolvido por nome via agregador comercial — ${TEXTO_VINCULO_NAO_CONFIRMADO}; não tratar como fato do titular sem confirmação documental.`;
}

// ── Tier por módulo do relatório ────────────────────────────────────────────

/**
 * Tier declarado por módulo persistido em camposEspecificos. DOU e Querido
 * Diário são T2 (publicação oficial interpretada por texto); agregadores
 * comerciais (CNPJA/Datastone) são T3; o restante são bases oficiais T1.
 */
export const TIER_POR_MODULO: Record<string, TierFonte> = {
  anmLiveData: "T1",
  anmHistorico: "T1",
  anmTah: "T1",
  anmCfem: "T1",
  anmDou: "T2",
  anmDouMunicipal: "T2",
  anmBarragens: "T1",
  anmCertidoesTitular: "T1",
  anmSei: "T1",
  anmRestricoes: "T1",
  anmFunai: "T1",
  sigefParcelas: "T1",
  carImoveis: "T1",
  ccirImoveis: "T1",
  anmLogistica: "T1",
  anmSondagem: "T1",
  anmGeoquimica: "T1",
  anmGeologia: "T1",
  cnpja: "T3",
  datastone: "T3",
};

/**
 * Deriva a MetaConsulta de um payload persistido (novo ou legado) de um
 * módulo do relatório. Payloads novos já trazem estadoConsulta/tierFonte e
 * são respeitados; para legados o estado é derivado do conteúdo.
 */
export function derivarMetaModulo(modulo: string, payload: any, processoAnm?: string | null): MetaConsulta {
  const tierPadrao = TIER_POR_MODULO[modulo] || "T1";
  if (!payload) {
    return { estadoConsulta: "nao_consultada", situacaoRegistro: null, tierFonte: tierPadrao, consultadoEm: null, janelaCobertura: null };
  }
  // payload novo: já carrega o contrato
  if (typeof payload.estadoConsulta === "string") {
    return {
      estadoConsulta: payload.estadoConsulta,
      situacaoRegistro: payload.situacaoRegistro ?? (payload.estadoConsulta === "registro_existente" ? "indeterminada" : null),
      consultadoEm: payload.consultadoEm ?? null,
      janelaCobertura: payload.janelaCobertura ?? null,
      fonte: payload.fonte ?? null,
      tierFonte: payload.tierFonte || tierPadrao,
      ...(payload.tierFonteOriginal ? { tierFonteOriginal: payload.tierFonteOriginal } : {}),
      ...(payload.rebaixadoMotivo ? { rebaixadoMotivo: payload.rebaixadoMotivo } : {}),
      identificadorVinculo: payload.identificadorVinculo ?? null,
      vinculoConfirmado: payload.vinculoConfirmado ?? null,
      motivoVinculoNaoConfirmado: payload.motivoVinculoNaoConfirmado ?? null,
    };
  }
  const consultadoEm = payload.consultadoEm ?? null;
  const base: MetaConsulta = {
    estadoConsulta: "nao_consultada",
    situacaoRegistro: null,
    consultadoEm,
    janelaCobertura: payload.janelaCobertura ?? null,
    fonte: payload.fonte ?? null,
    tierFonte: tierPadrao,
  };
  if (payload.disponivel === false || payload.erro) return base;

  // legado não informa situação: registro existente ⇒ "indeterminada"
  const comRegistro = (tem: boolean): Pick<MetaConsulta, "estadoConsulta" | "situacaoRegistro"> =>
    tem
      ? { estadoConsulta: "registro_existente", situacaoRegistro: "indeterminada" }
      : { estadoConsulta: "consultada_sem_registro", situacaoRegistro: null };
  switch (modulo) {
    case "anmDou":
    case "anmDouMunicipal": {
      const { confirmadas } = separarPublicacoesDiario(payload, processoAnm);
      return { ...base, ...comRegistro(confirmadas.length > 0) };
    }
    case "anmTah": {
      const rows = Array.isArray(payload) ? payload : (payload.registros || payload.rows || []);
      return { ...base, ...comRegistro(Array.isArray(rows) && rows.length > 0) };
    }
    case "anmCfem": {
      const tem = Boolean(payload.processo?.jaProduziu || payload.titular?.jaRecolheu);
      return { ...base, ...(payload.baseImportada === false ? { estadoConsulta: "nao_consultada" as EstadoConsulta, situacaoRegistro: null } : comRegistro(tem)), janelaCobertura: base.janelaCobertura ?? (payload.baseAnos ? `anos ${payload.baseAnos.de ?? "?"}–${payload.baseAnos.ate ?? "?"}` : null) };
    }
    case "anmBarragens":
      return { ...base, ...comRegistro((payload.doTitular || []).length > 0 || (payload.proximas || []).length > 0) };
    case "anmCertidoesTitular": {
      const tem = Boolean(payload.pgfn?.temDebitoAtivo || (payload.cnj?.totalProcessos ?? 0) > 0 || payload.ceis?.sancionado);
      return { ...base, ...comRegistro(tem) };
    }
    case "anmSei":
      return { ...base, ...comRegistro((payload.documentos || []).length > 0 || (payload.andamentos || []).length > 0) };
    case "sigefParcelas":
      return { ...base, ...comRegistro((payload.parcelas || []).length > 0), janelaCobertura: base.janelaCobertura ?? (payload.dataBase ? `base ${payload.dataBase}` : null) };
    case "carImoveis":
      return { ...base, ...comRegistro((payload.imoveis || []).length > 0) };
    case "ccirImoveis":
      return { ...base, ...comRegistro((payload.imoveis || []).length > 0) };
    case "anmRestricoes": {
      const camadas = payload.camadas || {};
      const consultadas = Object.values(camadas).filter((c: any) => c?.consultado);
      if (consultadas.length === 0) return base;
      const tem = consultadas.some((c: any) => c?.sobreposicao === true || (c?.total ?? 0) > 0);
      return { ...base, ...comRegistro(tem) };
    }
    default:
      return { ...base, estadoConsulta: "registro_existente", situacaoRegistro: "indeterminada" };
  }
}
