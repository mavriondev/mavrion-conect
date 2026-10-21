/**
 * Motor de alertas de prazo — DERIVADOS determinísticos das datas
 * estruturadas do dossiê (eventos ANM, validade cadastrada, TAH, CFEM).
 *
 * Cada alerta é publicado como DERIVADO com a regra determinística e as
 * datas-fonte exibíveis. Nada aqui usa IA e nada entra no hash de insumos do
 * parecer (os alertas dependem da data de geração do relatório — são
 * recalculados a cada renderização).
 */
import { normalizarTexto } from "./enunciados";
import {
  filtrarEventosReais,
  filtrarTahPorProcesso,
  faixaAnosEscopo,
  type EscopoBases,
} from "./relatorio-vinculos";
import { anexarVigenciaCalculada, obterVigenciaCalculada } from "./vigencia-alvara";

export interface AlertaPrazo {
  id: string;
  titulo: string;
  texto: string;
  /** Regra determinística exibível. */
  regra: string;
  /** Datas usadas no cálculo (exibíveis). */
  datasFonte: string[];
  fonte: string;
  identificador: string | null;
  gravidade: "critico" | "atencao" | "info";
  categoria: "DERIVADO";
  tier: "T1" | "T2";
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Aceita ISO (yyyy-mm-dd...), dd/mm/aaaa e Date. */
export function parseDataFlexivel(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const fmtBr = (d: Date) => d.toLocaleDateString("pt-BR");
const dias = (de: Date, ate: Date) => Math.floor((ate.getTime() - de.getTime()) / DIA_MS);

/**
 * Calcula os alertas de prazo do ativo a partir das datas estruturadas.
 * Determinístico dado (asset, hoje) — sem IA, sem rede.
 */
export function calcularAlertasPrazo(asset: any, hoje: Date = new Date()): AlertaPrazo[] {
  asset = anexarVigenciaCalculada(asset);
  const c = (asset?.camposEspecificos || {}) as any;
  const processo: string | null = c.processoAnm || asset?.anmProcesso || null;
  if (asset?.type !== "MINA" && !processo) return [];

  const alertas: AlertaPrazo[] = [];
  const scm = (asset as any)?.__scmData || null;
  const escopo: EscopoBases | null = (asset as any)?.__escopoBases || null;

  // ── 1. Tempo desde a última movimentação (eventos reais do processo) ──
  const eventos = filtrarEventosReais(c.anmHistorico?.eventos, processo) as any[];
  const datasEventos = eventos
    .map((e) => ({ ev: e, d: parseDataFlexivel(e?.data) }))
    .filter((x) => x.d !== null) as Array<{ ev: any; d: Date }>;
  if (datasEventos.length > 0) {
    const ultimo = datasEventos.reduce((a, b) => (b.d > a.d ? b : a));
    const nDias = dias(ultimo.d, hoje);
    if (nDias > 365) {
      alertas.push({
        id: "sem-movimentacao",
        titulo: "Processo sem movimentação registrada",
        texto: `Última movimentação registrada no Cadastro Mineiro em ${fmtBr(ultimo.d)} (“${String(ultimo.ev?.descricao || "").slice(0, 120)}”) — ${nDias} dias até a data de geração deste relatório.`,
        regra: "dias entre a data do último evento real do processo e a data de geração; alerta quando > 365 dias (crítico quando > 730)",
        datasFonte: [`último evento: ${fmtBr(ultimo.d)}`, `geração: ${fmtBr(hoje)}`],
        fonte: "Eventos ANM (Cadastro Mineiro)",
        identificador: processo,
        gravidade: nDias > 730 ? "critico" : "atencao",
        categoria: "DERIVADO",
        tier: "T1",
      });
    }
  }

  // ── 2. Validade cadastrada vencida / por vencer, com ou sem sucessão ──
  const vigencia = obterVigenciaCalculada(asset);
  const validadeCanonica = vigencia.status === "determinado" ? vigencia.dataVigenciaAtual : null;
  const validade = parseDataFlexivel(validadeCanonica || c.validadeAnm);
  const origemValidade = validadeCanonica ? "vigência determinística" : "validade cadastrada";
  if (validade) {
    const nDias = dias(validade, hoje);
    if (nDias > 0) {
      // vencida — houve evento posterior compatível com prorrogação/outorga?
      const sucessao = datasEventos.find(
        (x) => x.d > validade && /prorrog|renov|outorga|concess/.test(normalizarTexto(x.ev?.descricao || "")),
      );
      if (sucessao) {
        alertas.push({
          id: "validade-vencida-com-evento",
          titulo: "Validade cadastrada vencida, com evento posterior",
          texto: `A ${origemValidade} venceu em ${fmtBr(validade)}; há evento posterior compatível com prorrogação/outorga em ${fmtBr(sucessao.d)} (“${String(sucessao.ev?.descricao || "").slice(0, 120)}”) — revisar a cadeia estruturada de vigência.`,
          regra: "data de validade do cadastro < data de geração E existe evento real posterior com termo de prorrogação/renovação/outorga/concessão",
          datasFonte: [`${origemValidade}: ${fmtBr(validade)}`, `evento posterior: ${fmtBr(sucessao.d)}`, `geração: ${fmtBr(hoje)}`],
          fonte: validadeCanonica ? "Cálculo determinístico + Eventos ANM (Cadastro Mineiro)" : "Cadastro do ativo + Eventos ANM (Cadastro Mineiro)",
          identificador: processo,
          gravidade: "info",
          categoria: "DERIVADO",
          tier: "T1",
        });
      } else {
        alertas.push({
          id: "titulo-vencido-sem-sucessao",
          titulo: "Título/validade vencido sem registro de sucessão",
          texto: `A ${origemValidade} venceu em ${fmtBr(validade)} (${nDias} dias antes da geração deste relatório) e não há, nos eventos consultados, registro posterior de prorrogação, renovação ou outorga.`,
          regra: "data de validade do cadastro < data de geração E nenhum evento real posterior contém prorrogação/renovação/outorga/concessão",
          datasFonte: [`${origemValidade}: ${fmtBr(validade)}`, `geração: ${fmtBr(hoje)}`],
          fonte: validadeCanonica ? "Cálculo determinístico + Eventos ANM (Cadastro Mineiro)" : "Cadastro do ativo + Eventos ANM (Cadastro Mineiro)",
          identificador: processo,
          gravidade: "critico",
          categoria: "DERIVADO",
          tier: "T2",
        });
      }
    } else if (nDias >= -180) {
      alertas.push({
        id: "validade-proxima",
        titulo: "Validade cadastrada vence em menos de 180 dias",
        texto: `A ${origemValidade} vence em ${fmtBr(validade)} — ${Math.abs(nDias)} dias após a data de geração deste relatório.`,
        regra: "0 ≤ dias entre a geração e a data de validade do cadastro ≤ 180",
        datasFonte: [`${origemValidade}: ${fmtBr(validade)}`, `geração: ${fmtBr(hoje)}`],
        fonte: validadeCanonica ? "Cálculo determinístico dos Eventos ANM (Cadastro Mineiro)" : "Cadastro do ativo",
        identificador: processo,
        gravidade: "atencao",
        categoria: "DERIVADO",
        tier: "T2",
      });
    }
  }

  // ── 3. TAH sem registro recente dentro da cobertura da base ──
  // Obrigação anual da autorização de pesquisa; conclusão limitada ao período
  // coberto pela base importada (nunca generalizar além do escopo).
  const fase = normalizarTexto(String(c.faseAnm || scm?.fase || ""));
  const emPesquisa = /pesquisa/.test(fase);
  const vinculoTah = filtrarTahPorProcesso(c.anmTah, processo);
  const anoMaxBase = escopo?.tah?.anoMax ?? null;
  if (emPesquisa && !vinculoTah.ambiguo && anoMaxBase != null) {
    const anos = (vinculoTah.rows as any[])
      .map((r) => Number(r?.ano_base ?? r?.anoBase))
      .filter((n) => Number.isFinite(n));
    if (anos.length > 0) {
      const anoMaxProc = Math.max(...anos);
      if (anoMaxProc < anoMaxBase) {
        const faixaFaltante = anoMaxProc + 1 === anoMaxBase ? String(anoMaxBase) : `${anoMaxProc + 1}–${anoMaxBase}`;
        alertas.push({
          id: "tah-sem-registro-recente",
          titulo: "Obrigação periódica (TAH) sem registro recente na base coberta",
          texto: `Processo em fase de pesquisa com último registro de TAH no ano-base ${anoMaxProc}; a base importada cobre até ${anoMaxBase} — sem registro de TAH para ${faixaFaltante} dentro da cobertura da base.`,
          regra: "fase contém “pesquisa” E maior ano-base de TAH do processo < último ano coberto pela base TAH importada",
          datasFonte: [`último ano-base TAH do processo: ${anoMaxProc}`, `cobertura da base TAH: ${faixaAnosEscopo(escopo?.tah)}`],
          fonte: "Base TAH/ANM (dados abertos importados)",
          identificador: processo,
          gravidade: "atencao",
          categoria: "DERIVADO",
          tier: "T1",
        });
      }
    } else if (c.anmTah != null) {
      alertas.push({
        id: "tah-sem-registro",
        titulo: "Obrigação periódica (TAH) sem nenhum registro na base coberta",
        texto: `Processo em fase de pesquisa sem nenhum registro de TAH na base importada (cobertura: ${faixaAnosEscopo(escopo?.tah)}).`,
        regra: "fase contém “pesquisa” E zero registros de TAH vinculados ao processo dentro da base importada",
        datasFonte: [`cobertura da base TAH: ${faixaAnosEscopo(escopo?.tah)}`],
        fonte: "Base TAH/ANM (dados abertos importados)",
        identificador: processo,
        gravidade: "atencao",
        categoria: "DERIVADO",
        tier: "T1",
      });
    }
  }

  // ── 4. Produção interrompida dentro da cobertura da base CFEM ──
  const cfemProc = c.anmCfem?.disponivel ? c.anmCfem?.processo : null;
  const anoMaxCfemBase = escopo?.cfem?.anoMax ?? null;
  if (cfemProc?.jaProduziu && Array.isArray(cfemProc.porAno) && cfemProc.porAno.length > 0 && anoMaxCfemBase != null) {
    const anosCfem = cfemProc.porAno.map((a: any) => Number(a?.ano)).filter((n: number) => Number.isFinite(n));
    if (anosCfem.length > 0) {
      const anoMaxRecolhimento = Math.max(...anosCfem);
      if (anoMaxRecolhimento < anoMaxCfemBase) {
        const faixaFaltante = anoMaxRecolhimento + 1 === anoMaxCfemBase ? String(anoMaxCfemBase) : `${anoMaxRecolhimento + 1}–${anoMaxCfemBase}`;
        alertas.push({
          id: "cfem-sem-recolhimento-recente",
          titulo: "Recolhimento de CFEM interrompido dentro da base coberta",
          texto: `O processo tem recolhimentos de CFEM até ${anoMaxRecolhimento}; a base importada cobre até ${anoMaxCfemBase} — sem recolhimento para ${faixaFaltante} dentro da cobertura da base.`,
          regra: "processo com CFEM recolhida E maior ano de recolhimento < último ano coberto pela base CFEM importada",
          datasFonte: [`último ano com recolhimento: ${anoMaxRecolhimento}`, `cobertura da base CFEM: ${faixaAnosEscopo(escopo?.cfem)}`],
          fonte: "Base CFEM/ANM (dados abertos importados)",
          identificador: processo,
          gravidade: "info",
          categoria: "DERIVADO",
          tier: "T1",
        });
      }
    }
  }

  return alertas;
}
