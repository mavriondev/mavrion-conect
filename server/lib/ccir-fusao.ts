// Consolidação da base fundiária do ativo minerário (CCIR por imóvel):
// agrupa parcelas SIGEF por código do imóvel (SNCR/INCRA), funde com os
// imóveis CAR casados por geometria (parcela dentro do imóvel CAR ⇒ mesma
// propriedade) e adiciona os CAR sem correspondência como entradas próprias.
// Lógica pura (sem rede/BD) para ser testável.

import { sanearSobreposicao } from "./sanidade-numerica";

export interface ImovelFundiario {
  codigoIncra: string | null;
  codigoCar: string | null;
  denominacao: string | null;
  detentores: string[];
  situacao: string | null;
  areaHa: number | null;
  /** área de interseção com o polígono do processo, em ha (soma das parcelas) */
  sobreposicaoHa: number | null;
  sobreposicaoPct: number | null;
  registroMatricula: string | null;
  municipioIbge: number | null;
  municipio: string | null;
  uf: string | null;
  origem: "SIGEF" | "CAR" | "SIGEF+CAR";
  parcelas: string[];
  /**
   * Pareamento SIGEF×CAR: "consolidado" quando casado por geometria ≥ limiar;
   * "nao_consolidado" quando o melhor candidato ficou ABAIXO do limiar — as
   * fontes devem ser exibidas separadamente. Ausente quando não houve
   * candidato de pareamento em jogo.
   */
  consolidacao?: "consolidado" | "nao_consolidado";
  consolidacaoMotivo?: string;
  /** sanidade numérica falhou — o motivo substitui os números na exibição */
  sobreposicaoAVerificar?: string;
}

