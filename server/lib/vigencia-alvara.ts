import { filtrarEventosReais } from "./relatorio-vinculos";
import { createHash } from "node:crypto";

export type StatusVigenciaAlvara = "determinado" | "indeterminado";

export interface EventoVigenciaAlvara {
  data?: unknown;
  descricao?: unknown;
  tipo?: unknown;
  publicacaoDou?: unknown;
}

export interface EtapaVigenciaAlvara {
  tipo: "ato_inicial" | "alteracao" | "prorrogacao";
  dataEvento: string;
  descricao: string;
  prazoAnos: number | null;
  dataAnterior: string | null;
  dataResultante: string;
}

export interface ResultadoVigenciaAlvara {
  status: StatusVigenciaAlvara;
  dataVigenciaAtual: string | null;
  dataVigenciaIso: string | null;
  memoriaCalculo: string;
  etapas: EtapaVigenciaAlvara[];
  motivosIndeterminacao: string[];
  fonte: "Eventos ANM (Cadastro Mineiro)";
}

export interface MencaoVigencia {
  data: string;
  contexto: string;
}

export class ConflitoVigenciaAlvaraError extends Error {
  readonly dataCanonica: string;
  readonly mencoesConflitantes: MencaoVigencia[];

  constructor(dataCanonica: string, mencoesConflitantes: MencaoVigencia[]) {
    const detalhes = mencoesConflitantes.map((m) => `${m.data} em “${m.contexto.slice(0, 180)}”`).join("; ");
    super(`Relatório bloqueado: vigência conflitante para o alvará. Data canônica ${dataCanonica}; ocorrência(s): ${detalhes}`);
    this.name = "ConflitoVigenciaAlvaraError";
    this.dataCanonica = dataCanonica;
    this.mencoesConflitantes = mencoesConflitantes;
  }
}

const FONTE = "Eventos ANM (Cadastro Mineiro)" as const;
const DATA_BR_OU_ISO = String.raw`(?:\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})`;

