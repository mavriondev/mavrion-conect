/**
 * Digest compartilhado dos dados enriquecidos do dossiê minerário.
 *
 * Cada análise de IA (analyze-asset, mining-analysis, due diligence, deep intel)
 * usa este builder para injetar os blocos de dados persistidos em
 * camposEspecificos que faltarem no prompt dela — sem duplicar formatação.
 *
 * Formato: JSON compacto rotulado por fonte (mesmo estilo do digest do parecer
 * consolidado em asset-report.ts, que é a referência mais completa).
 * Campo ausente = fonte ainda não consultada (nunca inventar ausência de risco).
 */

import { filtrarTahPorProcesso } from "./relatorio-vinculos";
import { separarPublicacoesDiario, separarBarragensTitular, avisoCertidoesVinculo } from "./consulta-contrato";

export type DossieBlockKey =
  | "fundiaria"
  | "certidoes"
  | "cfem"
  | "dou"
  | "barragens"
  | "logistica"
  | "tah"
  | "restricoes"
  | "sondagem"
  | "geoquimica";

function strip(obj: any, max = 1500): string {
  try {
    const s = JSON.stringify(obj, (k, v) =>
      k.endsWith("UpdatedAt") || k === "ndviGrid" || k === "ccirRawData" || k === "__geometry" || k === "geometry" || k === "geometrias" || k === "geojson"
        ? undefined
        : v);
    if (!s || s === "{}" || s === "null" || s === "[]") return "";
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return "";
  }
}