/** Info do casamento geométrico (casarParcelasSigefComCar) além dos pares aceitos. */
export interface CasamentoInfo {
  /** parcela SIGEF → melhor candidato CAR abaixo do limiar (aceita Map ou objeto vindo de JSON) */
  abaixoLimiar?: Map<string, { codImovel: string; fracaoPct: number }> | Record<string, { codImovel: string; fracaoPct: number }>;
  limiarPct?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mergeDetentores(alvo: string[], fonte: string | string[] | null | undefined): void {
  const nomes = Array.isArray(fonte)
    ? fonte
    : String(fonte ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const nome of nomes) {
    if (nome && !alvo.includes(nome)) alvo.push(nome);
  }
}

/**
 * Consolida parcelas SIGEF sobrepostas + imóveis CAR sobrepostos em imóveis
 * únicos. `parcelaParaCar` (codigoParcela → codImovel CAR) vem do casamento
 * geométrico; quando várias entradas SIGEF apontam para o mesmo imóvel CAR,
 * todas são coalescidas num único registro (origem "SIGEF+CAR").
 */
export function consolidarImoveisFundiarios(
  parcelasSobrepostas: any[],
  carSobrepostos: any[],
  parcelaParaCar: Map<string, string>,
  casamentoInfo?: CasamentoInfo,
): ImovelFundiario[] {
  const limiarPct = casamentoInfo?.limiarPct ?? 60;
  const abaixoLimiar: Map<string, { codImovel: string; fracaoPct: number }> =
    casamentoInfo?.abaixoLimiar instanceof Map
      ? casamentoInfo.abaixoLimiar
      : new Map(Object.entries(casamentoInfo?.abaixoLimiar || {}));
  // 1) agrupa parcelas SIGEF por código do imóvel (SNCR/INCRA)
  const porImovel = new Map<string, ImovelFundiario>();
  for (const p of parcelasSobrepostas) {
    const codigoLimpo = p.codigoImovel ? String(p.codigoImovel).replace(/\D/g, "") : "";
    const key = codigoLimpo || `parcela:${p.codigoParcela || Math.random()}`;
    const cur = porImovel.get(key) || {
      codigoIncra: p.codigoImovel || null,
      codigoCar: null,
      denominacao: null,
      detentores: [] as string[],
      situacao: null,
      areaHa: 0,
      sobreposicaoHa: null,
      sobreposicaoPct: 0,
      sobreposicaoAVerificar: undefined as string | undefined,
      registroMatricula: null,
      municipioIbge: p.municipioIbge ?? null,
      municipio: null,
      uf: null,
      origem: "SIGEF" as const,
      parcelas: [] as string[],
    };
    if (!cur.denominacao && p.nomeArea) cur.denominacao = p.nomeArea;
    if (p.detentor) mergeDetentores(cur.detentores, p.detentor);
    if (!cur.situacao && (p.situacao || p.status)) cur.situacao = p.situacao || p.status;
    if (!cur.registroMatricula && p.registroMatricula) cur.registroMatricula = p.registroMatricula;
    if (p.areaHa != null) cur.areaHa = round2((cur.areaHa ?? 0) + p.areaHa);
    if (p.sobreposicaoHa != null) cur.sobreposicaoHa = round2((cur.sobreposicaoHa ?? 0) + p.sobreposicaoHa);
    if (p.sobreposicaoPct != null) cur.sobreposicaoPct = round2((cur.sobreposicaoPct ?? 0) + p.sobreposicaoPct);
    // parcela com número "a verificar" contamina a soma do imóvel
    if (p.sobreposicaoAVerificar && !cur.sobreposicaoAVerificar) {
      cur.sobreposicaoAVerificar = `soma inclui parcela com sobreposição "a verificar" (${p.sobreposicaoAVerificar})`;
    }
    if (p.codigoParcela) cur.parcelas.push(p.codigoParcela);
    porImovel.set(key, cur);
  }

  // 2) código CAR → chaves SIGEF correspondentes (via parcelas casadas por geometria)
  const carParaChaves = new Map<string, string[]>();
  for (const [key, entry] of Array.from(porImovel.entries())) {
    for (const cod of entry.parcelas) {
      const codCar = parcelaParaCar.get(cod);
      if (!codCar) continue;
      const chaves = carParaChaves.get(codCar) || [];
      if (!chaves.includes(key)) chaves.push(key);
      carParaChaves.set(codCar, chaves);
    }
  }

  // 3) coalesce entradas SIGEF que apontam para o mesmo imóvel CAR: pela regra
  //    do casamento, são a mesma propriedade — funde parcelas, detentores,
  //    áreas e campos complementares num único registro.
  for (const chaves of Array.from(carParaChaves.values())) {
    if (chaves.length < 2) continue;
    const principal = porImovel.get(chaves[0])!;
    for (const chave of chaves.slice(1)) {
      const outro = porImovel.get(chave);
      if (!outro) continue;
      // dois códigos INCRA dentro do mesmo CAR: preserva ambos, separados por " / "
      if (outro.codigoIncra) {
        principal.codigoIncra = principal.codigoIncra
          ? Array.from(new Set(`${principal.codigoIncra} / ${outro.codigoIncra}`.split(" / "))).join(" / ")
          : outro.codigoIncra;
      }
      if (!principal.denominacao && outro.denominacao) principal.denominacao = outro.denominacao;
      mergeDetentores(principal.detentores, outro.detentores);
      if (!principal.situacao && outro.situacao) principal.situacao = outro.situacao;
      if (!principal.registroMatricula && outro.registroMatricula) principal.registroMatricula = outro.registroMatricula;
      if (principal.municipioIbge == null && outro.municipioIbge != null) principal.municipioIbge = outro.municipioIbge;
      if (outro.areaHa != null) principal.areaHa = round2((principal.areaHa ?? 0) + outro.areaHa);
      if (outro.sobreposicaoHa != null) principal.sobreposicaoHa = round2((principal.sobreposicaoHa ?? 0) + outro.sobreposicaoHa);
      if (outro.sobreposicaoPct != null) principal.sobreposicaoPct = round2((principal.sobreposicaoPct ?? 0) + outro.sobreposicaoPct);
      for (const cod of outro.parcelas) if (!principal.parcelas.includes(cod)) principal.parcelas.push(cod);
      porImovel.delete(chave);
    }
  }

  // 4) imóveis CAR: funde nos registros SIGEF casados; os demais viram entradas próprias
  for (const i of carSobrepostos) {
    const chaves = i.codImovel ? carParaChaves.get(i.codImovel) : undefined;
    const chaveSigef = chaves?.find((k) => porImovel.has(k));
    if (chaveSigef) {
      const cur = porImovel.get(chaveSigef)!;
      if (!cur.codigoCar) cur.codigoCar = i.codImovel;
      cur.origem = "SIGEF+CAR";
      if (!cur.municipio && i.municipio) cur.municipio = i.municipio;
      if (!cur.uf && i.uf) cur.uf = i.uf;
      if (cur.municipioIbge == null && i.municipioIbge != null) cur.municipioIbge = i.municipioIbge;
      if (!cur.situacao && i.status) cur.situacao = `${i.status}${i.condicao ? ` — ${i.condicao}` : ""} (CAR)`;
      continue;
    }
    const key = `car:${i.codImovel}`;
    if (porImovel.has(key)) continue;
    porImovel.set(key, {
      codigoIncra: null,
      codigoCar: i.codImovel || null,
      denominacao: null,
      detentores: [],
      situacao: i.status ? `${i.status}${i.condicao ? ` — ${i.condicao}` : ""} (CAR)` : null,
      areaHa: i.areaHa ?? null,
      sobreposicaoHa: i.sobreposicaoHa ?? null,
      sobreposicaoPct: i.sobreposicaoPct ?? null,
      ...(i.sobreposicaoAVerificar ? { sobreposicaoAVerificar: i.sobreposicaoAVerificar } : {}),
      registroMatricula: null,
      municipioIbge: i.municipioIbge ?? null,
      municipio: i.municipio ?? null,
      uf: i.uf ?? null,
      origem: "CAR",
      parcelas: [],
    });
  }

  // 5) rótulo de consolidação: fusões efetivas ficam "consolidado"; pareamentos
  //    cujo melhor candidato ficou abaixo do limiar ficam "nao_consolidado"
  //    (fontes exibidas separadamente) — nos DOIS lados do par.
  const carAbaixo = new Map<string, { parcela: string; fracaoPct: number }>();
  for (const [parcela, cand] of Array.from(abaixoLimiar.entries())) {
    carAbaixo.set(cand.codImovel, { parcela, fracaoPct: cand.fracaoPct });
  }
  for (const rec of Array.from(porImovel.values())) {
    if (rec.origem === "SIGEF+CAR") {
      rec.consolidacao = "consolidado";
      continue;
    }
    if (rec.origem === "SIGEF") {
      const parcelaAbaixo = rec.parcelas.find((cod) => abaixoLimiar.has(cod));
      if (parcelaAbaixo) {
        const cand = abaixoLimiar.get(parcelaAbaixo)!;
        rec.consolidacao = "nao_consolidado";
        rec.consolidacaoMotivo = `melhor candidato CAR (${cand.codImovel}) cobre apenas ${cand.fracaoPct}% da parcela ${parcelaAbaixo} — abaixo do limiar de ${limiarPct}% — fontes exibidas separadamente`;
      }
    } else if (rec.origem === "CAR" && rec.codigoCar && carAbaixo.has(rec.codigoCar)) {
      const cand = carAbaixo.get(rec.codigoCar)!;
      rec.consolidacao = "nao_consolidado";
      rec.consolidacaoMotivo = `candidato a pareamento com a parcela SIGEF ${cand.parcela} cobre apenas ${cand.fracaoPct}% dela — abaixo do limiar de ${limiarPct}% — fontes exibidas separadamente`;
    }
  }

  // 6) sanidade numérica das somas: pct exibível ≤ 100 e interseção ≤ área do
  //    imóvel (para SIGEF, ambas vêm da mesma geometria; para CAR a área pode
  //    ser declarada — a checagem geométrica já foi feita na fonte).
  for (const rec of Array.from(porImovel.values())) {
    if (rec.sobreposicaoAVerificar) {
      // soma contaminada por parte "a verificar": não exibir números
      rec.sobreposicaoHa = null;
      rec.sobreposicaoPct = null;
      continue;
    }
    const san = sanearSobreposicao({
      sobreposicaoHa: rec.sobreposicaoHa,
      sobreposicaoPct: rec.sobreposicaoPct,
      areaMenorHa: rec.origem === "CAR" ? null : rec.areaHa,
      contexto: `imóvel consolidado ${rec.codigoIncra || rec.codigoCar || rec.denominacao || "sem código"}`,
    });
    rec.sobreposicaoHa = san.sobreposicaoHa;
    rec.sobreposicaoPct = san.sobreposicaoPct;
    if (san.sobreposicaoAVerificar) rec.sobreposicaoAVerificar = san.sobreposicaoAVerificar;
  }

  return Array.from(porImovel.values())
    .sort((a, b) => (b.sobreposicaoPct ?? 0) - (a.sobreposicaoPct ?? 0));
}

/**
 * Rótulo da composição/origem dos números de um imóvel consolidado — deixa
 * explícito quando área/sobreposição são a SOMA de várias parcelas SIGEF
 * (motivo de eventual divergência com a tabela de parcelas isoladas).
 */
export function rotuloOrigemImovel(i: Pick<ImovelFundiario, "origem" | "parcelas"> & { consolidacao?: ImovelFundiario["consolidacao"] }): string {
  const n = Array.isArray(i.parcelas) ? i.parcelas.length : 0;
  const sufixoNaoConsolidado = i.consolidacao === "nao_consolidado" ? " — pareamento SIGEF×CAR não consolidado (abaixo do limiar)" : "";
  if (i.origem === "CAR") return `imóvel CAR sem parcela SIGEF casada${sufixoNaoConsolidado}`;
  const composicao = n > 1 ? `soma de ${n} parcelas SIGEF` : "parcela SIGEF isolada";
  const base = i.origem === "SIGEF+CAR" ? `consolidado SIGEF+CAR — ${composicao}` : `SIGEF — ${composicao}`;
  return `${base}${sufixoNaoConsolidado}`;
}

/** Nota de metodologia exibida junto à tabela consolidada do relatório. */
export const NOTA_METODOLOGIA_CONSOLIDACAO =
  "Metodologia: cada linha consolida TODAS as parcelas SIGEF do mesmo imóvel (código SNCR/INCRA) e as entradas casadas por geometria com o CAR — área e sobreposição são a SOMA dessas parcelas, por isso podem ser maiores que as de uma parcela isolada na tabela SIGEF. A coluna Composição indica a origem de cada número; a sobreposição é exibida como \"X ha (Y% do polígono)\" calculada da mesma fonte nas tabelas SIGEF, CAR e consolidada. Pareamentos SIGEF×CAR abaixo do limiar de 60% da área da parcela NÃO são fundidos: as duas fontes aparecem como linhas separadas, rotuladas \"pareamento não consolidado\". Valores reprovados na checagem de sanidade numérica aparecem como \"a verificar\", com o motivo, em vez do número.";