function normalizar(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseData(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return dataPorPartes(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return dataPorPartes(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function dataPorPartes(ano: number, mes: number, dia: number): Date | null {
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
  return data;
}

function fmtBr(data: Date): string {
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getFullYear()}`;
}

function fmtIso(data: Date): string {
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function somarAnos(data: Date, anos: number): Date {
  const ano = data.getFullYear() + anos;
  const mes = data.getMonth();
  const dia = data.getDate();
  const resultado = new Date(ano, mes, dia);
  if (resultado.getMonth() !== mes) return new Date(ano, mes + 1, 0);
  return resultado;
}

function textoEvento(evento: EventoVigenciaAlvara): string {
  return [evento.descricao, evento.tipo, evento.publicacaoDou].filter(Boolean).join(" — ");
}

function extrairPrazoAnos(textoNormalizado: string): number | null {
  const padroes = [
    /\b(?:PRAZO|PERIODO|VIGENCIA)(?:\s+(?:DE|POR))?\s*:?\s*(\d{1,2})\s*ANOS?\b/,
    /\b(\d{1,2})\s*ANOS?\s*(?:DE\s+(?:PRAZO|VIGENCIA))?\b/,
  ];
  for (const padrao of padroes) {
    const match = textoNormalizado.match(padrao);
    if (!match) continue;
    const anos = Number(match[1]);
    if (Number.isInteger(anos) && anos > 0 && anos <= 20) return anos;
  }
  return null;
}

function extrairNovaDataVencimento(textoNormalizado: string): Date | null {
  const padroes = [
    new RegExp(`(?:VENCIMENTO|VALIDADE|VIGENCIA)[^.;\\n]{0,120}?(?:ALTERAD[OA]|RETIFICAD[OA])?[^.;\\n]{0,50}?(?:PARA|ATE|EM|:)\\s*(${DATA_BR_OU_ISO})`, "i"),
    new RegExp(`(?:ALTERACAO|ALTERAD[OA]|RETIFICACAO|RETIFICAD[OA])[^.;\\n]{0,100}?(?:VENCIMENTO|VALIDADE|VIGENCIA)[^.;\\n]{0,50}?(?:PARA|ATE|EM|:|-)?\\s*(${DATA_BR_OU_ISO})`, "i"),
    new RegExp(`(?:VENCIMENTO|VALIDADE|VIGENCIA)[^.;\\n]{0,80}?(?:ALTERAD[OA]|RETIFICAD[OA])[^.;\\n]{0,40}?(${DATA_BR_OU_ISO})`, "i"),
  ];
  for (const padrao of padroes) {
    const match = textoNormalizado.match(padrao);
    const data = match ? parseData(match[1]) : null;
    if (data) return data;
  }
  return null;
}

function descricaoCurta(evento: EventoVigenciaAlvara): string {
  return String(evento.descricao || evento.tipo || "evento ANM").replace(/\s+/g, " ").trim().slice(0, 180);
}

function rotuloAlteracao(textoNormalizado: string, dataEvento: string): string {
  const resolucao = textoNormalizado.match(/\bRES(?:OLUCAO)?\.?\s*(?:ANM\s*)?N?[ºO°]?\s*(\d+)\s*\/\s*(\d{4})\b/);
  if (resolucao) return `Res. ${resolucao[1]}/${resolucao[2]}`;
  const decisao = textoNormalizado.includes("DECISAO JUDICIAL") ? "decisão judicial" : null;
  return decisao || `evento ANM de ${dataEvento}`;
}

/**
 * Calcula a vigência somente quando cada operação possui dados explícitos.
 * Evento incompleto que possa alterar a data torna o resultado indeterminado.
 */
export function calcularVigenciaAlvara(eventosEntrada: EventoVigenciaAlvara[] | null | undefined): ResultadoVigenciaAlvara {
  const eventos = (Array.isArray(eventosEntrada) ? eventosEntrada : [])
    .map((evento, indice) => ({ evento, indice, data: parseData(evento?.data) }))
    .filter((item): item is { evento: EventoVigenciaAlvara; indice: number; data: Date } => item.data !== null)
    .sort((a, b) => a.data.getTime() - b.data.getTime() || a.indice - b.indice);

  let vigencia: Date | null = null;
  let memoria = "";
  let etapas: EtapaVigenciaAlvara[] = [];
  let bloqueios: string[] = [];

  for (const { evento, data } of eventos) {
    const textoOriginal = textoEvento(evento);
    const texto = normalizar(textoOriginal);
    const dataEvento = fmtBr(data);
    const ehProrrogacao = /\bPRORROG/.test(texto);
    const ehAlteracao = (
      /(?:ALTERACAO|ALTERAD[OA]|RETIFICACAO|RETIFICAD[OA]).*(?:VENCIMENTO|VALIDADE|VIGENCIA)/.test(texto)
      || /(?:VENCIMENTO|VALIDADE|VIGENCIA).*(?:ALTERACAO|ALTERAD[OA]|RETIFICACAO|RETIFICAD[OA])/.test(texto)
    ) && !ehProrrogacao;
    const ehAtoInicial = !ehProrrogacao && !ehAlteracao
      && (/\bALVARA\b.*\bPESQUISA\b/.test(texto) || /\bAUTORIZACAO\b.*\bPESQUISA\b/.test(texto));
    const ehEventoExtintivo = /\b(?:REVOGAD[OA]S?|CANCELAD[OA]S?|ANULAD[OA]S?|EXTINT[OA]S?|SEM EFEITO)\b/.test(texto)
      && /\b(?:ALVARA|AUTORIZACAO|TITULO)\b/.test(texto);
    const ehAtoSemEficacia = /\b(?:INDEFERID[OA]S?|NEGAD[OA]S?|ARQUIVAD[OA]S?|CANCELAD[OA]S?|REVOGAD[OA]S?|ANULAD[OA]S?|MINUTA|PROPOSTA)\b/.test(texto)
      || /\bNAO\s+(?:DEFERID[OA]S?|CONCEDID[OA]S?|APROVAD[OA]S?|PUBLICAD[OA]S?|ALTERAD[OA]S?)\b/.test(texto)
      || /\b(?:PEDIDO|REQUERIMENTO|SOLICITACAO)\s+(?:DE\s+)?(?:PRORROG|ALTERACAO|RETIFICACAO)\b/.test(texto);
    const temEficaciaInicial = /\b(?:PUBLICAD[OA]S?|OUTORGAD[OA]S?|CONCEDID[OA]S?|EMITID[OA]S?|EXPEDID[OA]S?)\b/.test(texto);
    const temEficaciaProrrogacao = /\b(?:PUBLICAD[OA]S?|DEFERID[OA]S?|CONCEDID[OA]S?|OUTORGAD[OA]S?|APROVAD[OA]S?)\b/.test(texto);

    if (ehEventoExtintivo && vigencia) {
      bloqueios.push(`evento potencialmente extintivo do título em ${dataEvento}`);
      continue;
    }

    if (ehAtoInicial) {
      if (ehAtoSemEficacia || !temEficaciaInicial) {
        bloqueios.push(`ato inicial de ${dataEvento} sem eficácia expressa`);
        continue;
      }
      const prazoAnos = extrairPrazoAnos(texto);
      if (!prazoAnos) {
        if (!vigencia) bloqueios.push(`ato inicial de ${dataEvento} sem duração explícita`);
        continue;
      }
      const dataFinal = somarAnos(data, prazoAnos);
      vigencia = dataFinal;
      bloqueios = [];
      etapas = [{
        tipo: "ato_inicial",
        dataEvento,
        descricao: descricaoCurta(evento),
        prazoAnos,
        dataAnterior: null,
        dataResultante: fmtBr(dataFinal),
      }];
      memoria = `${dataEvento} (+${prazoAnos}a) → ${fmtBr(dataFinal)}`;
      continue;
    }

    if (ehAlteracao) {
      if (ehAtoSemEficacia) {
        bloqueios.push(`alteração de vencimento em ${dataEvento} sem eficácia expressa`);
        continue;
      }
      if (!vigencia) {
        bloqueios.push(`alteração de vencimento em ${dataEvento} sem ato inicial determinável`);
        continue;
      }
      const novaData = extrairNovaDataVencimento(texto);
      if (!novaData) {
        bloqueios.push(`alteração de vencimento em ${dataEvento} sem nova data explícita`);
        continue;
      }
      const anterior = fmtBr(vigencia);
      vigencia = novaData;
      etapas.push({
        tipo: "alteracao",
        dataEvento,
        descricao: descricaoCurta(evento),
        prazoAnos: null,
        dataAnterior: anterior,
        dataResultante: fmtBr(novaData),
      });
      memoria += ` → [alterado por ${rotuloAlteracao(texto, dataEvento)}] → ${fmtBr(novaData)}`;
      continue;
    }

    if (ehProrrogacao) {
      if (ehAtoSemEficacia || !temEficaciaProrrogacao) {
        bloqueios.push(`prorrogação de ${dataEvento} sem eficácia expressa`);
        continue;
      }
      if (!vigencia) {
        bloqueios.push(`prorrogação de ${dataEvento} sem vigência-base determinável`);
        continue;
      }
      const prazoAnos = extrairPrazoAnos(texto);
      if (!prazoAnos) {
        bloqueios.push(`prorrogação de ${dataEvento} sem duração explícita`);
        continue;
      }
      const anterior = fmtBr(vigencia);
      const dataFinal = somarAnos(vigencia, prazoAnos);
      vigencia = dataFinal;
      etapas.push({
        tipo: "prorrogacao",
        dataEvento,
        descricao: descricaoCurta(evento),
        prazoAnos,
        dataAnterior: anterior,
        dataResultante: fmtBr(dataFinal),
      });
      memoria += ` → [+${prazoAnos}a prorrogação ${dataEvento}] → ${fmtBr(dataFinal)}`;
    }
  }

  if (!vigencia || bloqueios.length > 0) {
    const motivos = bloqueios.length > 0 ? [...new Set(bloqueios)] : ["nenhuma cadeia completa de vigência foi encontrada nos eventos"];
    return {
      status: "indeterminado",
      dataVigenciaAtual: null,
      dataVigenciaIso: null,
      memoriaCalculo: memoria || `Vigência indeterminada: ${motivos.join("; ")}.`,
      etapas,
      motivosIndeterminacao: motivos,
      fonte: FONTE,
    };
  }

  return {
    status: "determinado",
    dataVigenciaAtual: fmtBr(vigencia),
    dataVigenciaIso: fmtIso(vigencia),
    memoriaCalculo: memoria,
    etapas,
    motivosIndeterminacao: [],
    fonte: FONTE,
  };
}

export function calcularVigenciaDoAtivo(asset: any): ResultadoVigenciaAlvara {
  const pronta = asset?.__vigenciaAlvara as ResultadoVigenciaAlvara | undefined;
  if (pronta?.status && typeof pronta.memoriaCalculo === "string") return pronta;
  const c = (asset?.camposEspecificos || {}) as any;
  const processo = c.processoAnm || asset?.anmProcesso || asset?.attributesJson?.anmProcesso || null;
  const eventos = filtrarEventosReais(c.anmHistorico?.eventos, processo) as EventoVigenciaAlvara[];
  return calcularVigenciaAlvara(eventos);
}

export function hashInsumosVigenciaDoAtivo(asset: any): string {
  const c = (asset?.camposEspecificos || {}) as any;
  const processo = c.processoAnm || asset?.anmProcesso || asset?.attributesJson?.anmProcesso || null;
  const eventos = filtrarEventosReais(c.anmHistorico?.eventos, processo)
    .map((evento: any) => ({
      data: String(evento?.data ?? evento?.dataEvento ?? ""),
      descricao: String(evento?.descricao ?? evento?.evento ?? evento?.tipo ?? ""),
      publicacaoDou: String(evento?.publicacaoDou ?? evento?.publicacao ?? ""),
    }))
    .sort((a, b) => `${a.data}|${a.descricao}`.localeCompare(`${b.data}|${b.descricao}`));
  return createHash("sha256").update(JSON.stringify({ processo, eventos })).digest("hex");
}

export function anexarVigenciaCalculada(asset: any): any {
  if (asset?.__vigenciaAlvara) return asset;
  const c = (asset?.camposEspecificos || {}) as any;
  const insumosHash = hashInsumosVigenciaDoAtivo(asset);
  const persistida = c.vigenciaAlvaraCalculada as (ResultadoVigenciaAlvara & { insumosHash?: string }) | undefined;
  const resultado = persistida?.insumosHash === insumosHash
    ? persistida
    : calcularVigenciaDoAtivo(asset);
  return { ...asset, __vigenciaAlvara: resultado, __vigenciaAlvaraInsumosHash: insumosHash };
}

export function obterVigenciaCalculada(asset: any): ResultadoVigenciaAlvara {
  const pronta = asset?.__vigenciaAlvara as ResultadoVigenciaAlvara | undefined;
  if (!pronta?.status || typeof pronta.memoriaCalculo !== "string") {
    throw new Error("Vigência canônica não foi preparada para este fluxo.");
  }
  return pronta;
}

export function formatarVigenciaParaPrompt(resultado: ResultadoVigenciaAlvara): string {
  if (resultado.status === "determinado") {
    return `VIGÊNCIA CANÔNICA DO ALVARÁ (fato calculado pelo sistema; NÃO RECALCULAR):
- Vigência atual: ${resultado.dataVigenciaAtual}
- Memória de cálculo: ${resultado.memoriaCalculo}
- Regra para o modelo: cite somente a vigência atual acima. Eventos brutos não são fornecidos; não refaça nem complete o cálculo por outras fontes.`;
  }
  return `VIGÊNCIA CANÔNICA DO ALVARÁ: INDETERMINADA.
- Motivo: ${resultado.motivosIndeterminacao.join("; ")}
- Regra para o modelo: não calcule nem estime uma data de vencimento por histórico, documentos ou pesquisa externa.`;
}

export function contextoVigenciaMinerariaParaPrompt(resultado: ResultadoVigenciaAlvara): string {
  return formatarVigenciaParaPrompt(resultado);
}

export function omitirTrechosDeVigenciaParaIa(texto: unknown): string {
  return String(texto ?? "")
    .split(/(?<=[.!?])\s+|\n/)
    .map((trecho) =>
      /\b(?:ALVAR[AÁ]|PRORROG|VIG[EÊ]NCIA|VALIDADE|VENCIMENTO|EXPIRA|PRAZO)\b/i.test(trecho)
        ? "[Trecho relacionado à vigência omitido; usar exclusivamente a VIGÊNCIA CANÔNICA.]"
        : trecho,
    )
    .join("\n");
}

export function extrairMencoesVigencia(
  texto: string,
  opcoes: { escopoMinerario?: boolean } = {},
): MencaoVigencia[] {
  const padraoData = new RegExp(DATA_BR_OU_ISO, "g");
  const mencoes: MencaoVigencia[] = [];
  for (const match of texto.matchAll(padraoData)) {
    const data = parseData(match[0]);
    if (!data) continue;
    const indice = match.index ?? 0;
    const delimitadores = /[.;!?\n]/;
    let inicioClausula = indice - 1;
    while (inicioClausula >= 0 && !delimitadores.test(texto[inicioClausula])) inicioClausula--;
    let fimClausula = indice + match[0].length;
    while (fimClausula < texto.length && !delimitadores.test(texto[fimClausula])) fimClausula++;
    const clausula = texto.slice(inicioClausula + 1, fimClausula).trim();

    const inicioLinha = texto.lastIndexOf("\n", indice - 1) + 1;
    const fimLinhaBruto = texto.indexOf("\n", indice + match[0].length);
    const fimLinha = fimLinhaBruto === -1 ? texto.length : fimLinhaBruto;
    const linhaAtual = texto.slice(inicioLinha, fimLinha).trim();
    const prefixo = texto.slice(0, Math.max(0, inicioLinha - 1));
    const linhasAnteriores = prefixo.split("\n").slice(-2).join(" ");
    const blocoTabela = `${linhasAnteriores} ${linhaAtual}`.trim();

    const contextos = [clausula];
    if (linhaAtual.length <= 90 && !/[.!?]/.test(linhaAtual)) contextos.push(blocoTabela);
    const contexto = contextos.find((candidato) => {
      const n = normalizar(candidato);
      const posicaoData = candidato.indexOf(match[0]);
      const antesDaData = normalizar(posicaoData >= 0 ? candidato.slice(Math.max(0, posicaoData - 120), posicaoData) : "");
      const temAlvaraExplicito = /\b(?:ALVARA|TITULO MINERARIO|DIREITO MINERARIO)\b/.test(n);
      const temProcessoAnm = /\bPROCESSO ANM\b/.test(n);
      const temOutroTitulo = /\b(?:LICENCA|LICENCIAMENTO|AUTORIZACAO)\s+(?:AMBIENTAL|DE OPERACAO|DE INSTALACAO|PREVIA|FLORESTAL)\b/.test(n);
      const temObjetoMinerario = !temOutroTitulo
        && (opcoes.escopoMinerario || temAlvaraExplicito || temProcessoAnm);
      const temPredicadoPrazo = /\b(?:VIGENCIA|VALIDADE|VENCIMENTO|VENCE|VENCERA|VENCIDO|EXPIRA|EXPIRACAO|VALID[OA]\s+ATE)\b/.test(antesDaData);
      return temObjetoMinerario && temPredicadoPrazo;
    });
    if (!contexto) continue;
    mencoes.push({ data: fmtBr(data), contexto: contexto.replace(/\s+/g, " ").trim() });
  }
  return mencoes;
}

export function textoLegadoSemConflitoVigencia(texto: unknown, resultado: ResultadoVigenciaAlvara): string | null {
  const valor = String(texto ?? "").trim();
  if (!valor || resultado.status !== "determinado" || !resultado.dataVigenciaAtual) return valor || null;
  return extrairMencoesVigencia(valor, { escopoMinerario: true }).some((m) => m.data !== resultado.dataVigenciaAtual) ? null : valor;
}

export function validarConsistenciaVigenciaTexto(
  texto: string,
  resultado: ResultadoVigenciaAlvara,
  opcoes: { escopoMinerario?: boolean } = {},
): void {
  if (resultado.status !== "determinado" || !resultado.dataVigenciaAtual) return;
  const conflitos = extrairMencoesVigencia(texto, opcoes).filter((m) => m.data !== resultado.dataVigenciaAtual);
  if (conflitos.length === 0) return;
  throw new ConflitoVigenciaAlvaraError(resultado.dataVigenciaAtual, conflitos);
}