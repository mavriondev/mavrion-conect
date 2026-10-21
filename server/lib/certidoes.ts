/**
 * Certidões e processos para due diligence de empresas
 * PGFN: Dívida ativa federal — a API antiga (regularize /api/sitregulae) foi DESCONTINUADA (verificado
 *   em produção/VPS em 13/08/2026: o site devolve a SPA para qualquer rota; a nova API /back/api exige
 *   token de autenticação e a Lista de Devedores exige reCAPTCHA). Não há API pública em tempo real.
 *   Alternativa real: dados abertos trimestrais da PGFN (dadosabertos.pgfn.gov.br) via importação local.
 * CNJ DataJud: Processos judiciais — API pública gratuita. IMPORTANTE: a API pública do DataJud
 *   não indexa dados de partes (CPF/CNPJ) por razões de LGPD; buscas por CNPJ retornam 0 resultados
 *   normalmente. A integração permanece ativa para eventuais buscas por número de processo.
 * TCU CEIS: Empresas sancionadas — requer chave gratuita do Portal da Transparência.
 */

import { consultarDividaAtivaLocal, formatarReferencia } from "./pgfn-importer";
import {
  aplicarRebaixamento,
  cnpjVinculoConfirmado,
  descreverProveniencia,
  TEXTO_VINCULO_NAO_CONFIRMADO,
  type EstadoConsulta,
  type IdentificadorVinculo,
  type MetaConsulta,
  type SituacaoRegistro,
  type TierFonte,
} from "./consulta-contrato";

export interface FonteErro {
  fonte: string;
  erro: string;
}

/** Três estados por fonte de certidão (PGFN/CNJ/CEIS) — falha nunca vira "sem registro". */
export interface EstadoFonteCertidao {
  estadoConsulta: EstadoConsulta;
  situacaoRegistro: SituacaoRegistro | null;
  janelaCobertura: string | null;
  fonte: string;
  tierFonte: TierFonte;
  motivo?: string;
}

export interface CertidoesResult {
  cnpj: string;
  pgfn: {
    temDebitoAtivo: boolean | null;
    situacao: string;
    consultadoEm: string;
    /** Valor consolidado total inscrito em dívida ativa (quando a base está importada) */
    valorConsolidado?: number;
    inscricoes?: number;
    /** Trimestre de referência do dump da PGFN, ex.: "2026_trimestre_02" */
    referencia?: string | null;
    /** false = dados abertos da PGFN ainda não importados nesta instalação */
    baseImportada?: boolean;
    categorias?: Array<{ categoria: string; valorConsolidado: number; inscricoes: number }>;
  };
  /**
   * null quando a API pública não suporta busca por CNPJ de partes (LGPD).
   * Não interpretar null como "sem processos" — usar o campo `erros` para exibir motivo.
   */
  cnj: {
    totalProcessos: number;
    processos: Array<{
      numero: string;
      tribunal: string;
      classe: string;
      assunto: string;
      dataAjuizamento: string;
      situacao: string;
    }>;
    consultadoEm: string;
  } | null;
  /** null quando a chamada falhou (ver `erros`); nunca confundir ausência de sanções com indisponibilidade */
  ceis: {
    sancionado: boolean;
    sancoes: any[];
    consultadoEm: string;
  } | null;
  fonte: string;
  erros?: FonteErro[];
  /** estado agregado do módulo (contrato comum) — detalhe por fonte em `estados` */
  estadoConsulta: EstadoConsulta;
  situacaoRegistro: SituacaoRegistro | null;
  /** por que o estado agregado não é "sem registro" pleno (fonte falha ou CNJ/LGPD) */
  motivoEstado?: string;
  janelaCobertura: string | null;
  consultadoEm: string;
  /** três estados por fonte: consultada sem registro / registro existente / não consultada */
  estados: {
    pgfn: EstadoFonteCertidao;
    cnj: EstadoFonteCertidao;
    ceis: EstadoFonteCertidao;
  };
  /** como o CNPJ consultado foi obtido (documento oficial SCM/TAH vs resolução por nome) */
  identificadorVinculo: IdentificadorVinculo | null;
  /** false = CNPJ resolvido por nome via agregador — certidões herdam "vinculação não confirmada por documento" */
  vinculoConfirmadoPorDocumento: boolean | null;
  avisoVinculo?: string;
  tierFonte: TierFonte;
  tierFonteOriginal?: TierFonte;
  rebaixadoMotivo?: string;
}

