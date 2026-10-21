/**
 * Lacunas estruturadas e score de completude do dossiê minerário.
 *
 * - Campos críticos de maturidade (teor, recurso e categoria, densidade,
 *   relatório final de pesquisa, licenciamento, produção histórica) são
 *   avaliados deterministicamente a partir dos dados estruturados do ativo.
 * - Campo ausente vira LACUNA ESTRUTURADA de quatro campos (o que falta /
 *   por que importa / onde obter / custo e prazo estimados), preenchidos por
 *   catálogo determinístico por tipo de documento — nunca pela IA.
 * - "Não é possível concluir sobre [X] com as fontes disponíveis. Falta:
 *   [lacuna]" é saída de primeira classe, tratada como sucesso.
 * - O ÚNICO indicador do dossiê é o score de completude (fórmula e
 *   componentes visíveis) — nenhum score de confiança sobre conclusões.
 */
import { normalizarTexto } from "./enunciados";
import { filtrarEventosReais } from "./relatorio-vinculos";

export type ComponenteMaturidadeId =
  | "teor"
  | "recursoCategoria"
  | "densidade"
  | "relatorioFinal"
  | "licenciamento"
  | "producaoHistorica";

export interface ComponenteMaturidade {
  id: ComponenteMaturidadeId;
  rotulo: string;
  presente: boolean;
  /** O que foi encontrado (quando presente). */
  evidencia?: string;
  fonte?: string;
  dataConsulta?: string | null;
}

export interface LacunaEstruturada {
  oQueFalta: string;
  porQueImporta: string;
  ondeObter: string;
  custoPrazo: string;
  /** maturidade = campo crítico ausente; disciplina = campo rebaixado após
   *  reprocesso por vocabulário proibido / falta de fonte. */
  origem: "maturidade" | "disciplina";
  tema: string;
}

/** Frase padrão de não-conclusão — saída de primeira classe (sucesso). */
export function fraseNaoConclusivo(tema: string, falta: string): string {
  return `Não é possível concluir sobre ${tema} com as fontes disponíveis. Falta: ${falta}`;
}

// Catálogo determinístico fixo por tipo de documento: onde obter e custo/
// prazo NÃO são preenchidos pela IA.
const CATALOGO_LACUNAS: Record<ComponenteMaturidadeId, Omit<LacunaEstruturada, "origem" | "tema">> = {
  teor: {
    oQueFalta: "Teor/qualidade da substância (análises químicas ou certificados de análise)",
    porQueImporta: "Sem teor não há como dimensionar o valor do minério nem comparar com referências de mercado",
    ondeObter: "Certificados de análise laboratorial do titular; Relatório Final de Pesquisa no SEI/ANM (quando protocolado)",
    custoPrazo: "Cópia de documentos no SEI: sem custo, 1-5 dias úteis; nova campanha de análises laboratoriais: R$ 2 mil-15 mil, 2-6 semanas",
  },
  recursoCategoria: {
    oQueFalta: "Estimativa de recurso/reserva com categoria (medida/indicada/inferida)",
    porQueImporta: "Recurso sem categoria não sustenta avaliação econômica nem comparação entre ativos",
    ondeObter: "Relatório Final de Pesquisa aprovado (SEI/ANM); relatório técnico do titular (padrão CBRR/JORC, quando houver)",
    custoPrazo: "Cópia de RFP existente no SEI: sem custo, 1-5 dias úteis; nova estimativa com sondagem e modelagem: R$ 50 mil-500 mil, 3-12 meses",
  },
  densidade: {
    oQueFalta: "Densidade do minério (ensaios físicos)",
    porQueImporta: "A densidade converte volume em tonelagem — sem ela recurso e produção não se conciliam",
    ondeObter: "Ensaios de densidade em laboratório; Relatório Final de Pesquisa (SEI/ANM)",
    custoPrazo: "Ensaios de densidade: R$ 1 mil-5 mil, 1-3 semanas; cópia de RFP no SEI: sem custo, 1-5 dias úteis",
  },
  relatorioFinal: {
    oQueFalta: "Relatório Final de Pesquisa (protocolo e situação de aprovação)",
    porQueImporta: "O RFP consolida a geologia do alvo e condiciona a passagem para requerimento de lavra",
    ondeObter: "Pesquisa pública do SEI/ANM pelo número do processo; eventos do Cadastro Mineiro",
    custoPrazo: "Consulta pública: sem custo, imediato a 5 dias úteis",
  },
  licenciamento: {
    oQueFalta: "Situação do licenciamento ambiental (LP/LI/LO ou dispensa)",
    porQueImporta: "Título minerário sem licença ambiental não opera — o licenciamento condiciona qualquer plano de aproveitamento",
    ondeObter: "Órgão ambiental estadual da UF do processo (ex.: SEMAD/SUPRAM em MG); IBAMA quando o licenciamento for federal",
    custoPrazo: "Consulta à situação: sem custo, 1-10 dias úteis; licenciamento novo: R$ 50 mil-2 mi, 6-36 meses conforme porte",
  },
  producaoHistorica: {
    oQueFalta: "Produção histórica (recolhimentos de CFEM do processo)",
    porQueImporta: "Distingue projeto sem produção de mina com histórico comercial — muda risco e comparáveis",
    ondeObter: "Base de arrecadação CFEM/ANM (dados abertos) pelo número do processo",
    custoPrazo: "Sem custo — consulta/reimportação da base CFEM, minutos a horas",
  },
};