const BLOCOS: Array<{ key: DossieBlockKey; render: (c: any) => string }> = [
  {
    key: "fundiaria",
    render: (c) => {
      const partes: string[] = [];
      if (c.sigefParcelas) partes.push(`SIGEF_PARCELAS (parcelas certificadas sobre o processo; totalSobrepostas=0 sugere área não georreferenciada — sinal de informalidade fundiária): ${strip(c.sigefParcelas, 1800)}`);
      if (c.carImoveis) partes.push(`CAR_IMOVEIS (imóveis CAR/SICAR sobre o polígono do processo, com % de sobreposição — indica ocupantes/posseiros declarados além das parcelas certificadas): ${strip(c.carImoveis, 1800)}`);
      if (c.ccirImoveis) partes.push(`CCIR_IMOVEIS (base fundiária consolidada por imóvel: código INCRA, denominação, detentores SNCR, situação, área): ${strip(c.ccirImoveis, 1800)}`);
      return partes.join("\n");
    },
  },
  {
    key: "certidoes",
    render: (c) => {
      if (!c.anmCertidoesTitular) return "";
      // CNPJ resolvido por nome (sem documento oficial): resultado é exibido
      // mas NUNCA tratado como fato do titular
      const aviso = avisoCertidoesVinculo(c.anmCertidoesTitular);
      const marca = aviso ? ` ATENÇÃO — VINCULAÇÃO NÃO CONFIRMADA POR DOCUMENTO: ${aviso} NÃO tratar como fato do titular;` : "";
      return `CERTIDOES_TITULAR (PGFN dívida ativa, CNJ processos judiciais, CEIS sanções;${marca} fonte listada em "erros" = indisponível na consulta, não significa situação regular): ${strip(c.anmCertidoesTitular, 1600)}`;
    },
  },
  {
    key: "cfem",
    render: (c) => c.anmCfem ? `CFEM_PRODUCAO_REAL (recolhimento de CFEM = produção comercializada; processo/titular que nunca recolheu nunca produziu): ${strip(c.anmCfem, 2000)}` : "",
  },
  {
    key: "dou",
    render: (c) => {
      // Só publicações casadas pelo NÚMERO DO PROCESSO alimentam a IA —
      // itens casados apenas por nome do titular são "vinculação não
      // confirmada" e ficam fora dos insumos (apenas exibição rotulada).
      if (!c.anmDou) return "";
      const { confirmadas, naoConfirmadas } = separarPublicacoesDiario(c.anmDou, c.processoAnm);
      const mencionaVigencia = (p: any) =>
        /\b(?:ALVAR[AÁ]|PRORROG|VIG[EÊ]NCIA|VALIDADE|VENCIMENTO|EXPIRA|PRAZO)\b/i.test(
          [p?.tipoAto, p?.titulo, p?.categoria, p?.trecho].filter(Boolean).join(" "),
        );
      const publicacoesSemVigencia = confirmadas.filter((p: any) => !mencionaVigencia(p));
      const omitidasVigencia = confirmadas.length - publicacoesSemVigencia.length;
      if (publicacoesSemVigencia.length === 0 && naoConfirmadas.length > 0) {
        return `PUBLICACOES_DOU: nenhuma publicação vinculada pelo número do processo (${naoConfirmadas.length} casada(s) só por nome do titular — vinculação não confirmada, excluída(s) dos insumos).`;
      }
      if (publicacoesSemVigencia.length === 0) {
        return omitidasVigencia > 0
          ? `PUBLICACOES_DOU: ${omitidasVigencia} ato(s) relacionado(s) à vigência omitido(s) do prompt; usar exclusivamente a VIGÊNCIA CANÔNICA.`
          : "";
      }
      const payload = { ...c.anmDou, publicacoes: publicacoesSemVigencia };
      const nota = naoConfirmadas.length > 0 ? ` [${naoConfirmadas.length} publicação(ões) casada(s) só por nome excluída(s) — vinculação não confirmada]` : "";
      const notaVigencia = omitidasVigencia > 0 ? ` [${omitidasVigencia} ato(s) de vigência omitido(s); usar bloco canônico]` : "";
      return `PUBLICACOES_DOU (atos oficiais casados pelo número do processo no Diário Oficial da União)${nota}${notaVigencia}: ${strip(payload, 2000)}`;
    },
  },
  {
    key: "barragens",
    render: (c) => {
      if (!c.anmBarragens) return "";
      // barragens casadas só por nome do empreendedor NÃO entram como fato
      const { confirmadas, naoConfirmadas } = separarBarragensTitular(c.anmBarragens);
      const payload = { ...c.anmBarragens, doTitular: confirmadas };
      const nota = naoConfirmadas.length > 0
        ? ` [${naoConfirmadas.length} barragem(ns) casada(s) só por nome do empreendedor excluída(s) dos insumos — vinculação não confirmada]`
        : "";
      return `BARRAGENS_SIGBM (barragens do titular e próximas, com categoria de risco e dano potencial)${nota}: ${strip(payload, 1800)}`;
    },
  },
  {
    key: "logistica",
    render: (c) => c.anmLogistica ? `LOGISTICA (ferrovia, porto, linha de transmissão, rodovia e hidrovia mais próximas; fonte não consultada não significa ausência): ${strip(c.anmLogistica, 1500)}` : "",
  },
  {
    key: "tah",
    render: (c) => {
      // TAH só entra no digest quando o vínculo é pelo número COMPLETO do
      // processo (número+ano) — vínculo ambíguo pode misturar titulares de
      // processos alheios e não deve alimentar a IA.
      if (!c.anmTah) return "";
      const vinculo = filtrarTahPorProcesso(c.anmTah, c.processoAnm);
      if (vinculo.ambiguo || vinculo.rows.length === 0) return "";
      return `TAH (Taxa Anual por Hectare — pagamentos em dia indicam titular adimplente na fase de pesquisa): ${strip(vinculo.rows, 1200)}`;
    },
  },
  {
    key: "restricoes",
    render: (c) => c.anmRestricoes ? `RESTRICOES_AMBIENTAIS_FUNDIARIAS (semáforo=${c.anmRestricoes?.semaforo ?? "?"}; camadas não consultadas não significam ausência de restrição): ${strip(c.anmRestricoes, 1800)}` : "",
  },
  {
    key: "sondagem",
    render: (c) => c.anmSondagem ? `SONDAGENS_CPRM_PROXIMAS (furos históricos perto do ativo indicam interesse exploratório prévio na região): ${strip(c.anmSondagem, 1200)}` : "",
  },
  {
    key: "geoquimica",
    render: (c) => c.anmGeoquimica ? `GEOQUIMICA_CPRM: ${strip(c.anmGeoquimica, 800)}` : "",
  },
];

/**
 * Monta o digest com os blocos pedidos (ou todos, se `include` for omitido).
 * Retorna string vazia quando nenhum dos campos existe no ativo.
 */
export function buildDossieDigest(campos: any, include?: DossieBlockKey[]): string {
  const c = campos || {};
  const wanted = include && include.length > 0 ? new Set(include) : null;
  const partes = BLOCOS
    .filter((b) => !wanted || wanted.has(b.key))
    .map((b) => {
      try { return b.render(c); } catch { return ""; }
    })
    .filter(Boolean);
  if (partes.length === 0) return "";
  return `DADOS ENRIQUECIDOS DO DOSSIÊ (JSON compacto por fonte; campo ausente = fonte ainda não consultada):\n${partes.join("\n")}`;
}