export async function consultarCertidoes(cnpj: string, identificadorVinculo?: IdentificadorVinculo | null): Promise<CertidoesResult> {
  const doc = cnpj.replace(/\D/g, "");
  const agora = new Date().toISOString();
  const erros: FonteErro[] = [];

  const cnjApiKey = process.env.CNJ_DATAJUD_API_KEY || "";
  const ceisApiKey = process.env.CEIS_API_KEY || "";

  const ceisHeaders: Record<string, string> = { "Accept": "application/json" };
  if (ceisApiKey) {
    ceisHeaders["chave-api-dados"] = ceisApiKey;
  }

  const [cnjRes, ceisRes] = await Promise.allSettled([
    // CNJ DataJud — API pública não indexa partes (CPF/CNPJ) por LGPD.
    // Buscas por CNPJ retornarão 0 resultados; isso é comportamento esperado da API pública.
    cnjApiKey
      ? fetch(
          `https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search`,
          {
            method: "POST",
            headers: {
              "Authorization": `ApiKey ${cnjApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: { query_string: { query: doc } },
              size: 10,
            }),
            signal: AbortSignal.timeout(10000),
          }
        ).then(async r => {
          if (!r.ok) throw new Error(`CNJ DataJud retornou status ${r.status}`);
          return r.json();
        })
      : Promise.reject(new Error("CNJ_DATAJUD_API_KEY não configurada")),

    // CEIS — Portal da Transparência, requer chave gratuita
    fetch(
      `https://api.portaldatransparencia.gov.br/api-de-dados/ceis?cnpj=${doc}&pagina=1`,
      {
        headers: ceisHeaders,
        signal: AbortSignal.timeout(8000),
      }
    ).then(async r => {
      if (!r.ok) throw new Error(`Portal da Transparência (CEIS) retornou status ${r.status}`);
      return r.json();
    }),
  ]);

  // PGFN — sem API pública em tempo real (verificado em produção em 13/08/2026):
  // a API antiga foi descontinuada, a nova exige token e a Lista de Devedores exige
  // reCAPTCHA. Usamos a base local importada dos dados abertos trimestrais
  // (dadosabertos.pgfn.gov.br) — ver server/lib/pgfn-importer.ts.
  let pgfn: CertidoesResult["pgfn"] = {
    temDebitoAtivo: null,
    situacao: "Não disponível",
    consultadoEm: agora,
  };
  try {
    const local = await consultarDividaAtivaLocal(doc);
    if (!local.baseImportada) {
      pgfn = {
        temDebitoAtivo: null,
        baseImportada: false,
        situacao: "Base de dívida ativa da PGFN (dados abertos trimestrais) ainda não importada — a consulta pública em tempo real foi descontinuada pela PGFN.",
        consultadoEm: agora,
      };
      erros.push({
        fonte: "PGFN",
        erro: "A PGFN descontinuou a API pública de situação fiscal. A base local de dívida ativa (dados abertos trimestrais) ainda não foi importada — um administrador precisa rodar a importação PGFN.",
      });
    } else {
      const refLabel = formatarReferencia(local.referencia);
      // Base parcial: "sem débitos" só é conclusivo com as 3 categorias importadas
      const todasCategorias = ["FGTS", "PREVIDENCIARIO", "NAO_PREVIDENCIARIO"];
      const faltantes = todasCategorias.filter(c => !local.categoriasImportadas.includes(c));
      const notaParcial = faltantes.length > 0
        ? ` — atenção: base parcial, categorias não importadas: ${faltantes.join(", ")}`
        : "";
      pgfn = {
        temDebitoAtivo: local.temDebitoAtivo,
        baseImportada: true,
        situacao: local.temDebitoAtivo
          ? `Possui dívida ativa inscrita: R$ ${local.valorConsolidado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em ${local.inscricoes} inscrição(ões) — ref. ${refLabel} (dados abertos PGFN)`
          : `Sem débitos inscritos em dívida ativa da União — ref. ${refLabel} (dados abertos PGFN)${notaParcial}`,
        consultadoEm: agora,
        valorConsolidado: local.valorConsolidado,
        inscricoes: local.inscricoes,
        referencia: local.referencia,
        categorias: local.categorias,
      };
    }
  } catch (e: any) {
    console.error(`[Certidões] Erro ao consultar base PGFN local para CNPJ ${doc}:`, e?.message || e);
    erros.push({ fonte: "PGFN", erro: `Erro ao consultar a base local de dívida ativa: ${e?.message || e}` });
  }

  // CNJ DataJud — a API pública não indexa partes (CPF/CNPJ) por LGPD.
  // Mesmo quando a chamada tem sucesso e retorna 0 resultados, isso NÃO é uma certidão negativa.
  // Registramos como limitação conhecida para que a UI não exiba "nenhum processo" como clearance.
  if (cnjRes.status === "rejected") {
    const errMsg = cnjRes.reason?.message || String(cnjRes.reason);
    console.error(`[Certidões] Erro ao consultar CNJ DataJud para CNPJ ${doc}:`, errMsg);
  }
  erros.push({
    fonte: "CNJ DataJud",
    erro: "A API pública do CNJ DataJud não indexa dados de partes (CPF/CNPJ) por razões de LGPD. Resultado por CNPJ não é suportado — use a API credenciada para consultar processos de titulares.",
  });

  let ceis = null;
  if (ceisRes.status === "fulfilled") {
    ceis = ceisRes.value;
  } else {
    const errMsg = ceisRes.reason?.message || String(ceisRes.reason);
    console.error(`[Certidões] Erro ao consultar CEIS para CNPJ ${doc}:`, errMsg);
    erros.push({ fonte: "TCU CEIS", erro: errMsg });
  }

  // ── Três estados por fonte + proveniência do CNPJ do vínculo ──
  const estadoPgfn: EstadoFonteCertidao = {
    fonte: "PGFN — dívida ativa da União (dados abertos trimestrais)",
    tierFonte: "T1",
    janelaCobertura: pgfn.baseImportada && pgfn.referencia
      ? `dump trimestral ref. ${formatarReferencia(pgfn.referencia)}`
      : null,
    ...(pgfn.baseImportada
      ? pgfn.temDebitoAtivo
        ? { estadoConsulta: "registro_existente" as const, situacaoRegistro: "aberta" as const }
        : { estadoConsulta: "consultada_sem_registro" as const, situacaoRegistro: null }
      : {
          estadoConsulta: "nao_consultada" as const,
          situacaoRegistro: null,
          motivo: "base local de dívida ativa (dados abertos PGFN) ainda não importada — falha ≠ situação regular",
        }),
  };
  const estadoCnj: EstadoFonteCertidao = {
    fonte: "CNJ DataJud — processos judiciais",
    tierFonte: "T1",
    janelaCobertura: null,
    estadoConsulta: "nao_consultada",
    situacaoRegistro: null,
    motivo: "API pública não indexa partes por CNPJ (LGPD) — ausência de resultado não é certidão negativa",
  };
  const ceisOk = ceis !== null;
  const ceisSancionado = ceisOk && Array.isArray(ceis) && ceis.length > 0;
  const estadoCeis: EstadoFonteCertidao = {
    fonte: "CEIS — Portal da Transparência (sanções vigentes)",
    tierFonte: "T1",
    janelaCobertura: ceisOk ? "cadastro de sanções vigentes na data da consulta" : null,
    ...(ceisOk
      ? ceisSancionado
        ? { estadoConsulta: "registro_existente" as const, situacaoRegistro: "aberta" as const }
        : { estadoConsulta: "consultada_sem_registro" as const, situacaoRegistro: null }
      : {
          estadoConsulta: "nao_consultada" as const,
          situacaoRegistro: null,
          motivo: "consulta ao CEIS falhou — indisponibilidade não significa ausência de sanção",
        }),
  };

  const vinculo = identificadorVinculo ?? null;
  const confirmadoPorDocumento = vinculo ? cnpjVinculoConfirmado(vinculo.proveniencia) : null;

  // ── Estado agregado do módulo (contrato comum) ──
  // CNJ é estruturalmente não consultável por CNPJ (LGPD): o rollup agrega as
  // fontes consultáveis (PGFN, CEIS) e expõe a lacuna do CNJ em motivoEstado.
  const consultaveis = [estadoPgfn, estadoCeis];
  const algumRegistro = [estadoPgfn, estadoCnj, estadoCeis].some(e => e.estadoConsulta === "registro_existente");
  const fontesFalha = consultaveis.filter(e => e.estadoConsulta === "nao_consultada");
  const estadoModulo: EstadoConsulta = algumRegistro
    ? "registro_existente"
    : fontesFalha.length > 0 ? "nao_consultada" : "consultada_sem_registro";
  const motivoEstado = algumRegistro
    ? null
    : fontesFalha.length > 0
      ? `fonte(s) não consultada(s): ${fontesFalha.map(f => f.fonte).join("; ")} — indisponibilidade não é certidão negativa`
      : "PGFN e CEIS consultados sem registro; CNJ DataJud não coberto (API pública não indexa partes por CNPJ — LGPD)";
  const janelaCobertura = [estadoPgfn, estadoCnj, estadoCeis]
    .filter(e => e.janelaCobertura)
    .map(e => `${e.fonte.split(" — ")[0]}: ${e.janelaCobertura}`)
    .join("; ") || null;

  const metaBase: MetaConsulta = {
    estadoConsulta: estadoModulo,
    situacaoRegistro: algumRegistro ? "aberta" : null,
    janelaCobertura,
    consultadoEm: agora,
    tierFonte: "T1",
    identificadorVinculo: vinculo,
    vinculoConfirmado: confirmadoPorDocumento,
    ...(confirmadoPorDocumento === false ? {
      motivoVinculoNaoConfirmado: `${TEXTO_VINCULO_NAO_CONFIRMADO} por documento — CNPJ ${descreverProveniencia(vinculo!.proveniencia)}`,
    } : {}),
  };
  const meta = aplicarRebaixamento(metaBase);

  return {
    cnpj: doc,
    estadoConsulta: meta.estadoConsulta,
    situacaoRegistro: algumRegistro ? "aberta" : null,
    ...(motivoEstado ? { motivoEstado } : {}),
    janelaCobertura,
    consultadoEm: agora,
    pgfn,
    // Sempre null para buscas por CNPJ: a API pública não indexa partes (LGPD).
    // Retornar 0 processos como resultado seria um falso negativo para due diligence.
    cnj: null,
    // null quando a chamada falhou — nunca mostrar "Nenhuma sanção" sem dado real
    ceis: ceis !== null
      ? {
          sancionado: ceisSancionado,
          sancoes: Array.isArray(ceis) ? ceis : [],
          consultadoEm: agora,
        }
      : null,
    fonte: "PGFN + CNJ DataJud + TCU CEIS",
    ...(erros.length > 0 ? { erros } : {}),
    estados: { pgfn: estadoPgfn, cnj: estadoCnj, ceis: estadoCeis },
    identificadorVinculo: vinculo,
    vinculoConfirmadoPorDocumento: confirmadoPorDocumento,
    ...(confirmadoPorDocumento === false ? {
      avisoVinculo: `Certidões consultadas com CNPJ ${descreverProveniencia(vinculo!.proveniencia)} — ${TEXTO_VINCULO_NAO_CONFIRMADO} por documento oficial: os resultados podem pertencer a homônimo e não devem virar fato sem confirmação do CNPJ no SCM/TAH.`,
    } : {}),
    tierFonte: meta.tierFonte,
    ...(meta.tierFonteOriginal ? { tierFonteOriginal: meta.tierFonteOriginal } : {}),
    ...(meta.rebaixadoMotivo ? { rebaixadoMotivo: meta.rebaixadoMotivo } : {}),
  };
}