const ROTULOS: Record<ComponenteMaturidadeId, string> = {
  teor: "Teor da substância",
  recursoCategoria: "Recurso e categoria",
  densidade: "Densidade",
  relatorioFinal: "Relatório Final de Pesquisa",
  licenciamento: "Licenciamento ambiental",
  producaoHistorica: "Produção histórica (CFEM)",
};

const pick = (...vals: any[]): string | null => {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return null;
};

/**
 * Avalia deterministicamente os seis componentes de maturidade do dossiê a
 * partir dos dados estruturados. Só se aplica a ativo minerário (MINA ou com
 * processo ANM) — para os demais retorna lista vazia.
 */
export function avaliarComponentesMaturidade(asset: any): ComponenteMaturidade[] {
  const c = (asset?.camposEspecificos || {}) as any;
  const attrs = (asset?.attributesJson || {}) as any;
  if (asset?.type !== "MINA" && !c.processoAnm) return [];

  const componentes: ComponenteMaturidade[] = [];
  const F_CAD = "cadastro do ativo (declarado)";

  // 1. Teor — campo declarado no dossiê
  const teor = pick(c.teor, c.teorMedio, c.teorSubstancia, attrs.teor);
  componentes.push({
    id: "teor", rotulo: ROTULOS.teor, presente: !!teor,
    ...(teor ? { evidencia: teor, fonte: F_CAD, dataConsulta: asset?.createdAt ?? null } : {}),
  });

  // 2. Recurso e categoria
  const recurso = pick(c.recursoEstimado, c.reservaEstimada, c.recursos, attrs.recursoEstimado);
  const categoria = pick(c.recursoCategoria, c.categoriaRecurso, attrs.categoriaRecurso);
  const recursoOk = !!(recurso || categoria);
  componentes.push({
    id: "recursoCategoria", rotulo: ROTULOS.recursoCategoria, presente: recursoOk,
    ...(recursoOk ? {
      evidencia: [recurso, categoria].filter(Boolean).join(" — categoria: "),
      fonte: F_CAD, dataConsulta: asset?.createdAt ?? null,
    } : {}),
  });

  // 3. Densidade
  const densidade = pick(c.densidade, c.densidadeMinerio, attrs.densidade);
  componentes.push({
    id: "densidade", rotulo: ROTULOS.densidade, presente: !!densidade,
    ...(densidade ? { evidencia: densidade, fonte: F_CAD, dataConsulta: asset?.createdAt ?? null } : {}),
  });

  // 4. Relatório Final de Pesquisa — evento real do Cadastro Mineiro ou
  //    documento na lista pública do SEI
  const eventos = filtrarEventosReais(c.anmHistorico?.eventos, c.processoAnm) as any[];
  const evRfp = eventos.find((e) => /relatorio\s+final/.test(normalizarTexto(e?.descricao || "")));
  const docsSei: any[] = Array.isArray(c.anmSei?.documentos) ? c.anmSei.documentos : [];
  const docRfp = docsSei.find((d) => /relatorio\s+final/.test(normalizarTexto(`${d?.tipo || ""} ${d?.numero || ""}`)));
  const rfpDeclarado = pick(c.relatorioFinalPesquisa, c.relatorioFinal);
  const rfpOk = !!(evRfp || docRfp || rfpDeclarado);
  componentes.push({
    id: "relatorioFinal", rotulo: ROTULOS.relatorioFinal, presente: rfpOk,
    ...(evRfp ? {
      evidencia: `Evento: ${evRfp.descricao}${evRfp.data ? ` (${evRfp.data})` : ""}`,
      fonte: "Eventos ANM (Cadastro Mineiro)", dataConsulta: c.anmHistorico?.consultadoEm ?? c.anmHistoricoUpdatedAt ?? null,
    } : docRfp ? {
      evidencia: `Documento SEI: ${docRfp.tipo || docRfp.numero}`,
      fonte: "SEI/ANM (pesquisa pública)", dataConsulta: c.anmSei?.consultadoEm ?? c.anmSeiUpdatedAt ?? null,
    } : rfpDeclarado ? { evidencia: rfpDeclarado, fonte: F_CAD, dataConsulta: asset?.createdAt ?? null } : {}),
  });

  // 5. Licenciamento ambiental — declarado no dossiê ou rastro em eventos/SEI
  const licDeclarada = pick(c.licencaAmbiental, c.licencasAmbientais, c.licenciamento, attrs.licencaAmbiental);
  const evLic = eventos.find((e) => /licen/.test(normalizarTexto(e?.descricao || "")));
  const docLic = docsSei.find((d) => /licen/.test(normalizarTexto(d?.tipo || "")));
  const licOk = !!(licDeclarada || evLic || docLic);
  componentes.push({
    id: "licenciamento", rotulo: ROTULOS.licenciamento, presente: licOk,
    ...(licDeclarada ? { evidencia: licDeclarada, fonte: F_CAD, dataConsulta: asset?.createdAt ?? null }
      : evLic ? {
        evidencia: `Evento: ${evLic.descricao}${evLic.data ? ` (${evLic.data})` : ""}`,
        fonte: "Eventos ANM (Cadastro Mineiro)", dataConsulta: c.anmHistorico?.consultadoEm ?? c.anmHistoricoUpdatedAt ?? null,
      } : docLic ? {
        evidencia: `Documento SEI: ${docLic.tipo}`,
        fonte: "SEI/ANM (pesquisa pública)", dataConsulta: c.anmSei?.consultadoEm ?? c.anmSeiUpdatedAt ?? null,
      } : {}),
  });

  // 6. Produção histórica — a base CFEM responde a pergunta nos dois sentidos
  //    (recolhimento = produção comercializada; sem recolhimento na base
  //    coberta = sem produção comercializada registrada nesse período).
  const cfemProc = c.anmCfem?.disponivel ? c.anmCfem?.processo : null;
  const prodDeclarada = pick(c.producaoHistorica, attrs.producaoHistorica);
  const prodOk = !!(cfemProc || prodDeclarada);
  componentes.push({
    id: "producaoHistorica", rotulo: ROTULOS.producaoHistorica, presente: prodOk,
    ...(cfemProc ? {
      evidencia: cfemProc.jaProduziu
        ? "Recolhimentos de CFEM registrados para o processo (produção comercializada)"
        : "Sem recolhimento de CFEM para o processo na base coberta (sem produção comercializada registrada no período)",
      fonte: "CFEM/ANM (dados abertos)", dataConsulta: c.anmCfem?.consultadoEm ?? c.anmCfemUpdatedAt ?? null,
    } : prodDeclarada ? { evidencia: prodDeclarada, fonte: F_CAD, dataConsulta: asset?.createdAt ?? null } : {}),
  });

  return componentes;
}

/** Gera as lacunas estruturadas (4 campos) dos componentes ausentes, com
 *  catálogo fixo — determinístico, nunca preenchido pela IA. */
export function gerarLacunasDossie(componentes: ComponenteMaturidade[]): LacunaEstruturada[] {
  return componentes
    .filter((comp) => !comp.presente)
    .map((comp) => ({
      ...CATALOGO_LACUNAS[comp.id],
      origem: "maturidade" as const,
      tema: comp.rotulo,
    }));
}

/** Lacuna declarada por disciplina de certeza: campo do parecer rebaixado
 *  após reprocesso (vocabulário proibido persistente / enunciado sem fonte). */
export function lacunaDisciplina(campo: string, motivo: string): LacunaEstruturada {
  return {
    oQueFalta: `Enunciado de "${campo}" com lastro em fonte T1/T2`,
    porQueImporta: `O conteúdo gerado para "${campo}" foi descartado (${motivo}) — publicar sem lastro violaria a disciplina de certeza`,
    ondeObter: "Revisão humana do dossiê com as fontes citadas nas demais seções",
    custoPrazo: "Interno — revisão do analista, horas",
    origem: "disciplina",
    tema: campo,
  };
}

export interface ScoreCompletude {
  score: number;
  presentes: number;
  total: number;
  formula: string;
  componentes: ComponenteMaturidade[];
}

/** Score de completude do dossiê — o ÚNICO indicador do relatório. Fórmula
 *  visível: peso igual por componente; ativo sem nenhum componente ⇒ 0. */
export function computeScoreCompletude(componentes: ComponenteMaturidade[]): ScoreCompletude {
  const total = componentes.length;
  const presentes = componentes.filter((comp) => comp.presente).length;
  const score = total === 0 ? 0 : Math.round((presentes / total) * 100);
  return {
    score,
    presentes,
    total,
    formula: `score = 100 × (componentes presentes ÷ ${total || 6}) — peso igual por componente; presença avaliada por regra determinística sobre os dados estruturados`,
    componentes,
  };
}

export interface MetricaCobertura {
  respondidosT1T2: number;
  lacunasDeclaradas: number;
  texto: string;
}

/** Métrica da proporção de campos respondidos por fontes T1/T2 vs lacunas
 *  declaradas — acompanha o score de completude. */
export function metricaCobertura(respondidosT1T2: number, lacunasDeclaradas: number): MetricaCobertura {
  const total = respondidosT1T2 + lacunasDeclaradas;
  const pct = total === 0 ? 0 : Math.round((respondidosT1T2 / total) * 100);
  return {
    respondidosT1T2,
    lacunasDeclaradas,
    texto: `${respondidosT1T2} campo(s) respondido(s) por fontes T1/T2 e ${lacunasDeclaradas} lacuna(s) declarada(s) (${pct}% respondido)`,
  };
}
