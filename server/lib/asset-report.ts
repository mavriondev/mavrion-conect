// Relatório PDF do ativo gerado a partir dos DADOS (não screenshot).
// HTML dedicado + puppeteer/chromium (ver .agents/memory/pdf-generation.md).
import { execSync } from "child_process";
import {
  buildProcessoAnmCampos, filtrarEventosReais, filtrarTahPorProcesso, montarQuadroCamadas,
  avaliarDisponibilidadeModulos, formatSobreposicao,
  montarNotaEscopoBases, faixaAnosEscopo, NOTA_HISTORICO_INDISPONIVEL, type EscopoBases,
} from "./relatorio-vinculos";
import { rotuloOrigemImovel, NOTA_METODOLOGIA_CONSOLIDACAO } from "./ccir-fusao";
import { separarPublicacoesDiario, separarBarragensTitular, avisoCertidoesVinculo } from "./consulta-contrato";
import { hashInsumos, secaoDataAtual } from "./ai-relatorio-determinismo";
import { detectarConflitos, normalizarTexto, passoAdversarial, type Enunciado } from "./enunciados";
import {
  avaliarComponentesMaturidade, computeScoreCompletude, gerarLacunasDossie,
  lacunaDisciplina, metricaCobertura, fraseNaoConclusivo, type LacunaEstruturada,
} from "./lacunas-dossie";
import { calcularAlertasPrazo } from "./alertas-prazo";
import { construirCatalogoEvidencias } from "./jazida-evidencias";
import {
  montarCatalogoFatos, montarGrandezasProcesso, montarSintese, montarContradicoes,
  validarParecerEstruturado, itemParaEnunciado, formatarCatalogoParaPrompt, formatarTiposParaPrompt,
  reconstruirEnunciadoPersistido, montarRiscosDeterministicos,
  PARECER_VERSAO, type ParecerConsolidado, type FatoCatalogado, type ViolacaoVocabulario,
} from "./parecer-consolidado";
import {
  anexarVigenciaCalculada,
  formatarVigenciaParaPrompt,
  obterVigenciaCalculada,
  textoLegadoSemConflitoVigencia,
  validarConsistenciaVigenciaTexto,
  type ResultadoVigenciaAlvara,
} from "./vigencia-alvara";

let _chromiumPath: string | null | undefined;
function chromiumPath(): string | null {
  if (_chromiumPath !== undefined) return _chromiumPath;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    _chromiumPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    return _chromiumPath;
  }
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      const p = execSync(`command -v ${bin}`, { encoding: "utf8" }).trim();
      if (p) { _chromiumPath = p; return p; }
    } catch { /* tenta o próximo */ }
  }
  _chromiumPath = null;
  return null;
}

// ── helpers de formatação ──
const esc = (v: any): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtNum = (v: any, dec = 2): string => {
  const n = Number(v);
  if (v == null || v === "" || isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
};
const fmtMoney = (v: any): string => {
  const n = Number(v);
  if (v == null || v === "" || isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
const fmtDate = (v: any): string => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return esc(v);
  return d.toLocaleDateString("pt-BR");
};
const val = (v: any): string => (v == null || v === "" ? "—" : esc(v));

const PADRAO_ENDERECO_TEXTO =
  String.raw`\b(?:Rua|R\.|Avenida|Av\.?|Travessa|Alameda|Praça|Praca|Estrada|Rodovia)\s+[^.;\n]{2,100}`;

function extrairEnderecosTexto(value: string): string[] {
  return String(value || "").match(new RegExp(PADRAO_ENDERECO_TEXTO, "gi")) || [];
}

function limparTextoPessoal(value: string): string {
  return String(value || "")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[e-mail no anexo restrito]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF no anexo restrito]")
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]?\d{4}\b/g, "[telefone no anexo restrito]")
    .replace(new RegExp(PADRAO_ENDERECO_TEXTO, "gi"), "[endereço no anexo restrito]");
}

function kvTable(rows: [string, any][]): string {
  const items = rows.filter(([, v]) => v !== undefined);
  if (items.length === 0) return "";
  return `<table class="kv">${items.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v == null || v === "" ? "—" : v}</td></tr>`).join("")}</table>`;
}

function dataTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  return `<table class="data"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const section = (title: string, body: string): string =>
  body ? `<section><h2>${esc(title)}</h2>${body}</section>` : "";

const sub = (title: string, body: string): string =>
  body ? `<div class="sub"><h3>${esc(title)}</h3>${body}</div>` : "";

const para = (v: any): string => (v ? `<p class="text">${esc(v).replace(/\n/g, "<br/>")}</p>` : "");

function aplicarVigenciaCanonicaAosCampos(campos: any[], vigencia: ResultadoVigenciaAlvara): any[] {
  if (vigencia.status !== "determinado" || !vigencia.dataVigenciaAtual) return campos;
  let encontrou = false;
  const atualizados = campos.map((campo) => {
    if (campo.label !== "Validade") return campo;
    encontrou = true;
    return { ...campo, valor: vigencia.dataVigenciaAtual, fonte: `${vigencia.fonte} — cálculo determinístico` };
  });
  if (!encontrou) {
    atualizados.push({ label: "Validade", valor: vigencia.dataVigenciaAtual, fonte: `${vigencia.fonte} — cálculo determinístico` });
  }
  return atualizados;
}

const TIPO_LABEL: Record<string, string> = {
  MINA: "Ativo Minerário", TERRA: "Terra / Fazenda", AGRO: "Agronegócio",
  NEGOCIO: "Negócio / Empresa", FII_CRI: "Ativo legado", DESENVOLVIMENTO: "Desenvolvimento",
};

// ── seções ──
function secInformacoes(a: any, c: any): string {
  return section("Informações Gerais", kvTable([
    ["Título", val(a.title)],
    ["Tipo", val(TIPO_LABEL[a.type] || a.type)],
    ["Status", val(a.statusAtivo)],
    ["Localização", [a.location, a.municipio, a.estado].filter(Boolean).map(esc).join(" — ") || "—"],
    ["Área (ha)", fmtNum(a.areaHa)],
    ["Preço pedido", a.priceAsking != null ? fmtMoney(a.priceAsking) : "—"],
    ["Matrícula", val(a.matricula)],
    ["Documentação", val(a.docsStatus)],
    ["Ofertante", [c.ofertanteNome, c.ofertanteTelefone, c.ofertanteEmail].filter(Boolean).map(esc).join(" · ") || undefined],
    ["Coordenadas", c.latitude != null && c.longitude != null ? `${fmtNum(c.latitude, 6)}, ${fmtNum(c.longitude, 6)}` : undefined],
    ["Cadastrado em", fmtDate(a.createdAt)],
  ]) + (a.description ? sub("Descrição", para(a.description)) : "")
    + (a.observacoes ? sub("Observações", para(a.observacoes)) : ""));
}

function secAnm(a: any, c: any, attrs: any): string {
  const processo = c.processoAnm || attrs.anmProcesso || a.anmProcesso;
  if (!processo && a.type !== "MINA") return "";
  let body = "";

  // Escopo das bases locais (anexado pela rota) — qualifica conclusões negativas
  const escopo: EscopoBases | null = (a as any).__escopoBases || null;
  const notaEscopo = `<p class="text" style="color:#6b7f7c;font-size:9px;">${esc(montarNotaEscopoBases(escopo))}</p>`;

  // Processo — fallback campo a campo (cadastro → SIGMINE ao vivo → SCM/cache)
  // com origem e timestamp; campos sem valor em nenhuma fonte são omitidos.
  const scmForCampos = (a as any).__scmData || null;
  const vigencia = obterVigenciaCalculada(a);
  const campos = aplicarVigenciaCanonicaAosCampos(buildProcessoAnmCampos(a, c, scmForCampos), vigencia);
  body += sub("Processo", kvTable(
    campos.map(cp => [cp.label, cp.fonte
      ? `${esc(cp.valor)} <span style="color:#6b7f7c;font-size:8px;">[${esc(cp.fonte)}]</span>`
      : esc(cp.valor)] as [string, any])
  ));
  if (vigencia.status === "determinado") {
    body += sub("Vigência atual do alvará", kvTable([
      ["Vigência atual", `<strong>${esc(vigencia.dataVigenciaAtual)}</strong>`],
      ["Fonte do cálculo", esc(vigencia.fonte)],
    ]) + `<p class="text" data-vigencia-memoria="true"><strong>Memória de cálculo:</strong> ${esc(vigencia.memoriaCalculo)}</p>`);
  } else if (vigencia.etapas.length > 0 || vigencia.motivosIndeterminacao.length > 0) {
    body += sub("Vigência do alvará", `<p class="text warning">Vigência indeterminada: ${esc(vigencia.motivosIndeterminacao.join("; "))}. Nenhuma data foi inferida.</p>`);
  }

  // Histórico — só eventos reais (nunca "1 evento" contendo apenas o número do
  // processo); quando não há fonte de eventos, a seção NÃO some em silêncio:
  // mostra nota explícita de indisponibilidade.
  const eventos = filtrarEventosReais(c.anmHistorico?.eventos, processo);
  if (eventos.length > 0) {
    const fonteHist = c.anmHistorico?.fonte
      ? `<p class="text" style="color:#6b7f7c;font-size:9px;">Fonte: ${esc(c.anmHistorico.fonte)}</p>` : "";
    const temPub = eventos.some((e: any) => e.publicacaoDou);
    body += sub(`Histórico (${eventos.length} evento${eventos.length > 1 ? "s" : ""})`, `<div data-vigencia-historico="true">${dataTable(
      temPub ? ["Data", "Evento", "Publicação DOU"] : ["Data", "Evento"],
      eventos.map((e: any) => {
        const row = [fmtDate(e.data), esc(e.descricao || "")];
        if (temPub) row.push(esc(String(e.publicacaoDou || "").slice(0, 220)));
        return row;
      })
    ) + fonteHist}</div>`);
  } else {
    body += sub("Histórico de eventos ANM",
      `<p class="text" style="color:#92400e;">${esc(NOTA_HISTORICO_INDISPONIVEL)}</p>`);
  }

  // Titular
  const t = c.anmTitular || {};
  const tit = t.titular || t;
  if (tit && (tit.nome || tit.cnpj || tit.razaoSocial)) {
    body += sub("Titular", kvTable([
      ["Nome / Razão social", val(tit.nome || tit.razaoSocial)],
      ["CNPJ/CPF", val(tit.cnpj || tit.cpf || tit.cpfCnpj)],
      ["Município", val(tit.municipio)],
      ["UF", val(tit.uf)],
      ["Telefone", val(tit.telefone)],
      ["E-mail", val(tit.email)],
    ]));
  }

  // Titular oficial (SCM) — CNPJ obtido diretamente do SCM/ANM
  const scm = (a as any).__scmData;
  if (scm && (scm.titularNome || scm.titularCnpj || scm.titularCpf)) {
    const fmtCnpj = (v: any) => {
      const s = String(v || "").replace(/\D/g, "");
      if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
      if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
      return v ? esc(v) : "—";
    };
    body += sub("Titular Oficial (SCM/ANM)", kvTable([
      ["Nome / Razão social", val(scm.titularNome)],
      ["CNPJ", scm.titularCnpj ? fmtCnpj(scm.titularCnpj) : undefined],
      ["CPF", scm.titularCpf ? fmtCnpj(scm.titularCpf) : undefined],
      ["Tipo", scm.tipoPessoa === "PF" ? "Pessoa Física" : scm.tipoPessoa === "PJ" ? "Pessoa Jurídica" : undefined],
      ["Fase (SCM)", scm.fase ? val(scm.fase) : undefined],
      ["NUP", scm.nup ? val(scm.nup) : undefined],
      ["Data do protocolo", scm.dataProtocolo ? val(scm.dataProtocolo) : undefined],
      ["Consultado via SCM em", fmtDate(scm.consultadoEm)],
    ]));
  }

  // Geologia
  const geo = c.anmGeologia?.data || [];
  if (geo.length > 0) {
    body += sub("Geologia (CPRM)", dataTable(
      ["Unidade", "Hierarquia", "Litotipos", "Ambiente tectônico"],
      geo.map((g: any) => [esc(g.nome || g.sigla || ""), esc(g.hierarquia || ""), esc(g.litotipos || ""), esc(g.ambiente_tectonico || "")])
    ));
  }
  const rec = c.anmRecursos?.data || [];
  if (rec.length > 0) {
    body += sub(`Ocorrências minerais próximas (${rec.length})`, dataTable(
      ["Ocorrência", "Distância (km)", "Substâncias", "Status econômico", "Município/UF"],
      rec.map((r: any) => [esc(r.nome_ocorrencia || ""), fmtNum(r.distancia_km, 1), esc(r.substancias || ""), esc(r.status_economico || r.importancia || ""), esc([r.municipio, r.uf].filter(Boolean).join("/"))])
    ));
  }

  // Restrições (FUNAI) — renderiza também quando só a busca de terras próximas foi feita
  // Restrições Ambientais e Fundiárias — quadro unificado com TODAS as
  // camadas (FUNAI + CNUC + embargos + cavernas + quilombolas + assentamentos);
  // camada falhada aparece como "camada não consultada" e trava o semáforo.
  {
    const quadro = montarQuadroCamadas(c);
    const semTxt = quadro.semaforo === "vermelho" ? "VERMELHO — sobreposição direta detectada"
      : quadro.semaforo === "amarelo" ? "AMARELO — ocorrências próximas ou camadas não consultadas"
      : quadro.semaforo === "verde" ? "VERDE — sem restrições no raio analisado" : "—";
    const rows: [string, any][] = [
      ["Situação geral (semáforo)", semTxt],
      ["Raio analisado", quadro.raioKm != null ? `${quadro.raioKm} km` : "—"],
      ["Camadas consultadas", quadro.consultadas.length > 0 ? quadro.consultadas.join("; ") : "Nenhuma"],
    ];
    if (quadro.falhadas.length > 0) rows.push(["Camadas NÃO consultadas", quadro.falhadas.join("; ")]);
    body += sub("Restrições Ambientais e Fundiárias", kvTable(rows)
      + dataTable(["Camada", "Situação", "Principais ocorrências"],
        quadro.linhas.map(l => [esc(l.label), esc(l.status), esc(l.destaque)]))
      + (quadro.falhadas.length > 0
        ? `<p class="text" style="color:#92400e;font-size:9px;">Camada não consultada não significa ausência de restrição — reexecutar o cruzamento antes de decisões definitivas.</p>`
        : ""));

    // detalhe FUNAI (terras próximas) quando disponível
    const terrasRaw = c.anmFunaiTerras;
    const terras = Array.isArray(terrasRaw?.data) ? terrasRaw.data : Array.isArray(terrasRaw) ? terrasRaw : [];
    if (terras.length > 0) {
      body += sub("Terras Indígenas próximas (FUNAI)", dataTable(
        ["Terra indígena", "Distância (km)", "Etnia", "Fase"],
        terras.map((ti: any) => [
          esc(ti.terrai_nome || ti.nome || ""), fmtNum(ti.distancia_km, 1), esc(ti.etnia_nome || ti.etnia || ""), esc(ti.fase_ti || ti.fase || ""),
        ])));
    }
  }

  // TAH — casada pelo número COMPLETO (número + ano); vínculo ambíguo vira
  // aviso explícito em vez de tabela com titulares de processos alheios.
  // Zero registros com fonte consultada = nota qualificada com o escopo das
  // bases (nunca omissão silenciosa).
  const tahVinculo = filtrarTahPorProcesso(c.anmTah, processo);
  if (tahVinculo.ambiguo) {
    body += sub("TAH — Taxa Anual por Hectare",
      `<p class="text" style="color:#92400e;">Vínculo de TAH ambíguo (${esc(tahVinculo.motivo || "consulta só pelo número-base")}): os registros disponíveis podem pertencer a processos de outros anos com o mesmo número-base e por isso não são exibidos.</p>` + notaEscopo);
  } else if (tahVinculo.rows.length > 0) {
    const tah = tahVinculo.rows;
    body += sub("TAH — Taxa Anual por Hectare", dataTable(
      ["Ano base", "Titular", "Área (ha)", "Valor cobrado", "Valor pago", "Quitação"],
      tah.map((r: any) => [val(r.ano_base ?? r.anoBase), esc(r.nome_titular || r.nomeTitular || ""), fmtNum(r.area_ha ?? r.areaHa), fmtMoney(r.valor_cobrado ?? r.valorCobrado), fmtMoney(r.valor_pago ?? r.valorPago), val(r.dt_quitacao ?? r.dtQuitacao)])
    ) + notaEscopo);
  } else if (c.anmTah != null) {
    body += sub("TAH — Taxa Anual por Hectare",
      `<p class="text">Nenhum registro de TAH localizado para este processo nas bases consultadas.</p>` + notaEscopo);
  }

  // CFEM — produção real (dados abertos ANM)
  const cfem = c.anmCfem;
  if (cfem?.disponivel) {
    let cfemBody = "";
    if (cfem.processo) {
      cfemBody += kvTable([
        ["Já produziu (recolheu CFEM)", cfem.processo.jaProduziu ? "SIM" : "Não — nunca recolheu CFEM"],
        ["Total recolhido pelo processo", fmtMoney(cfem.processo.totalRecolhido)],
      ]);
      if (Array.isArray(cfem.processo.porAno) && cfem.processo.porAno.length > 0) {
        cfemBody += dataTable(["Ano", "Valor recolhido", "Substâncias"],
          cfem.processo.porAno.map((a: any) => [val(a.ano), fmtMoney(a.valorTotal), esc((a.substancias || []).join(", "))]));
      }
    }
    if (cfem.titular) {
      cfemBody += sub("CFEM do titular", kvTable([
        ["CNPJ", val(cfem.titular.cnpj)],
        ["Já recolheu CFEM", cfem.titular.jaRecolheu ? "Sim" : "Não"],
        ["Total recolhido", fmtMoney(cfem.titular.totalRecolhido)],
        ["Processos com recolhimento", fmtNum(cfem.titular.processosDistintos, 0)],
      ]));
    }
    if (cfem.municipio) {
      cfemBody += sub("Contexto do município", kvTable([
        ["Município", [cfem.municipio.municipio, cfem.municipio.uf].filter(Boolean).join("/")],
        ["Ranking CFEM no Brasil", cfem.municipio.rankBrasil ? `${cfem.municipio.rankBrasil}º (ano ${cfem.municipio.anoReferencia})` : "—"],
        ["Ranking na UF", cfem.municipio.rankUf ? `${cfem.municipio.rankUf}º` : "—"],
        ["Arrecadação no ano de referência", fmtMoney(cfem.municipio.valorAnoReferencia)],
        ["Principais substâncias", esc((cfem.municipio.topSubstancias || []).slice(0, 5).map((s: any) => s.substancia).join(", "))],
      ]));
    }
    cfemBody += `<p class="text" style="color:#6b7f7c;font-size:9px;">Fonte: ${esc(cfem.fonte || "CFEM/ANM")} · Base local: anos ${esc(faixaAnosEscopo(escopo?.cfem))} · Consultado em ${fmtDate(cfem.consultadoEm)}</p>`;
    body += sub("CFEM — Produção Real", cfemBody);
  }

  // DOU — publicações oficiais; zero resultados é resposta válida da fonte e
  // vira nota explícita (não some em silêncio)
  const dou = c.anmDou;
  if (dou?.disponivel) {
    const pubs = Array.isArray(dou.publicacoes) ? dou.publicacoes : [];
    // itens casados só por nome do titular são exibidos ROTULADOS — nunca
    // geram alerta/prazo nem entram nos insumos da IA
    const { naoConfirmadas } = separarPublicacoesDiario(dou, c.processoAnm);
    const naoConfSet = new Set(naoConfirmadas);
    const notaVinculoDou = naoConfirmadas.length > 0
      ? ` · ${naoConfirmadas.length} item(ns) casado(s) apenas por nome do titular — vinculação não confirmada (sem efeito em alertas/prazos)`
      : "";
    const fonteDou = `<p class="text" style="color:#6b7f7c;font-size:9px;">Fonte: ${esc(dou.fonte || "Imprensa Nacional")} · Busca pública do DOU (zero resultados é resposta válida da fonte)${esc(notaVinculoDou)} · Consultado em ${fmtDate(dou.consultadoEm)}</p>`;
    if (pubs.length > 0) {
      body += sub(`Publicações no DOU (${dou.total})`, dataTable(
        ["Data", "Seção", "Ato", "Trecho"],
        pubs.map((p: any) => [val(p.data), val(p.secao),
          esc((p.tipoAto || p.titulo || "") + (naoConfSet.has(p) ? " (vinculação não confirmada — casada por nome)" : "")),
          esc(String(p.trecho || "").slice(0, 220))])
      ) + fonteDou);
    } else {
      body += sub("Publicações no DOU",
        `<p class="text">Nenhuma publicação localizada para o processo/titular na busca pública do DOU.</p>` + fonteDou);
    }
  }

  // SIGBM — barragens de mineração
  const barr = c.anmBarragens;
  if (barr?.disponivel) {
    const linhaBarragem = (b: any) => [
      esc(b.nome || ""), esc(b.empreendedor || ""), esc([b.municipio, b.uf].filter(Boolean).join("/")),
      val(b.categoriaRisco), val(b.danoPotencial), val(b.nivelEmergencia),
      b.distanciaKm != null ? `${fmtNum(b.distanciaKm, 1)} km` : "—",
    ];
    let bBody = "";
    // vínculo por CNPJ = "do titular"; casadas só por nome do empreendedor
    // aparecem em tabela separada, rotuladas, sem gerar alerta/fato
    const { confirmadas: barrConf, naoConfirmadas: barrNaoConf } = separarBarragensTitular(barr);
    if (barrConf.length > 0) {
      bBody += sub(`Barragens do titular (${barrConf.length})`, dataTable(
        ["Barragem", "Empreendedor", "Município", "Risco (CRI)", "Dano potencial (DPA)", "Emergência", "Distância"],
        barrConf.map(linhaBarragem)));
    }
    if (barrNaoConf.length > 0) {
      bBody += sub(`Barragens casadas apenas por nome do empreendedor (${barrNaoConf.length}) — vinculação não confirmada`, dataTable(
        ["Barragem", "Empreendedor", "Município", "Risco (CRI)", "Dano potencial (DPA)", "Emergência", "Distância"],
        barrNaoConf.map(linhaBarragem))
        + `<p class="text" style="color:#8a6d3b;font-size:9px;">${esc(barr.notaVinculo || "Itens casados por similaridade de nome do empreendedor, sem CNPJ confirmado — não geram alerta nem entram nos insumos da IA.")}</p>`);
    }
    if (Array.isArray(barr.proximas) && barr.proximas.length > 0) {
      bBody += sub(`Barragens num raio de ${barr.raioKm ?? "?"} km (${barr.proximas.length})`, dataTable(
        ["Barragem", "Empreendedor", "Município", "Risco (CRI)", "Dano potencial (DPA)", "Emergência", "Distância"],
        barr.proximas.map(linhaBarragem)));
    }
    if (!bBody) bBody = para("Nenhuma barragem de mineração do titular nem no raio consultado.");
    bBody += `<p class="text" style="color:#6b7f7c;font-size:9px;">Fonte: ${esc(barr.fonte || "SIGBM/ANM")} · Consultado em ${fmtDate(barr.consultadoEm)}</p>`;
    body += sub("Barragens de Mineração (SIGBM)", bBody);
  }

  // Certidões do titular
  const cert = c.anmCertidoesTitular;
  if (cert?.disponivel) {
    const avisoCert = avisoCertidoesVinculo(cert);
    body += sub("Certidões do Titular", kvTable([
      ["CNPJ consultado", val(cert.cnpj)],
      ...(avisoCert ? [["Vínculo do CNPJ", esc(`NÃO confirmado por documento — ${avisoCert}`)]] as [string, any][] : []),
      ["Dívida ativa (PGFN)", cert.pgfn ? (cert.pgfn.temDebitoAtivo ? `POSSUI — ${cert.pgfn.situacao || ""}` : cert.pgfn.situacao || "Sem débitos inscritos") : "Não consultado"],
      ["Processos judiciais (DataJud/CNJ)", cert.cnj ? `${cert.cnj.totalProcessos ?? 0} processo(s)` : "Não consultado"],
      ["Sanções (CEIS)", cert.ceis ? (cert.ceis.sancionado ? `SANCIONADO (${(cert.ceis.sancoes || []).length})` : "Nenhuma sanção vigente") : "Não consultado"],
      ...(Array.isArray(cert.erros) && cert.erros.length > 0 ? [["Fontes indisponíveis", esc(cert.erros.map((e: any) => e?.fonte || e).join("; "))]] as [string, any][] : []),
      ["Consultado em", fmtDate(cert.consultadoEm)],
    ]) + (avisoCert ? `<p class="text" style="color:#8a6d3b;font-size:9px;">${esc(avisoCert)}</p>` : ""));
  }

  // SEI — processo administrativo (documentos e andamentos), só do cache da
  // consulta pública (captcha manual — nunca consultado ao vivo na geração)
  const sei = c.anmSei;
  if (sei?.disponivel) {
    let seiBody = kvTable([
      ["NUP (SEI)", val(sei.nupFormatado || sei.nup)],
      ["Tipo do procedimento", val(sei.tipoProcedimento)],
      ["Gerado em (SEI)", val(sei.dataGeracao)],
      ["Interessados", Array.isArray(sei.interessados) && sei.interessados.length > 0 ? esc(sei.interessados.join("; ")) : "—"],
    ]);
    const docs: any[] = Array.isArray(sei.documentos) ? sei.documentos : [];
    if (docs.length > 0) {
      seiBody += sub(`Documentos / Protocolos (${docs.length})`, dataTable(
        ["Nº documento", "Tipo", "Data", "Unidade"],
        docs.map((d: any) => [val(d.numero), val(d.tipo), val(d.data || d.dataInclusao), val(d.unidade)])
      ));
    } else {
      seiBody += sub("Documentos / Protocolos", para("Nenhum documento na lista pública do SEI para este processo."));
    }
    const ands: any[] = Array.isArray(sei.andamentos) ? sei.andamentos : [];
    if (ands.length > 0) {
      seiBody += sub(`Andamentos (${ands.length})`, dataTable(
        ["Data/Hora", "Unidade", "Descrição"],
        ands.map((an: any) => [val(an.dataHoraTexto || an.dataHora), esc([an.unidade, an.unidadeNome].filter(Boolean).join(" — ")) || "—", esc(String(an.descricao || "").slice(0, 300))])
      ));
    } else {
      seiBody += sub("Andamentos", para("Nenhum andamento na lista pública do SEI para este processo."));
    }
    seiBody += `<p class="text" style="color:#6b7f7c;font-size:9px;">Fonte: SEI/ANM — Pesquisa Pública (dados em cache da última consulta manual; a consulta ao vivo exige captcha) · Consultado em ${fmtDate(sei.consultadoEm)}</p>`;
    body += sub("SEI — Processo Administrativo", seiBody);
  }

  // Logística — ferrovia, porto e linha de transmissão mais próximos
  const logi = c.anmLogistica;
  if (logi?.disponivel) {
    const linhaLogi = (label: string, it: any, detalhe: string) => {
      if (!it || it.consultado === false) return [esc(label), "Não consultado (fonte indisponível)", ""];
      if (!it.encontrado) return [esc(label), `Nenhuma em até ${fmtNum(it.raioBuscaKm, 0)} km`, ""];
      return [esc(label), `${esc(it.nome)} — ${fmtNum(it.distanciaKm, 1)} km`, esc(detalhe)];
    };
    body += sub("Logística — Infraestrutura Próxima", dataTable(
      ["Infraestrutura", "Mais próxima", "Detalhes"],
      [
        ...(logi.rodovia ? [linhaLogi("Rodovia federal", logi.rodovia, [logi.rodovia?.situacao, logi.rodovia?.administracao, logi.rodovia?.trecho].filter(Boolean).join(", "))] : []),
        ...(logi.hidrovia ? [linhaLogi("Hidrovia", logi.hidrovia, [logi.hidrovia?.rio && logi.hidrovia.rio !== logi.hidrovia.nome ? logi.hidrovia.rio : null, logi.hidrovia?.classificacao, logi.hidrovia?.jurisdicao].filter(Boolean).join(", "))] : []),
        linhaLogi("Ferrovia", logi.ferrovia, [logi.ferrovia?.situacao, logi.ferrovia?.bitola ? `bitola ${logi.ferrovia.bitola}` : null].filter(Boolean).join(", ")),
        linhaLogi("Porto", logi.porto, [logi.porto?.tipo, logi.porto?.situacao, [logi.porto?.cidade, logi.porto?.uf].filter(Boolean).join("/")].filter(Boolean).join(", ")),
        linhaLogi("Linha de transmissão", logi.linhaTransmissao, [logi.linhaTransmissao?.tensaoKv ? `${fmtNum(logi.linhaTransmissao.tensaoKv, 0)} kV` : null, logi.linhaTransmissao?.concessionaria].filter(Boolean).join(", ")),
      ]
    ) + `<p class="text" style="color:#6b7f7c;font-size:9px;">Fontes: ${esc([logi.fontes?.rodovia, logi.fontes?.hidrovia, logi.fontes?.ferrovia, logi.fontes?.porto, logi.fontes?.linhaTransmissao].filter(Boolean).join(" · "))} · Consultado em ${fmtDate(logi.consultadoEm)}</p>`);
  }

  // Sondagens e geoquímica (CPRM)
  const sond = c.anmSondagem;
  if (sond?.disponivel && Array.isArray(sond.data) && sond.data.length > 0) {
    body += sub(`Furos de sondagem CPRM próximos (${sond.total} em ${sond.raio_km} km)`, dataTable(
      ["Furo", "Projeto", "Profundidade (m)", "Unidade estratigráfica", "Distância (km)"],
      sond.data.map((s: any) => [esc(s.furo || ""), esc(s.projeto || ""), fmtNum(s.profundidade_m), esc(s.unidade_estratigrafica || ""), fmtNum(s.distancia_km, 1)])
    ));
  }
  const geoq = c.anmGeoquimica;
  if (geoq?.disponivel && geoq.total > 0) {
    body += sub(`Geoquímica CPRM (${geoq.total} amostras em ${geoq.raio_km} km)`, kvTable(
      Object.entries(geoq.porClasse || {}).slice(0, 8).map(([k, v]) => [k, fmtNum(v, 0)] as [string, any])
    ));
  }

  // Telemetria de fontes: módulo que falhou ou nunca rodou aparece aqui —
  // nunca some em silêncio ("indisponível" ≠ "sem dado" ≠ "não consultada").
  const modulosProblema = avaliarDisponibilidadeModulos(c).filter((m) => m.estado !== "ok");
  if (modulosProblema.length > 0) {
    body += sub("Disponibilidade das fontes nesta geração", dataTable(
      ["Fonte", "Situação nesta geração"],
      modulosProblema.map((m) => [esc(m.label), m.estado === "indisponivel"
        ? `Indisponível nesta geração${m.motivo ? ` — ${esc(String(m.motivo).slice(0, 160))}` : ""}`
        : "Fonte não consultada"])
    ) + `<p class="text" style="color:#6b7f7c;font-size:9px;">“Indisponível nesta geração” = a fonte foi consultada e falhou (não significa ausência de dado). “Fonte não consultada” = o cruzamento ainda não rodou para este ativo. Dado consultado sem registros aparece na própria seção como nota de "sem registros".</p>`);
  }

  return section("ANM — Dados do Processo Minerário", body);
}

function secSigef(c: any): string {
  const s = c.sigefParcelas;
  if (!s) return "";
  const parcelas: any[] = Array.isArray(s.parcelas) ? s.parcelas : [];
  const sobrepostas = parcelas.filter((p) => p.relacao === "sobreposta");
  const vizinhas = parcelas.filter((p) => p.relacao === "vizinha");
  let body = kvTable([
    ["Parcelas sobre o processo", fmtNum(s.totalSobrepostas, 0)],
    ["Parcelas vizinhas imediatas", fmtNum(s.totalVizinhas, 0)],
    ["Cobertura certificada do processo", s.coberturaPct != null ? `${fmtNum(s.coberturaPct)}%` : s.coberturaAVerificar ? esc(`a verificar — ${s.coberturaAVerificar}`) : "—"],
    ...(s.truncado ? [["Atenção", "Lista parcial — a fonte devolveu mais parcelas do que o limite consultado"]] as [string, any][] : []),
    ["Fonte", val(s.fonte)],
    ["Base de dados", val(s.dataBase)],
    ["Consultado em", fmtDate(s.consultadoEm)],
  ]);
  const linhas = (arr: any[]) => arr.map((p) => [
    esc(p.codigoParcela || ""), esc(p.nomeArea || ""), esc(p.detentor || "—"), fmtNum(p.areaHa),
    formatSobreposicao(p.sobreposicaoHa, p.sobreposicaoPct, p.sobreposicaoAVerificar),
    esc(p.situacao || p.status || ""), esc(p.registroMatricula || ""),
  ]);
  if (sobrepostas.length > 0) {
    body += sub("Parcelas sobre o processo", dataTable(
      ["Código da parcela", "Denominação", "Detentor", "Área (ha)", "Sobreposição", "Situação", "Matrícula"], linhas(sobrepostas))
      + `<p class="text" style="color:#6b7f7c;font-size:9px;">Valores por parcela SIGEF isolada — um mesmo imóvel pode reunir várias parcelas; a soma por imóvel está na tabela consolidada (Base Fundiária por Imóvel).</p>`);
  } else {
    body += para("Nenhuma parcela certificada sobre o processo — sem registro de georreferenciamento certificado no SIGEF para o polígono consultado (sinal de informalidade fundiária). Isso não significa ausência de proprietário: verificar matrículas em cartório.");
  }
  if (vizinhas.length > 0) {
    body += sub("Parcelas vizinhas imediatas", dataTable(
      ["Código da parcela", "Denominação", "Detentor", "Área (ha)", "Sobreposição", "Situação", "Matrícula"], linhas(vizinhas)));
  }
  return section("Propriedades sobre o Processo (SIGEF/INCRA)", body);
}

function secCarImoveis(c: any): string {
  const s = c.carImoveis;
  if (!s) return "";
  const imoveis: any[] = Array.isArray(s.imoveis) ? s.imoveis : [];
  const sobrepostos = imoveis.filter((i) => i.relacao === "sobreposto");
  let body = kvTable([
    ["Imóveis CAR sobre o processo", fmtNum(s.totalSobrepostos, 0)],
    ["Imóveis vizinhos", fmtNum(s.totalVizinhos, 0)],
    ["Cobertura CAR do processo", s.coberturaPct != null ? `${fmtNum(s.coberturaPct)}%` : s.coberturaAVerificar ? esc(`a verificar — ${s.coberturaAVerificar}`) : "—"],
    ...(s.truncado ? [["Atenção", "Lista parcial — a fonte devolveu mais imóveis do que o limite consultado"]] as [string, any][] : []),
    ["Fonte", val(s.fonte)],
    ["Consultado em", fmtDate(s.consultadoEm)],
  ]);
  if (sobrepostos.length > 0) {
    body += sub("Imóveis CAR sobre o processo", dataTable(
      ["Código CAR", "Município/UF", "Área (ha)", "Status", "Condição", "Tipo", "Sobreposição"],
      sobrepostos.map((i) => [
        esc(i.codImovel || ""), esc([i.municipio, i.uf].filter(Boolean).join("/")), fmtNum(i.areaHa),
        esc(i.status || ""), esc(i.condicao || ""), esc(i.tipo || ""),
        formatSobreposicao(i.sobreposicaoHa, i.sobreposicaoPct, i.sobreposicaoAVerificar),
      ])));
  } else {
    body += para("Nenhum imóvel CAR sobre o processo — ausência de declaração no CAR não significa ausência de ocupantes; verificar em campo e em cartório.");
  }
  return section("Imóveis CAR sobre o Processo (SICAR)", body);
}
function secGeo(a: any): string {
  if (a.geoScore == null && a.geoAltMed == null) return "";
  return section("Georreferenciamento e Terreno", kvTable([
    ["Score geográfico", a.geoScore != null ? `${fmtNum(a.geoScore)} / 100` : "—"],
    ["Altitude (média / mín / máx)", a.geoAltMed != null ? `${fmtNum(a.geoAltMed)} m / ${fmtNum(a.geoAltMin)} m / ${fmtNum(a.geoAltMax)} m` : "—"],
    ["Declividade média", a.geoDeclivityMed != null ? `${fmtNum(a.geoDeclivityMed)}%` : "—"],
    ["Rio na propriedade", a.geoTemRio == null ? "—" : a.geoTemRio ? "Sim" : "Não detectado"],
    ["Lago/açude", a.geoTemLago == null ? "—" : a.geoTemLago ? "Sim" : "Não detectado"],
    ["Distância até água", a.geoDistAguaM != null ? `${fmtNum(a.geoDistAguaM)} m` : "—"],
    ["Energia elétrica", a.geoTemEnergia == null ? "—" : a.geoTemEnergia ? "Sim (rede mapeada até 1 km)" : "Não detectada"],
    ["Distância até energia", a.geoDistEnergiaM != null ? `${fmtNum(a.geoDistEnergiaM)} m` : "—"],
    ["Analisado em", fmtDate(a.geoAnalyzedAt)],
  ]));
}

function secCcir(c: any): string {
  if (!c.ccirCodigoIncra && !c.ccirDenominacao && !c.ccir) return "";
  const props = Array.isArray(c.ccirProprietarios) ? c.ccirProprietarios : [];
  return section("CCIR / INCRA", kvTable([
    ["Código INCRA", val(c.ccirCodigoIncra)],
    ["Denominação", val(c.ccirDenominacao)],
    ["NIRF", val(c.ccirNirf)],
    ["Área total INCRA (ha)", fmtNum(c.ccirAreaTotalIncra)],
    ["Módulos fiscais", val(c.ccirModulosFiscais)],
    ["Classificação", val(c.ccirClassificacao)],
    ["Situação", val(c.ccirSituacao)],
    ["Consultado em", fmtDate(c.ccirConsultadoEm)],
  ]) + (props.length > 0 ? sub("Proprietários", dataTable(["Nome", "CPF/CNPJ", "Tipo"],
    props.map((p: any) => [esc(p.nome || ""), esc(p.cpfCnpj || ""), esc(p.tipo || "")]))) : ""));
}

function secAmbiental(c: any): string {
  const amb = c.ambiental;
  if (!amb) return "";
  const rows: [string, any][] = [
    ["Situação CAR", val(c.sicarStatus || c.statusCar)],
    ["Código CAR", val(c.codigoCar || c.codigoCAR)],
    ["Alertas DETER (desmatamento)", amb.deterStatus != null ? val(amb.deterStatus) : amb.deter ? esc(typeof amb.deter === "object" ? (amb.deter.total != null ? `${amb.deter.total} alerta(s)` : JSON.stringify(amb.deter).slice(0, 120)) : amb.deter) : "—"],
    ["MapBiomas", amb.mapbiomasStatus != null ? val(amb.mapbiomasStatus) : amb.mapbiomas ? esc(typeof amb.mapbiomas === "object" ? (amb.mapbiomas.total != null ? `${amb.mapbiomas.total} alerta(s)` : JSON.stringify(amb.mapbiomas).slice(0, 120)) : amb.mapbiomas) : "—"],
    ["Embargos IBAMA", amb.ibamaStatus != null ? val(amb.ibamaStatus) : "—"],
    ["Consultado em", fmtDate(amb.consultadoEm)],
  ];
  return section("Situação Ambiental", kvTable(rows));
}

// (secDueDiligence removida: exibia scores e prosa da Due Diligence de IA,
// funcionalidade removida a pedido do usuário — dados antigos são inertes e
// nenhum score de confiança sobre conclusões é exibido no relatório.)

function secIa(c: any, vigencia: ResultadoVigenciaAlvara): string {
  let body = "";
  // Investigação profunda (deep intel) — mesmo formato do agente de investigação
  const inv = c.iaDeepIntel || c.iaEnrichment?.investigation || c.investigation;
  if (inv && (inv.resumoInvestigacao || inv.recomendacaoAbordagem || (Array.isArray(inv.contatos) && inv.contatos.length > 0))) {
    const resumoSeguro = textoLegadoSemConflitoVigencia(inv.resumoInvestigacao, vigencia);
    if (resumoSeguro) {
      body += sub("Investigação", para(resumoSeguro));
    } else if (inv.resumoInvestigacao && vigencia.status === "determinado") {
      body += sub("Investigação", `<p class="text warning">Narrativa legada omitida porque continha vigência conflitante. A vigência canônica do alvará é ${esc(vigencia.dataVigenciaAtual)}.</p>`);
    }
    if (Array.isArray(inv.contatos) && inv.contatos.length > 0) {
      body += sub("Contatos identificados", dataTable(["Tipo", "Valor", "Pessoa", "Fonte", "Confiança"],
        inv.contatos.map((ct: any) => [esc(ct.tipo || ""), esc(ct.valor || "") + (ct.aviso ? `<br/><span style="color:#92400e;font-size:8px;">${esc(ct.aviso)}</span>` : ""), esc(ct.pessoa || ""), esc(ct.fonte || ""), esc(ct.confianca || "")])));
    }
    if (Array.isArray(inv.proprietarios) && inv.proprietarios.length > 0) {
      body += sub("Proprietários / sócios", dataTable(["Nome", "Papel", "Fonte"],
        inv.proprietarios.map((p: any) => [esc(p.nome || ""), esc(p.papel || p.tipo || ""), esc(p.fonte || "")])));
    }
    if (Array.isArray(inv.historicoPropriedade) && inv.historicoPropriedade.length > 0) {
      const historicoSeguro = inv.historicoPropriedade.filter((h: any) =>
        textoLegadoSemConflitoVigencia(`${h.evento || ""} ${h.detalhes || ""}`, vigencia) !== null);
      body += sub("Histórico de propriedade", dataTable(["Data", "Evento", "Detalhes"],
        historicoSeguro.map((h: any) => [esc(h.data || ""), esc(h.evento || ""), esc(h.detalhes || "")])));
    }
    if (Array.isArray(inv.restricoes) && inv.restricoes.length > 0) {
      body += sub("Restrições identificadas", `<ul class="lista">${inv.restricoes.map((r: any) => `<li>${esc(typeof r === "string" ? r : r.descricao || JSON.stringify(r).slice(0, 200))}</li>`).join("")}</ul>`);
    }
    // (Nenhum score de confiança é exibido — o único indicador do relatório é
    // o score de completude do dossiê, com fórmula e componentes visíveis.)
  }
  if (!body) return "";
  // Apenas material T3 de investigação/agregadores. Narrativas antigas de IA
  // são T4 e seguem exclusivamente para a seção de hipóteses.
  const banner = `<p class="text warning">Material T3 de investigação/agregadores — NÃO VERIFICADO em fonte oficial. Não integra o parecer, os riscos nem os encaminhamentos; use somente como pista de trabalho.</p>`;
  return section("Anexo — material T3 não verificado", banner + body);
}

function secSicor(c: any): string {
  const s = c.sicorData;
  if (!s || (!s.totalValor && !Array.isArray(s.topProdutos))) return "";
  const prods = Array.isArray(s.topProdutos) ? s.topProdutos : [];
  return section("Crédito Rural na Região (SICOR/BACEN)", kvTable([
    ["Valor total contratado", fmtMoney(s.totalValor)],
    ["Contratos", s.totalContratos != null ? fmtNum(s.totalContratos, 0) : undefined],
  ]) + (prods.length > 0 ? sub("Principais produtos financiados", dataTable(
    ["Produto", "Valor", "Área (ha)", "Contratos"],
    prods.slice(0, 10).map((p: any) => [esc(String(p.produto || "").replace(/"/g, "")), fmtMoney(p.valor), fmtNum(p.area), fmtNum(p.contratos, 0)])
  )) : ""));
}

function secEmbrapa(c: any): string {
  const e = c.embrapa;
  if (!e) return "";
  const rows: [string, any][] = [];
  if (e.solo || e.tipoSolo) rows.push(["Tipo de solo", val(e.solo || e.tipoSolo)]);
  if (e.aptidao) rows.push(["Aptidão agrícola", val(typeof e.aptidao === "object" ? e.aptidao.classe || e.aptidao.descricao : e.aptidao)]);
  if (c.aptidaoAgricola) rows.push(["Aptidão (cadastro)", val(c.aptidaoAgricola)]);
  if (e.clima) rows.push(["Clima", val(typeof e.clima === "object" ? e.clima.descricao || e.clima.tipo : e.clima)]);
  if (c.embrapaUpdatedAt) rows.push(["Atualizado em", fmtDate(c.embrapaUpdatedAt)]);
  if (rows.length === 0) return "";
  return section("Dados Agronômicos (Embrapa)", kvTable(rows));
}

// ── Parecer consolidado (disciplina de certeza) ──

// Ref compacta de proveniência de um enunciado: fatos citados, fonte,
// identificador e data — cada afirmação do corpo é reproduzível.
function liEnunciado(e: any, cor?: string): string {
  const ids = (Array.isArray(e?.insumos) ? e.insumos : [])
    .map((s: any) => { const m = String(s).match(/^F\d+/); return m ? m[0] : null; })
    .filter(Boolean);
  const meta = [
    ids.length > 0 ? ids.join(", ") : null,
    e?.fonte || null,
    e?.identificador ? `id ${e.identificador}` : null,
    e?.dataConsulta ? `consulta ${e.dataConsulta}` : null,
    e?.regra ? `regra: ${e.regra}` : null,
  ].filter(Boolean).join(" · ");
  return `<li${cor ? ` style="color:${cor};"` : ""}>${esc(e?.texto ?? "")}${meta ? ` <span style="color:#6b7f7c;font-size:8px;">[${esc(meta)}]</span>` : ""}</li>`;
}

function secParecerIa(asset: any, c: any, hashAtual?: string | null): string {
  const p = c.iaRelatorioConsolidado;
  const TITULO = "Parecer Consolidado (disciplina de certeza)";
  if (!p) {
    // Nunca some em silêncio: sem parecer (falha na geração ou nunca gerado),
    // o relatório declara a indisponibilidade explicitamente.
    return section(TITULO,
      `<p class="text" style="color:#92400e;">Parecer consolidado indisponível nesta geração do relatório — a análise não pôde ser gerada. As demais seções trazem os dados brutos de todas as fontes consultadas; as restrições detectadas estão no quadro "Restrições Ambientais e Fundiárias".</p>`);
  }
  if (p.versao !== PARECER_VERSAO) {
    // Payload antigo (prosa livre): NUNCA renderizar — não atende à disciplina
    // de certeza (sem fatos citados, sem passo adversarial).
    return section(TITULO,
      `<p class="text" style="color:#92400e;">O parecer persistido está em formato antigo (prosa livre, sem enunciados classificados) e por isso não é exibido. Ele será regerado no novo formato na próxima exportação com a análise de IA disponível.</p>`);
  }

  let body = "";
  // Nunca confiar no `texto` nem nos valores persistidos: o catálogo é
  // recalculado dos dados atuais. IDs antigos são reaproveitados somente
  // quando campo+identificador ainda existem, preservando as seleções do
  // modelo sem preservar valor/fonte/data obsoletos.
  const fatosPersistidos: FatoCatalogado[] = (Array.isArray(p.fatos) ? p.fatos : []).filter((f: any) =>
    f && typeof f.id === "string" && typeof f.campo === "string" && String(f.valor || "").trim()
    && String(f.fonte || "").trim() && String(f.dataConsulta || "").trim()
    && String(f.identificador || "").trim() && (f.tier === "T1" || f.tier === "T2"));
  const fatosAtuais = montarCatalogoFatos(asset).fatos;
  const idsUsados = new Set<string>();
  const numsAntigos = fatosPersistidos
    .map((f) => Number(String(f.id).match(/^F(\d+)$/)?.[1]))
    .filter(Number.isFinite);
  let proximoId = Math.max(0, ...numsAntigos) + 1;
  const fatosPublicaveis: FatoCatalogado[] = fatosAtuais.map((atual) => {
    const antigo = fatosPersistidos.find((f) =>
      !idsUsados.has(f.id)
      && f.campo === atual.campo
      && f.identificador === atual.identificador);
    const id = antigo?.id || `F${proximoId++}`;
    idsUsados.add(id);
    return { ...atual, id };
  });
  const reconstruir = (arr: any, origem: "prioridade" | "risco" | "encaminhamento") =>
    (Array.isArray(arr) ? arr : [])
      .map((e: any) => reconstruirEnunciadoPersistido(e, origem, fatosPublicaveis))
      .filter(Boolean) as Enunciado[];
  const prioridadesRemontadas = reconstruir(p.prioridades, "prioridade");
  const riscosRemontados = reconstruir(p.riscos, "risco");
  const encaminhamentosRemontados = reconstruir(p.encaminhamentos, "encaminhamento");
  const fatosPorId = new Map(fatosPublicaveis.map((f) => [f.id, f]));
  // Restrições atuais com proveniência completa entram mesmo quando o cache
  // é antigo e a regeneração da seleção por IA não estava disponível.
  const riscosAtuais = montarRiscosDeterministicos(fatosPublicaveis)
    .map((item) => itemParaEnunciado(item, "risco", fatosPorId));
  const riscosCandidatos = [...riscosRemontados, ...riscosAtuais].filter((e, i, todos) =>
    todos.findIndex((x) => x.templateId === e.templateId
      && (x.fatosIds || []).join(",") === (e.fatosIds || []).join(",")) === i);
  // Passo final único e adversarial sobre TODO o corpo. Sua única operação é
  // remover; contradições são avaliadas contra os dados atuais do ativo.
  const adversarialRender = passoAdversarial(
    [...montarSintese(fatosPublicaveis), ...prioridadesRemontadas, ...riscosCandidatos, ...encaminhamentosRemontados],
    montarContradicoes(asset),
  );
  const sintesePublicavel = adversarialRender.mantidas.filter((e) => e.origem === "sintese");
  const prioridadesPublicaveis = adversarialRender.mantidas.filter((e) => e.origem === "prioridade");
  const riscosPublicaveis = adversarialRender.mantidas.filter((e) => e.origem === "risco");
  const encaminhamentosPublicaveis = adversarialRender.mantidas.filter((e) => e.origem === "encaminhamento");
  const totalDerivadosPersistidos = ["prioridades", "riscos", "encaminhamentos"]
    .reduce((n, k) => n + (Array.isArray(p[k]) ? p[k].length : 0), 0);
  const totalDerivadosRemontados = prioridadesRemontadas.length + riscosRemontados.length + encaminhamentosRemontados.length;

  // Síntese determinística — frases montadas por template a partir do
  // catálogo de fatos; campo vazio não gera frase.
  if (sintesePublicavel.length > 0) {
    body += sub("Síntese do dossiê (FATOS)", `<ul class="lista">${sintesePublicavel.map((e: any) => liEnunciado(e)).join("")}</ul>`);
  }
  if (prioridadesPublicaveis.length > 0) {
    body += sub("Prioridades de verificação (DERIVADO)", `<ul class="lista">${prioridadesPublicaveis.map((e: any) => liEnunciado(e)).join("")}</ul>`);
  }
  if (riscosPublicaveis.length > 0) {
    body += sub("Riscos e pontos de atenção (DERIVADO)",
      `<ul class="lista">${riscosPublicaveis.map((e: any) => liEnunciado(e)).join("")}</ul>`);
  }
  if (encaminhamentosPublicaveis.length > 0) {
    body += sub("Encaminhamentos (DERIVADO)", `<ul class="lista">${encaminhamentosPublicaveis.map((e: any) => liEnunciado(e)).join("")}</ul>`);
  }
  if (!body) {
    body = `<p class="text">Nenhum enunciado com lastro suficiente foi publicado nesta geração — as lacunas declaradas e os dados brutos das fontes estão nas demais seções.</p>`;
  }

  // Catálogo de fatos citáveis — permite conferir cada afirmação em <1 min.
  if (fatosPublicaveis.length > 0) {
    body += sub(`Fatos citáveis atuais usados na análise (${fatosPublicaveis.length})`, dataTable(
      ["ID", "Campo", "Valor", "Fonte", "Consulta", "Vínculo", "Tier"],
      fatosPublicaveis.slice(0, 60).map((f: any) => [esc(f.id), esc(f.campo), esc(String(f.valor).slice(0, 180)), esc(f.fonte), esc(f.dataConsulta), esc(f.identificador), esc(f.tier)])
    ));
  }

  // Limitações: erros registrados (campo sem fonte ≠ null silencioso),
  // lacunas de disciplina e remoções do passo adversarial.
  let limit = "";
  if (Array.isArray(p.errosRegistrados) && p.errosRegistrados.length > 0) {
    // O texto bruto rejeitado é diagnóstico interno persistido, não conteúdo
    // publicável. A seção mostra apenas campo+motivo.
    limit += dataTable(["Campo", "Motivo do registro"],
      p.errosRegistrados.slice(0, 20).map((er: any) => [esc(er.campo), esc(er.motivo)]));
  }
  if (Array.isArray(p.lacunasDisciplina) && p.lacunasDisciplina.length > 0) {
    limit += `<ul class="lista">${p.lacunasDisciplina.map((l: any) => `<li>Campo "${esc(l.campo)}" rebaixado a lacuna declarada — ${esc(l.motivo)}</li>`).join("")}</ul>`;
  }
  if (Array.isArray(p.remocoes) && p.remocoes.length > 0) {
    limit += dataTable(["Origem", "Enunciado removido", "Motivo da remoção"],
      p.remocoes.slice(0, 20).map((r: any) => [esc(r.origem || "—"), esc(String(r.texto || "").slice(0, 200)), esc(r.motivo)]));
  }
  if (adversarialRender.remocoes.length > 0) {
    limit += dataTable(["Origem", "Enunciado removido na renderização", "Motivo da remoção"],
      adversarialRender.remocoes.slice(0, 20).map((r: any) => [esc(r.origem || "—"), esc(String(r.texto || "").slice(0, 200)), esc(r.motivo)]));
  }
  if (totalDerivadosRemontados < totalDerivadosPersistidos) {
    limit += `<p class="text">${totalDerivadosPersistidos - totalDerivadosRemontados} item(ns) persistido(s) não foram publicados porque não puderam ser remontados exclusivamente por template+fatos.</p>`;
  }
  if (limit) body += sub("Fontes e limitações desta análise", limit);

  body += `<p class="text" style="color:#6b7f7c;font-size:9px;">Método: o modelo preenche campos estruturados citando fatos do catálogo (valor + fonte + data da consulta + identificador); campo sem fonte é rejeitado como erro registrado; a prosa é montada por template determinístico e um passo adversarial final apenas REMOVE enunciados sem lastro (nunca reescreve). Campo vazio não gera frase. Hipóteses ficam em seção própria rotulada.</p>`;
  if (p.geradoEm) body += `<p class="text" style="color:#6b7f7c;font-size:9px;">Campos preenchidos com apoio de IA em ${fmtDate(p.geradoEm)} — revisar antes de decisões definitivas.</p>`;
  if (p.insumosHash && hashAtual && p.insumosHash !== hashAtual) {
    body += `<p class="text" style="color:#92400e;font-size:9px;">Atenção: os dados do ativo mudaram desde a seleção por IA e a regeneração não estava disponível nesta geração. Todos os fatos e templates foram revalidados contra o catálogo atual; itens que deixaram de satisfazer sua regra foram removidos, e as restrições atuais foram recalculadas deterministicamente.</p>`;
  }
  return section(TITULO, body);
}

// ── Conflitos entre campos estruturados (revisão humana) ──
function secConflitos(a: any, c: any): string {
  // Sempre recalculado na renderização (nunca persistido/hasheado).
  const scm = (a as any).__scmData || null;
  const conflitos = detectarConflitos(montarGrandezasProcesso(a, c, scm));
  if (conflitos.length === 0) return "";
  const body = dataTable(
    ["Grandeza", "Valores em conflito (todos exibidos)", "Ação"],
    conflitos.map((cf) => [
      esc(cf.grandeza),
      cf.valores.map((v) => `${esc(v.valor)} <span style="color:#6b7f7c;font-size:8px;">[${esc(v.fonte)}]</span>`).join("<br/>"),
      `<span style="color:#92400e;font-weight:600;">REVISÃO HUMANA NECESSÁRIA</span>`,
    ])
  ) + `<p class="text" style="color:#6b7f7c;font-size:9px;">O sistema nunca escolhe entre valores divergentes de fontes diferentes: ambos são exibidos e a grandeza fica fora do catálogo de fatos citáveis até a revisão humana resolver a divergência.</p>`;
  return section("Conflitos entre Fontes — Revisão Humana", body);
}

// ── Alertas de prazo (DERIVADOS determinísticos) ──
function secAlertasPrazo(a: any): string {
  const alertas = calcularAlertasPrazo(a);
  if (alertas.length === 0) return "";
  const corGrav = (g: string) => g === "critico" ? "#b91c1c" : g === "atencao" ? "#92400e" : "#0f5d58";
  const rotGrav = (g: string) => g === "critico" ? "CRÍTICO" : g === "atencao" ? "ATENÇÃO" : "INFO";
  const body = alertas.map((al) => `<div class="sub">
    <p class="text"><span style="color:${corGrav(al.gravidade)};font-weight:700;">[${rotGrav(al.gravidade)}]</span> <strong>${esc(al.titulo)}</strong><br/>${esc(al.texto)}</p>
    <p class="text" style="color:#6b7f7c;font-size:8px;">DERIVADO · Regra: ${esc(al.regra)} · Datas-fonte: ${esc(al.datasFonte.join("; "))} · Fonte: ${esc(al.fonte)}${al.identificador ? ` · id ${esc(al.identificador)}` : ""}</p>
  </div>`).join("");
  return section("Alertas de Prazo (derivados das datas estruturadas)",
    body + `<p class="text" style="color:#6b7f7c;font-size:9px;">Cada alerta é calculado deterministicamente das datas estruturadas do dossiê (sem IA) e recalculado a cada geração do relatório.</p>`);
}

// ── Lacunas estruturadas (entregável de quatro campos) ──
function secLacunas(a: any, c: any): string {
  const componentes = avaliarComponentesMaturidade(a);
  const lacunasMat = gerarLacunasDossie(componentes);
  const p = c.iaRelatorioConsolidado;
  const lacunasDisc: LacunaEstruturada[] = (p?.versao === PARECER_VERSAO && Array.isArray(p.lacunasDisciplina))
    ? p.lacunasDisciplina.map((l: any) => lacunaDisciplina(String(l.campo || "parecer"), String(l.motivo || "conteúdo descartado")))
    : [];
  const todas = [...lacunasMat, ...lacunasDisc];
  if (todas.length === 0) return "";
  // "Não é possível concluir" é saída de primeira classe (sucesso, não erro).
  const frases = lacunasMat.map((l) => fraseNaoConclusivo(l.tema.toLowerCase(), l.oQueFalta.toLowerCase()));
  const body = (frases.length > 0 ? `<ul class="lista">${frases.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "")
    + dataTable(["O que falta", "Por que importa", "Onde obter", "Custo e prazo estimados"],
      todas.map((l) => [esc(l.oQueFalta), esc(l.porQueImporta), esc(l.ondeObter), esc(l.custoPrazo)]))
    + `<p class="text" style="color:#6b7f7c;font-size:9px;">Lacuna declarada é saída de primeira classe deste relatório: registra o limite do que as fontes disponíveis sustentam. "Onde obter" e "custo/prazo" vêm de catálogo determinístico por tipo de documento (não são gerados por IA).</p>`;
  return section("Lacunas do Dossiê (o que falta e como obter)", body);
}

// ── Score de completude do dossiê — o ÚNICO indicador do relatório ──
function secCompletude(a: any, c: any): string {
  const componentes = avaliarComponentesMaturidade(a);
  if (componentes.length === 0) return "";
  const sc = computeScoreCompletude(componentes);
  const p = c.iaRelatorioConsolidado;
  const nDisciplina = p?.versao === PARECER_VERSAO && Array.isArray(p.lacunasDisciplina) ? p.lacunasDisciplina.length : 0;
  const metrica = metricaCobertura(sc.presentes, (sc.total - sc.presentes) + nDisciplina);
  const body = kvTable([
    ["Score de completude do dossiê", `<strong>${sc.score} / 100</strong> (${sc.presentes} de ${sc.total} componentes presentes)`],
    ["Fórmula (visível)", esc(sc.formula)],
    ["Campos respondidos (T1/T2) vs lacunas declaradas", esc(metrica.texto)],
  ]) + dataTable(["Componente", "Presente?", "Evidência", "Fonte", "Consulta"],
    componentes.map((comp) => [
      esc(comp.rotulo),
      comp.presente ? "Sim" : `<span style="color:#92400e;">NÃO — lacuna declarada</span>`,
      esc(String(comp.evidencia ?? "—").slice(0, 160)),
      esc(comp.fonte ?? "—"),
      esc(comp.dataConsulta ? String(comp.dataConsulta).slice(0, 10) : "—"),
    ]))
    + `<p class="text" style="color:#6b7f7c;font-size:9px;">Este é o único indicador numérico do relatório: mede COMPLETUDE do dossiê (quanto dos componentes críticos de maturidade está documentado), nunca o grau de certeza de conclusões — indicadores dessa natureza não são exibidos em nenhuma seção.</p>`;
  return section("Score de Completude do Dossiê", body);
}

// ── Hipóteses (seção própria rotulada — nunca no corpo) ──
function secHipoteses(c: any, vigencia: ResultadoVigenciaAlvara): string {
  const p = c.iaRelatorioConsolidado;
  if (p?.versao !== PARECER_VERSAO || !Array.isArray(p.hipoteses) || p.hipoteses.length === 0) return "";
  const hipoteses = p.hipoteses.filter((h: any) => textoLegadoSemConflitoVigencia(h?.texto, vigencia) !== null);
  if (hipoteses.length === 0) return "";
  const body = `<p class="text warning">Conjecturas rotuladas (HIPÓTESE/T4), sem lastro verificável nas fontes do dossiê. Não integram a síntese, as prioridades, os riscos nem os encaminhamentos.</p>`
    + `<ul class="lista">${hipoteses.map((h: any) => `<li><strong>HIPÓTESE:</strong> Se for confirmado em fonte T1/T2 o conteúdo a seguir — “${esc(String(h.texto || ""))}” — então o efeito sobre a decisão deverá ser reavaliado.${h.motivo ? ` <span class="citation">[por que permanece aberta: ${esc(h.motivo)}]</span>` : ""}</li>`).join("")}</ul>`;
  return section("Hipóteses (não verificadas)", body);
}

function textosNarrativosEquivalentes(a: string, b: string): boolean {
  const na = normalizarTexto(a).replace(/\s+/g, " ").trim();
  const nb = normalizarTexto(b).replace(/\s+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) < 120) return false;
  const tokens = (texto: string) => new Set(texto.split(/\W+/).filter((t) => t.length >= 5));
  const ta = tokens(na);
  const tb = tokens(nb);
  const menores = ta.size <= tb.size ? ta : tb;
  const maiores = ta.size <= tb.size ? tb : ta;
  if (menores.size === 0) return false;
  const intersecao = [...menores].filter((token) => maiores.has(token)).length;
  return intersecao / menores.size >= 0.9;
}

function secHipotesesLegadas(c: any, vigencia: ResultadoVigenciaAlvara): string {
  const candidatas: string[] = [];
  const enr = c.iaEnrichment;
  const resumoInvestigacao = normalizarTexto(c.iaDeepIntel?.resumoInvestigacao || "").replace(/\s+/g, " ").trim();
  if (enr?.resumoExecutivo) {
    const resumoExecutivo = String(enr.resumoExecutivo);
    if (!textosNarrativosEquivalentes(resumoExecutivo, resumoInvestigacao)) candidatas.push(resumoExecutivo);
  }
  for (const r of Array.isArray(enr?.riscosIdentificados) ? enr.riscosIdentificados : []) {
    candidatas.push(typeof r === "string" ? r : r?.descricao || r?.risco || "");
  }
  if (c.iaAnalise) candidatas.push(typeof c.iaAnalise === "string" ? c.iaAnalise : c.iaAnalise.resumo || c.iaAnalise.analise || "");
  if (c.iaPricing) candidatas.push(typeof c.iaPricing === "string" ? c.iaPricing : c.iaPricing.resumo || c.iaPricing.parecer || "");
  const filtradas = candidatas
    .map((x) => textoLegadoSemConflitoVigencia(x, vigencia))
    .filter((x): x is string => !!x?.trim())
    .map((x) => x.trim());
  const unicas = filtradas.reduce<string[]>((acc, atual) => {
    if (!acc.some((existente) => textosNarrativosEquivalentes(existente, atual))) acc.push(atual);
    return acc;
  }, []);
  if (!unicas.length) return "";
  return section("Hipóteses legadas (T4, não verificadas)",
    `<p class="text warning">Textos narrativos antigos de análise e precificação foram retirados do corpo, deduplicados e mantidos somente como hipóteses abertas.</p>`
    + `<ul class="lista">${unicas.map((x) => `<li><strong>HIPÓTESE:</strong> Se for confirmado em fonte T1/T2 que ${esc(x.replace(/[.]+$/, ""))}, então o efeito sobre a decisão e a avaliação econômica deverá ser reavaliado.</li>`).join("")}</ul>`);
}

// ── Montagem decisória: corpo enxuto, anexos auditáveis ────────────────────
const citacao = (fonte: any, data: any, extra?: string): string =>
  `<span class="citation">[${esc(fonte || "fonte não informada")}, ${esc(data ? fmtDate(data) : "data não informada")}${extra ? ` · ${esc(extra)}` : ""}]</span>`;

function linhaEscopo(nome: string, payload: any, escala?: string): string {
  const janela = payload?.janelaCobertura || payload?.dataBase || "janela temporal não informada";
  const data = payload?.consultadoEm || payload?.updatedAt || null;
  const anos = String(janela).match(/\b(?:19|20)\d{2}\b/g)?.map(Number) || [];
  const ultimoAno = anos.length ? Math.max(...anos) : null;
  const anoAtual = new Date().getFullYear();
  const periodo = /não informada|não determinado/i.test(String(janela))
    ? "Período não coberto: não informado. Situação desconhecida."
    : ultimoAno && ultimoAno < anoAtual ? `Período não coberto: ${ultimoAno + 1}–${anoAtual}. Situação desconhecida.` : "";
  return `<p class="scope"><strong>Escopo:</strong> ${esc(nome)} · consulta ${esc(data ? fmtDate(data) : "não informada")} · cobertura: ${esc(janela)}${escala ? ` · escala: ${esc(escala)}${/regional/i.test(escala) ? " (não substitui levantamento de detalhe)" : ""}` : ""}. ${periodo}</p>`;
}

function secMaturidadeDecisoria(a: any, c: any): string {
  const componentes = avaliarComponentesMaturidade(a);
  if (!componentes.length) return "";
  const score = computeScoreCompletude(componentes);
  const lacunas = gerarLacunasDossie(componentes);
  const disciplina: LacunaEstruturada[] = c.iaRelatorioConsolidado?.versao === PARECER_VERSAO
    ? (c.iaRelatorioConsolidado.lacunasDisciplina || []).map((x: any) => lacunaDisciplina(String(x.campo || "parecer"), String(x.motivo || "sem lastro")))
    : [];
  const metrica = metricaCobertura(score.presentes, lacunas.length + disciplina.length);
  const quadro = dataTable(["Campo crítico", "Situação", "Evidência / procedência"], componentes.map((x) => [
    esc(x.rotulo),
    x.presente ? "<strong>DOCUMENTADO</strong>" : `<strong class="missing">AUSENTE</strong>`,
    x.presente
      ? `${esc(x.evidencia || "—")} ${citacao(x.fonte, x.dataConsulta)}`
      : esc(fraseNaoConclusivo(x.rotulo.toLowerCase(), lacunas.find((l) => l.tema === x.rotulo)?.oQueFalta.toLowerCase() || "documentação comprobatória")),
  ]));
  const plano = [...lacunas, ...disciplina];
  const planoHtml = plano.length ? sub("Lacunas do Dossiê (o que falta e como obter)", dataTable(
    ["O que falta", "Por que importa", "Onde obter", "Custo e prazo"],
    plano.map((x) => [esc(x.oQueFalta), esc(x.porQueImporta), esc(x.ondeObter), esc(x.custoPrazo)]),
  )) : para("Nenhuma lacuna crítica foi identificada pelos componentes avaliados.");
  return section("1. Identificação e maturidade do ativo", kvTable([
    ["Ativo", `${esc(a.title || "—")} ${citacao("cadastro do ativo", a.createdAt, `id ativo ${a.id ?? "—"}`)}`],
    ["Processo / localização", `${esc([c.processoAnm || a.anmProcesso, a.municipio, a.estado].filter(Boolean).join(" · ") || "—")} ${citacao("cadastro do ativo", a.createdAt)}`],
  ]) + sub("Score de Completude do Dossiê", kvTable([
    ["Score de completude", `<strong>${score.score}/100</strong> — ${score.presentes} de ${score.total} componentes documentados`],
    ["Fórmula", esc(score.formula)],
    ["Cobertura", esc(metrica.texto)],
  ])) + quadro + planoHtml);
}

interface ParecerRender {
  estado: "ok" | "ausente" | "legado";
  desatualizado: boolean;
  sintese: Enunciado[];
  prioridades: Enunciado[];
  riscos: Enunciado[];
  encaminhamentos: Enunciado[];
  fatos: FatoCatalogado[];
  descartadosPersistidos: number;
  remocoes: Array<{ texto?: string; origem?: string; motivo: string }>;
}

/**
 * Revalida o parecer contra os dados atuais. O texto persistido nunca é
 * publicado diretamente: itens derivados são remontados por template e todo o
 * conjunto passa novamente pelo passo adversarial.
 */
function prepararParecerRender(asset: any, c: any): ParecerRender {
  const p = c.iaRelatorioConsolidado;
  const vazio = { desatualizado: false, sintese: [], prioridades: [], riscos: [], encaminhamentos: [], fatos: [], descartadosPersistidos: 0, remocoes: [] };
  if (!p) return { estado: "ausente", ...vazio };
  if (p.versao !== PARECER_VERSAO) return { estado: "legado", ...vazio };

  const persistidos: FatoCatalogado[] = (Array.isArray(p.fatos) ? p.fatos : []).filter((f: any) =>
    f && typeof f.id === "string" && typeof f.campo === "string" && String(f.valor || "").trim()
    && String(f.fonte || "").trim() && String(f.dataConsulta || "").trim()
    && String(f.identificador || "").trim() && (f.tier === "T1" || f.tier === "T2"));
  const atuais = montarCatalogoFatos(asset).fatos;
  const idsUsados = new Set<string>();
  const nums = persistidos.map((f) => Number(String(f.id).match(/^F(\d+)$/)?.[1])).filter(Number.isFinite);
  let proximoId = Math.max(0, ...nums) + 1;
  const fatos: FatoCatalogado[] = atuais.map((atual) => {
    const antigo = persistidos.find((f) => !idsUsados.has(f.id) && f.campo === atual.campo && f.identificador === atual.identificador);
    const id = antigo?.id || `F${proximoId++}`;
    idsUsados.add(id);
    return { ...atual, id };
  });
  const reconstruir = (arr: any, origem: "prioridade" | "risco" | "encaminhamento") =>
    (Array.isArray(arr) ? arr : []).map((e: any) => reconstruirEnunciadoPersistido(e, origem, fatos)).filter(Boolean) as Enunciado[];
  const prioridades = reconstruir(p.prioridades, "prioridade");
  const riscosPersistidos = reconstruir(p.riscos, "risco");
  const encaminhamentos = reconstruir(p.encaminhamentos, "encaminhamento");
  const totalPersistidos = ["prioridades", "riscos", "encaminhamentos"]
    .reduce((total, chave) => total + (Array.isArray(p[chave]) ? p[chave].length : 0), 0);
  const totalRemontados = prioridades.length + riscosPersistidos.length + encaminhamentos.length;
  const fatosPorId = new Map(fatos.map((f) => [f.id, f]));
  const riscosAtuais = montarRiscosDeterministicos(fatos).map((item) => itemParaEnunciado(item, "risco", fatosPorId));
  const riscos = [...riscosPersistidos, ...riscosAtuais].filter((e, i, todos) =>
    todos.findIndex((x) => x.templateId === e.templateId && (x.fatosIds || []).join(",") === (e.fatosIds || []).join(",")) === i);
  const adversarial = passoAdversarial(
    [...montarSintese(fatos), ...prioridades, ...riscos, ...encaminhamentos],
    montarContradicoes(asset),
  );
  const porOrigem = (origem: string) => adversarial.mantidas.filter((e) => e.origem === origem);
  return {
    estado: "ok",
    desatualizado: !!(p.insumosHash && p.insumosHash !== hashConsolidatedInsumos(asset)),
    sintese: porOrigem("sintese"),
    prioridades: porOrigem("prioridade"),
    riscos: porOrigem("risco"),
    encaminhamentos: porOrigem("encaminhamento"),
    fatos,
    descartadosPersistidos: totalPersistidos - totalRemontados,
    remocoes: adversarial.remocoes,
  };
}

function secParecerDecisorio(parecer: ParecerRender): string {
  if (parecer.estado === "ausente") {
    return section("2. Parecer Consolidado (disciplina de certeza)", `<p class="warning">Parecer consolidado indisponível nesta geração. Nenhuma narrativa livre foi usada como substituta; a decisão deve se apoiar nos fatos e lacunas das demais seções.</p>`);
  }
  if (parecer.estado === "legado") {
    return section("2. Parecer Consolidado (disciplina de certeza)", `<p class="warning">O parecer persistido está em formato antigo e não é exibido porque não possui enunciados classificados e procedência reproduzível; será regerado no novo formato quando a análise estiver disponível.</p>`);
  }
  const sintese = parecer.sintese.length
    ? sub("Conclusões sustentadas", `<ul class="lista">${parecer.sintese.map((x) => liEnunciado(x)).join("")}</ul>`)
    : para("Nenhuma conclusão com lastro suficiente foi publicada nesta geração.");
  const prioridades = parecer.prioridades.length
    ? sub("O que precisa ser resolvido antes do investimento", `<ul class="lista">${parecer.prioridades.map((x) => liEnunciado(x)).join("")}</ul>`)
    : "";
  const desatualizado = parecer.desatualizado
    ? `<p class="warning">Os dados do ativo mudaram desde a seleção por IA. Todos os itens foram revalidados contra o catálogo atual; qualquer item incompatível foi removido.</p>`
    : "";
  return section("2. Parecer Consolidado (disciplina de certeza)", sintese + prioridades + desatualizado);
}

function secAnexoAuditoriaParecer(parecer: ParecerRender): string {
  if (parecer.estado !== "ok") return "";
  const fatos = parecer.fatos.length ? dataTable(
    ["ID", "Campo", "Valor", "Fonte", "Consulta", "Vínculo", "Tier"],
    parecer.fatos.map((f) => [esc(f.id), esc(f.campo), esc(String(f.valor).slice(0, 180)), esc(f.fonte), esc(f.dataConsulta), esc(f.identificador), esc(f.tier)]),
  ) : para("Nenhum fato T1/T2 citável nesta geração.");
  const descartados = parecer.descartadosPersistidos > 0
    ? `<p class="text">${parecer.descartadosPersistidos} item(ns) persistido(s) não foram publicados porque não puderam ser remontados exclusivamente por template e fatos atuais.</p>`
    : "";
  return section(`Anexo — Fatos citáveis atuais usados na análise (${parecer.fatos.length})`, fatos + descartados);
}

function secSituacaoProcessual(a: any, c: any): string {
  const scm = (a as any).__scmData || null;
  const vigencia = obterVigenciaCalculada(a);
  const campos = aplicarVigenciaCanonicaAosCampos(buildProcessoAnmCampos(a, c, scm), vigencia);
  const eventos = filtrarEventosReais(c.anmHistorico?.eventos, c.processoAnm);
  const rotuloConflito: Record<string, string> = {
    "Área do processo (ha)": "Área (ha)",
    Titular: "Titular",
    Fase: "Fase",
    UF: "UF",
    Substância: "Substância",
  };
  const conflitos = detectarConflitos(montarGrandezasProcesso(a, c, scm));
  const camposConflitados = new Set(conflitos.map((x) => rotuloConflito[x.grandeza]).filter(Boolean));
  const metadadoFonte = (fonteOriginal: string | null, label?: string): { fonte: string; data: any } => {
    if (/cálculo determinístico/i.test(fonteOriginal || "")) {
      return { fonte: vigencia.fonte, data: c.anmHistorico?.consultadoEm || c.anmHistoricoUpdatedAt || vigencia.etapas.at(-1)?.dataEvento };
    }
    if (/SIGMINE/i.test(fonteOriginal || "")) return { fonte: "SIGMINE/ANM", data: c.anmLiveDataUpdatedAt };
    if (/SCM/i.test(fonteOriginal || "") || (!fonteOriginal && label === "Nº do processo" && scm?.consultadoEm)) {
      return { fonte: "SCM/ANM", data: scm?.consultadoEm };
    }
    return { fonte: "cadastro do ativo", data: a.createdAt };
  };
  const linhas: string[][] = campos
    .filter((x) => !camposConflitados.has(x.label))
    .map((x) => {
      const meta = metadadoFonte(x.fonte, x.label);
      if (!meta.data) {
        return [esc(x.label), `<strong class="missing">A VERIFICAR — valor sem data de procedência publicável.</strong>`];
      }
      return [esc(x.label), `${esc(x.valor)} ${citacao(meta.fonte, meta.data, c.processoAnm || a.anmProcesso)}`];
    });
  for (const conflito of conflitos) {
    linhas.push([
      esc(rotuloConflito[conflito.grandeza] || conflito.grandeza),
      `<strong class="missing">A VERIFICAR — CONFLITO ENTRE FONTES.</strong> ${conflito.valores.map((v) => {
        const meta = metadadoFonte(v.fonte);
        return `${esc(v.valor)} ${citacao(meta.fonte, meta.data)}`;
      }).join(" · ")}`,
    ]);
  }
  const processo = linhas.length ? dataTable(["Campo", "Valor e procedência"], linhas) : para("Não é possível concluir sobre a situação processual: dados do processo ausentes.");
  const ultimos = eventos.length
    ? `<div data-vigencia-historico="true">${dataTable(["Data", "Evento"], eventos.slice(0, 4).map((x: any) => [fmtDate(x.data), `${esc(x.descricao)} ${citacao(c.anmHistorico?.fonte || "Eventos ANM", x.data, c.processoAnm)}`]))}</div>`
    : para(NOTA_HISTORICO_INDISPONIVEL);
  const escopoProcesso = { fonte: "SCM/ANM + SIGMINE/ANM", consultadoEm: scm?.consultadoEm || c.anmLiveDataUpdatedAt, janelaTemporal: "situação cadastral na data da consulta" };
  return section("3. Situação processual e alertas de prazo", processo + linhaEscopo("Cadastro Mineiro / SCM", escopoProcesso)
    + sub("Eventos recentes", ultimos) + (secAlertasPrazo(a).replace(/^<section><h2>.*?<\/h2>|<\/section>$/g, "") || para("Nenhum alerta de prazo derivado das datas estruturadas.")));
}

function secContraparte(a: any, c: any): string {
  const scm = (a as any).__scmData || {};
  const titular = scm.titularNome || c.anmTitular?.titular?.nome || c.anmTitular?.nome;
  const cnpj = scm.titularCnpj || c.anmTitular?.titular?.cnpj || c.anmCertidoesTitular?.cnpj;
  const outros = Array.isArray(c.anmOutrosProcessos) ? c.anmOutrosProcessos : Array.isArray(c.anmTitular?.outrosProcessos) ? c.anmTitular.outrosProcessos : [];
  const cert = c.anmCertidoesTitular;
  if (!titular && !cert && !outros.length) return "";
  const favoraveis: string[] = [], desfavoraveis: string[] = [];
  const aviso = avisoCertidoesVinculo(cert);
  const cnpjValido = String(cert?.cnpj || "").replace(/\D/g, "").length === 14;
  const vinculoCertidoesConfirmado = !!cert && cnpjValido && !aviso && cert.vinculoConfirmadoPorDocumento !== false;
  if (vinculoCertidoesConfirmado && cert?.ceis) {
    (cert.ceis.sancionado ? desfavoraveis : favoraveis).push(cert.ceis.sancionado ? `CEIS: sanção(ões) vigente(s) registrada(s)` : "CEIS: sem sanção vigente na data consultada");
  }
  if (vinculoCertidoesConfirmado && cert?.pgfn?.situacao) {
    (cert.pgfn.temDebitoAtivo ? desfavoraveis : favoraveis).push(`PGFN: ${cert.pgfn.situacao}`);
  }
  if (vinculoCertidoesConfirmado && cert?.cnj === null) {
    desfavoraveis.push("CNJ DataJud: não permite certidão por CNPJ de parte; situação judicial desconhecida.");
  }
  if (vinculoCertidoesConfirmado && c.anmCfem?.titular?.jaRecolheu) {
    favoraveis.push(`Capacidade operacional observada: titular com recolhimentos de CFEM em ${fmtNum(c.anmCfem.titular.processosDistintos, 0)} processo(s).`);
  }
  if (cert && !vinculoCertidoesConfirmado) {
    desfavoraveis.push("Não é possível atribuir os resultados de PGFN, CEIS ou CNJ à contraparte: o vínculo do CNPJ não foi confirmado por documento oficial.");
  } else if (!cert) {
    desfavoraveis.push("Não é possível concluir sobre sanções, dívida ativa ou processos judiciais: certidões não consultadas nesta geração.");
  }
  const body = kvTable([
    ["Titular público", esc(titular || "ausente")],
    ["CNPJ (somente PJ)", cnpj && String(cnpj).replace(/\D/g, "").length === 14 ? esc(cnpj) : "ausente / não exibido para PF"],
    ["Proveniência do identificador", esc(cert?.identificadorVinculo?.proveniencia || "não informada")],
  ]) + linhaEscopo("SCM/ANM e certidões", cert)
    + (aviso ? `<p class="warning">${esc(aviso)}</p>` : "")
    + sub("Sinais favoráveis", favoraveis.length ? `<ul class="lista">${favoraveis.map(esc).map(x => `<li>${x}</li>`).join("")}</ul>` : para("Nenhum sinal favorável conclusivo disponível."))
    + sub("Pontos desfavoráveis ou não conclusivos", desfavoraveis.length ? `<ul class="lista">${desfavoraveis.map(esc).map(x => `<li>${x}</li>`).join("")}</ul>` : para("Nenhum ponto desfavorável registrado nas fontes consultadas."))
    + sub("Atos do titular em outros processos", outros.length
      ? para(`${outros.length} candidato(s) localizado(s) apenas por coincidência de nome foram excluídos do corpo e movidos ao anexo T3; sem identificador confirmado, não constituem fato da contraparte.`)
      : para("Nenhum ato em outro processo foi vinculado à contraparte por identificador confirmado."))
    + `<p class="scope">Os atos e certidões desta seção referem-se à contraparte e a outros ativos, não ao processo analisado; importam para diligência de capacidade e histórico, sem alterar fatos do ativo. Coincidência exclusivamente por nome não gera alerta nem fato.</p>`;
  return section("4. Contraparte: histórico, sanções e capacidade", body);
}

function secAnexoContraparteT3(c: any): string {
  const outros = Array.isArray(c.anmOutrosProcessos)
    ? c.anmOutrosProcessos
    : Array.isArray(c.anmTitular?.outrosProcessos) ? c.anmTitular.outrosProcessos : [];
  if (!outros.length) return "";
  const consultadoEm = c.anmTitular?.consultadoEm || c.anmTitularUpdatedAt;
  return section("Anexo T3 — Processos com nome de titular coincidente (não verificados)",
    `<p class="warning">Estas linhas foram localizadas por nome, sem vínculo confirmado por CNPJ ou outro identificador. Não atribuir os atos à contraparte sem confirmação documental.</p>`
    + dataTable(["Processo", "Nome retornado", "Fase", "Substância", "UF", "Procedência"], outros.map((x: any) => [
      esc(x.PROCESSO || x.processo || ""),
      esc(x.NOME || x.nome || ""),
      esc(x.FASE || x.fase || ""),
      esc(x.SUBS || x.substancia || ""),
      esc(x.UF || x.uf || ""),
      citacao("SIGMINE/ANM — consulta por nome", consultadoEm),
    ])));
}

function severidadeRisco(texto: string): number {
  const n = String(texto).toLowerCase();
  if (/sobreposi|sancion|dívida|divida|crítico|critico|vencid|prazo expir/.test(n)) return 3;
  if (/restri|pendên|penden|não consult|ausente|conflito/.test(n)) return 2;
  return 1;
}

function idsEnunciado(e: Enunciado): string[] {
  return Array.isArray(e.fatosIds) ? e.fatosIds : (e.insumos || []).map((x) => String(x).match(/^F\d+/)?.[0]).filter(Boolean) as string[];
}

function secRiscosDecisorios(parecer: ParecerRender): string {
  const riscos = [...parecer.riscos].sort((a, b) => severidadeRisco(b.texto) - severidadeRisco(a.texto));
  if (!riscos.length) {
    return section("8. Riscos priorizados e encaminhamentos",
      `<p class="text">Não é possível concluir sobre riscos adicionais com o parecer disponível. As lacunas críticas e fontes não consultadas desta geração permanecem como condições de diligência antes do aporte.</p>`);
  }
  const rows = riscos.map((r) => {
    const ids = new Set(idsEnunciado(r));
    const encaminhamento = parecer.encaminhamentos.find((e) => idsEnunciado(e).some((id) => ids.has(id)));
    const gravidade = severidadeRisco(r.texto) === 3 ? "ALTA" : severidadeRisco(r.texto) === 2 ? "MÉDIA" : "BAIXA";
    return [
      gravidade,
      `${esc(r.texto)} ${citacao(r.fonte, r.dataConsulta, [r.identificador ? `id ${r.identificador}` : "", r.regra ? `regra: ${r.regra}` : "", (r.insumos || []).length ? `insumos: ${(r.insumos || []).join("; ")}` : ""].filter(Boolean).join("; "))}`,
      encaminhamento
        ? `${esc(encaminhamento.texto)} ${citacao(encaminhamento.fonte, encaminhamento.dataConsulta, encaminhamento.regra ? `regra: ${encaminhamento.regra}` : undefined)}`
        : "Confirmar a evidência na fonte citada e definir responsável, prazo e condição de fechamento antes do aporte.",
    ];
  });
  return section("8. Riscos priorizados e encaminhamentos", dataTable(["Severidade", "Risco", "Encaminhamento"], rows));
}

function secFundiarioSocioambiental(c: any): string {
  const partes: string[] = [];
  if (c.anmRestricoes || c.anmFunai || c.anmFunaiTerras) {
    const q = montarQuadroCamadas(c);
    partes.push(sub("Restrições socioambientais", dataTable(["Camada", "Situação", "Destaque / procedência"], q.linhas.map((x) => [
      esc(x.label), esc(x.status), `${esc(x.destaque || "—")} ${citacao(c.anmRestricoes?.fonte || x.label, c.anmRestricoes?.consultadoEm)}`,
    ])) + linhaEscopo("FUNAI, CNUC/MMA, ICMBio, CANIE/CECAV e INCRA/IBGE", c.anmRestricoes, "regional")));
  }
  if (c.sigefParcelas) {
    partes.push(sub("Situação fundiária", `<p class="text">${fmtNum(c.sigefParcelas.totalSobrepostas, 0)} parcela(s) SIGEF sobre o processo; cobertura certificada ${c.sigefParcelas.coberturaPct != null ? `${fmtNum(c.sigefParcelas.coberturaPct)}%` : "a verificar"}. ${citacao(c.sigefParcelas.fonte || "SIGEF/INCRA", c.sigefParcelas.consultadoEm)}</p>`));
  }
  if (c.carImoveis) {
    partes.push(`<p class="text">${fmtNum(c.carImoveis.totalSobrepostos, 0)} imóvel(is) CAR sobre o processo; cobertura declarada ${c.carImoveis.coberturaPct != null ? `${fmtNum(c.carImoveis.coberturaPct)}%` : "a verificar"}. ${citacao(c.carImoveis.fonte || "SICAR", c.carImoveis.consultadoEm)}</p>`);
  }
  const barragens = Array.isArray(c.anmBarragens?.proximas) ? [...c.anmBarragens.proximas] : [];
  barragens.sort((a: any, b: any) => {
    const risco = (x: any) => /alto|emerg/i.test(`${x.categoriaRisco} ${x.danoPotencial} ${x.nivelEmergencia}`) ? 1 : 0;
    return risco(b) - risco(a) || Number(a.distanciaKm ?? Infinity) - Number(b.distanciaKm ?? Infinity);
  });
  if (barragens.length) {
    partes.push(sub(`Barragens próximas — ${Math.min(3, barragens.length)} priorizadas de ${barragens.length}`, dataTable(
      ["Barragem", "Risco / dano", "Distância", "Procedência"],
      barragens.slice(0, 3).map((b: any) => [esc(b.nome || ""), esc([b.categoriaRisco, b.danoPotencial, b.nivelEmergencia].filter(Boolean).join(" · ")), `${fmtNum(b.distanciaKm, 1)} km`, citacao(c.anmBarragens.fonte || "SIGBM/ANM", c.anmBarragens.consultadoEm)]),
    ) + (barragens.length > 3 ? para(`${barragens.length - 3} registro(s) adicional(is) no anexo de listagens completas.`) : "")));
  }
  return partes.length ? section("5. Fundiário e socioambiental", partes.join("")) : "";
}

function secInfraestruturaContexto(a: any, c: any): string {
  const partes: string[] = [];
  const recursos: any[] = Array.isArray(c.anmRecursos?.data) ? [...c.anmRecursos.data] : [];
  const substancia = String(c.substancia || "").toLowerCase();
  recursos.sort((a, b) => {
    const score = (x: any) => (substancia && String(x.substancias || "").toLowerCase().includes(substancia) ? 4 : 0)
      + (/mina|jazida|reserva|recurso|produção|producao/i.test(String(x.status_economico || x.importancia || "")) ? 2 : 0);
    return score(b) - score(a) || Number(a.distancia_km ?? Infinity) - Number(b.distancia_km ?? Infinity);
  });
  if (recursos.length) {
    partes.push(sub(`Ocorrências minerais priorizadas — ${Math.min(3, recursos.length)} de ${recursos.length}`, dataTable(
      ["Ocorrência", "Substância", "Status", "Distância / procedência"],
      recursos.slice(0, 3).map((r: any) => [
        esc(r.nome_ocorrencia || ""), esc(r.substancias || ""), esc(r.status_economico || r.importancia || ""),
        `${fmtNum(r.distancia_km, 1)} km ${citacao(c.anmRecursos?.fonte || "GeoSGB/CPRM", c.anmRecursos?.consultadoEm, "escala regional")}`,
      ]),
    ) + (recursos.length > 3 ? para(`${recursos.length - 3} registro(s) adicional(is) no anexo de listagens completas.`) : "")
      + `<p class="scope">A prioridade considera, nesta ordem, mesma substância, status economicamente relevante e menor distância. Dados regionais não substituem levantamento de detalhe.</p>`));
  }
  if (c.anmLogistica) {
    const l = c.anmLogistica;
    const linha = (nome: string, x: any) => [
      nome,
      x?.consultado === false ? "fonte não consultada" : x?.encontrado ? `${esc(x.nome || "")} — ${fmtNum(x.distanciaKm, 1)} km` : `nenhuma referência no raio de ${fmtNum(x?.raioBuscaKm, 0)} km`,
      citacao(l.fontes?.[nome.toLowerCase()] || l.fonte || "base pública de infraestrutura", l.consultadoEm, "escala regional"),
    ];
    partes.push(sub("Infraestrutura próxima", dataTable(["Tipo", "Referência", "Procedência"], [
      linha("Rodovia", l.rodovia), linha("Hidrovia", l.hidrovia), linha("Ferrovia", l.ferrovia),
      linha("Porto", l.porto), linha("Linha de transmissão", l.linhaTransmissao),
    ]) + linhaEscopo("Bases públicas de infraestrutura", l, "regional")));
  }
  if (a.geoAltMed != null || a.geoDeclivityMed != null) {
    partes.push(`<p class="text">Terreno: altitude média ${fmtNum(a.geoAltMed)} m; declividade média ${fmtNum(a.geoDeclivityMed)}%. ${citacao("análise geográfica do polígono", a.geoAnalyzedAt, "regra: estatística espacial sobre o polígono")}</p>`);
  }
  return section("7. Infraestrutura e contexto mineral", partes.length
    ? partes.join("")
    : `<p class="text">Não é possível concluir sobre infraestrutura e contexto mineral com as fontes disponíveis.</p>${linhaEscopo("infraestrutura e contexto mineral", null, "regional")}`);
}

// 6. Evidências da jazida — catálogo determinístico (dentro/entorno/regional/
// documento), impeditivos documentados, divergências e lacunas por perfil
// mineral. Só templates fixos com fonte+data; nada redigido por IA.
function secEvidenciasJazida(a: any, c: any, geometry: any | null): string {
  if (a?.type !== "MINA" && !c?.processoAnm) return "";
  const cat = construirCatalogoEvidencias(a, geometry);
  const rotuloVinculo: Record<string, string> = { poligono: "Dentro do polígono", entorno: "Entorno (com distância)", regional: "Contexto regional", documento: "Documento vinculado" };
  const partes: string[] = [];
  partes.push(kvTable([
    ["Substância e perfil", `${val(cat.perfil.substancia)} — ${esc(cat.perfil.rotuloGrupo)}`],
    ["Fase ANM", `${val(cat.perfil.fase)} (${esc(cat.perfil.rotuloFase)})`],
    ["Prioridades de avaliação do perfil", esc(cat.perfil.prioridades.join("; "))],
    ["Unidade esperada de teor/qualidade", esc(cat.perfil.unidadesTeor)],
    ["Base espacial", cat.poligono.disponivel ? "polígono do ativo (ponto-em-polígono)" : cat.poligono.raioEquivalenteKm != null ? `sem polígono — raio equivalente à área ${fmtNum(cat.poligono.raioEquivalenteKm, 2)} km em torno do ponto de referência` : "sem polígono nem área — apenas distâncias ao ponto de referência"],
    ["Evidências por vínculo", esc(`dentro do polígono: ${cat.sintese.porVinculo.poligono} · entorno: ${cat.sintese.porVinculo.entorno} · regional: ${cat.sintese.porVinculo.regional} · documentos: ${cat.sintese.porVinculo.documento}`)],
  ]));
  if (cat.sintese.destaques.length) partes.push(sub("Síntese das evidências", `<ul class="lista">${cat.sintese.destaques.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`));
  for (const v of ["poligono", "entorno", "regional", "documento"] as const) {
    const itens = cat.itens.filter((i) => i.vinculo === v).slice(0, v === "entorno" ? 12 : 8);
    if (!itens.length) continue;
    partes.push(sub(`${rotuloVinculo[v]} — ${itens.length} de ${cat.sintese.porVinculo[v]}`, dataTable(
      ["Tema", "Evidência", "Detalhe", "Distância", "Procedência"],
      itens.map((i) => [
        esc(i.tema), esc(i.titulo), esc(i.detalhe),
        i.distanciaKm != null ? `${fmtNum(i.distanciaKm, 1)} km${i.raioKm != null ? ` (raio ${fmtNum(i.raioKm, 0)} km)` : ""}` : i.raioKm != null ? `raio ${fmtNum(i.raioKm, 0)} km` : "—",
        citacao(i.fonte, i.consultadoEm, i.identificador ? `id ${i.identificador}` : undefined),
      ]),
    )));
  }
  partes.push(sub("Impeditivos documentados", cat.impeditivos.length
    ? dataTable(["Severidade", "Impeditivo", "Detalhe", "Procedência"], cat.impeditivos.map((i) => [esc(i.severidade === "impeditivo" ? "Sobreposição direta" : "Atenção"), esc(i.titulo), esc(i.detalhe), citacao(i.fonte, i.consultadoEm)]))
    : para(cat.fontes.some((f) => f.id === "anmRestricoes" && f.estado === "registro")
      ? "Nenhuma sobreposição direta ou ocorrência no raio registrada nas camadas consultadas (vale só para as camadas e o raio indicados na seção de fundiário e socioambiental)."
      : "Camadas de restrição não consultadas — não é possível concluir sobre impeditivos.")));
  if (cat.divergencias.length) partes.push(sub("Divergências entre fontes", dataTable(["Tema", "Divergência", "Fontes"], cat.divergencias.map((d) => [esc(d.tema), esc(d.detalhe), esc(d.fontes.join("; "))]))));
  partes.push(sub(`Lacunas prioritárias do perfil (${esc(cat.perfil.rotuloGrupo)})`, dataTable(
    ["P", "Tema", "O que falta", "Por que importa", "Onde obter", "Evidência parcial disponível"],
    cat.lacunas.map((l) => [String(l.prioridade), esc(l.tema), esc(l.oQueFalta), esc(l.porQueImporta), esc(l.ondeObter), esc(l.evidenciaParcial || "nenhuma")]),
  ) + `<p class="scope">Lista orientada pelo tipo de depósito e pela fase; não altera o score de completude (seção de fontes), que continua sendo o único indicador do dossiê.</p>`));
  if (cat.proximosPassos.length) partes.push(sub("Próximos passos", `<ol class="lista">${cat.proximosPassos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>`));
  partes.push(sub("Estado das fontes do catálogo", dataTable(["Fonte", "Estado", "Consulta", "Raio", "Observação"], cat.fontes.map((f) => [
    esc(f.label),
    esc(f.estado === "registro" ? "com registro" : f.estado === "sem_registro" ? "consultada, sem registro" : f.estado === "indisponivel" ? "indisponível (não é ausência)" : "não consultada"),
    esc(f.consultadoEm ? fmtDate(f.consultadoEm) : "—"), f.raioKm != null ? `${fmtNum(f.raioKm, 0)} km` : "—", esc(f.motivo || f.cobertura || ""),
  ]))));
  partes.push(`<p class="scope">${cat.sintese.avisos.map(esc).join(" ")}</p>`);
  return section("6. Evidências da jazida: síntese, impeditivos e lacunas", partes.join(""));
}

// Anexo — listagens completas da pesquisa complementar (fontes públicas + Hub).
function secAnexoPesquisaComplementar(c: any): string {
  const pc = c?.anmPesquisaComplementar;
  if (!pc?.fontes) return "";
  const partes: string[] = [];
  const cab = (f: any) => `<p class="scope">${esc(f.fonte)} · estado: ${esc(f.estado)}${f.motivo ? ` · ${esc(f.motivo)}` : ""} · consulta ${esc(f.consultadoEm ? fmtDate(f.consultadoEm) : "—")}${f.raioKm != null ? ` · raio ${fmtNum(f.raioKm, 0)} km` : ""}${f.truncado ? " · listagem cortada por limite de volume" : ""}. ${esc(f.cobertura || "")}</p>`;
  const viz = pc.fontes.processosVizinhos;
  if (viz) partes.push(sub("Processos ANM vizinhos", cab(viz) + dataTable(["Processo", "Fase", "Substância", "Titular", "Área (ha)", "Distância", "Mesma substância"], (viz.data?.processos || []).map((p: any) => [esc(p.processo), esc(p.fase), esc(p.substancia), esc(p.titular || "—"), fmtNum(p.areaHa, 2), p.distanciaKm != null ? `${fmtNum(p.distanciaKm, 1)} km${p.contemPontoReferencia ? " (contém o ponto)" : ""}` : "—", p.mesmaSubstancia ? "sim" : "não"]))));
  const sgb = pc.fontes.sgbContexto;
  if (sgb) partes.push(sub("Bacias sedimentares e geocronologia (SGB)", cab(sgb) + dataTable(["Bacia", "Tipo"], (sgb.data?.bacias || []).map((b: any) => [esc(b.nome), esc(b.tipo || "—")])) + dataTable(["Amostra", "Rocha", "Métodos", "Distância"], (sgb.data?.geocronologia || []).map((g: any) => [esc(g.amostra || "—"), esc(g.rocha || "—"), esc(g.metodos || "—"), g.distanciaKm != null ? `${fmtNum(g.distanciaKm, 1)} km` : "—"]))));
  const lito = pc.fontes.litoDetalhada;
  if (lito) partes.push(sub("Litoestratigrafia de detalhe (GeoSGB)", cab(lito) + dataTable(["Escala", "Sigla", "Unidade", "Litotipos", "Idade"], (lito.data?.unidades || []).map((u: any) => [esc(u.escala), esc(u.sigla || "—"), esc(u.nome || "—"), esc(u.litotipos || "—"), esc(u.idade || "—")]))));
  const aflo = pc.fontes.afloramentos;
  if (aflo) partes.push(sub("Afloramentos descritos (GeoSGB)", cab(aflo) + dataTable(["Ponto", "Rochas", "Tipo", "Projeto / folha", "Distância"], (aflo.data?.pontos || []).map((a: any) => [esc(a.numeroCampo || a.id), esc(a.rochas || "—"), esc(a.tipo || "—"), esc([a.projeto, a.folha].filter(Boolean).join(" / ") || "—"), a.distanciaKm != null ? `${fmtNum(a.distanciaKm, 1)} km` : "—"]))));
  const h = pc.fontes.recursosHidricos;
  if (h) {
    const d = h.data || {};
    const camada = (x: any, nome: string) => x?.estado === "indisponivel" ? para(`Camada indisponível nesta consulta (${x.motivo || "sem motivo"}) — não é ausência de registro.`) : x?.estado === "sem_registro" ? para(`Nenhum registro de ${nome} no raio consultado (vale só para esta camada e este raio).`) : "";
    partes.push(sub("Recursos hídricos (ANA/SNIRH)", cab(h)
      + sub(`Cursos d'água em ${fmtNum(d.cursosDagua?.raioKm ?? 5, 0)} km — ${esc(d.cursosDagua?.estado || "—")}`, camada(d.cursosDagua, "cursos d'água") + dataTable(["Curso d'água", "Dominialidade", "Órgão gestor", "Área a montante (km²)", "Distância"], (d.cursosDagua?.itens || []).map((r: any) => [esc(r.nome), esc(r.dominialidade || "—"), esc(r.orgaoGestor || "—"), fmtNum(r.areaMontanteKm2, 0), r.distanciaKm != null ? `${fmtNum(r.distanciaKm, 1)} km` : "—"])))
      + sub(`Estações hidrometeorológicas em ${fmtNum(d.estacoes?.raioKm ?? 25, 0)} km — ${esc(d.estacoes?.estado || "—")}`, camada(d.estacoes, "estações") + dataTable(["Estação", "Tipo", "Rio", "Responsável", "Operando", "Dados", "Distância"], (d.estacoes?.itens || []).map((e: any) => [esc(e.nome || "—"), esc(e.tipo || "—"), esc(e.rio || "—"), esc(e.responsavel || "—"), esc(e.operando || "—"), esc(e.possuiDados || "—"), e.distanciaKm != null ? `${fmtNum(e.distanciaKm, 1)} km` : "—"])))
      + sub(`Outorgas federais em ${fmtNum(d.outorgasFederais?.raioKm ?? 25, 0)} km — ${esc(d.outorgasFederais?.estado || "—")}`, camada(d.outorgasFederais, "outorgas federais") + dataTable(["Empreendimento / requerente", "Finalidade", "Corpo hídrico", "Interferência", "Vencimento", "Volume anual (m³)", "Distância"], (d.outorgasFederais?.itens || []).map((o: any) => [esc(o.nome || "—"), esc(o.finalidade || "—"), esc(o.corpoHidrico || "—"), esc(o.interferencia || "—"), esc(o.vencimento || "—"), fmtNum(o.volumeAnualM3, 0), o.distanciaKm != null ? `${fmtNum(o.distanciaKm, 1)} km` : "—"])))));
  }
  const rg = pc.fontes.rigeo;
  if (rg) partes.push(sub("Documentos técnicos (RIGeo/SGB)", cab(rg) + dataTable(["Título", "Ano", "Tipo", "Assuntos", "Consulta", "Link"], (rg.data?.documentos || []).map((d: any) => [esc(d.titulo), esc(d.ano || "—"), esc(d.tipo || "—"), esc((d.assuntos || []).slice(0, 5).join(", ") || "—"), esc(d.consulta), d.url ? `<a href="${esc(d.url)}">${esc(d.url)}</a>` : "—"]))));
  if (!partes.length) return "";
  return section("Anexo — Pesquisa complementar (fontes públicas e Hub API)", `<p class="text">Consulta de ${esc(pc.consultadoEm ? fmtDate(pc.consultadoEm) : "—")} · ponto de referência ${fmtNum(pc.parametros?.lat, 5)}, ${fmtNum(pc.parametros?.lon, 5)} · substância ${val(pc.parametros?.substancia)} (perfil ${esc(pc.parametros?.grupo || "—")}). Listagens brutas: casamento por proximidade ou por texto, sem verificação de conteúdo.</p>` + partes.join(""));
}

function secFontesLimitacoes(a: any, c: any, parecer: ParecerRender): string {
  const p = c.iaRelatorioConsolidado;
  const removidos = [
    ...(p?.remocoes || []).map((x: any) => ({ item: x.texto || x.origem || "—", motivo: x.motivo })),
    ...(p?.errosRegistrados || []).map((x: any) => ({ item: x.campo || "campo rejeitado", motivo: x.motivo })),
    ...parecer.remocoes.map((x) => ({ item: x.texto || x.origem || "—", motivo: x.motivo })),
  ];
  const modulos = avaliarDisponibilidadeModulos(c);
  const componentes = avaliarComponentesMaturidade(a);
  const score = computeScoreCompletude(componentes);
  const nDisciplina = p?.versao === PARECER_VERSAO && Array.isArray(p.lacunasDisciplina) ? p.lacunasDisciplina.length : 0;
  const cobertura = metricaCobertura(score.presentes, score.total - score.presentes + nDisciplina);
  const tabela = dataTable(["Fonte", "Estado", "Cobertura / limitação"], modulos.map((m) => [
    esc(m.label), esc(m.estado === "ok" ? "consultada" : m.estado === "indisponivel" ? "indisponível" : "não consultada"),
    esc(m.meta?.janelaCobertura || m.motivo || "Período não coberto: não informado. Situação desconhecida."),
  ]));
  const remov = removidos.length ? dataTable(["Item removido / campo", "Motivo"], removidos.slice(0, 20).map((x: any) => [esc(String(x.item || "—").slice(0, 180)), esc(x.motivo || "sem lastro publicável")])) : para("Nenhum item removido pelo passo adversarial foi registrado.");
  return section("9. Fontes, cobertura temporal e limitações", kvTable([
    ["Score de completude", `${score.score}/100 — ${esc(score.formula)}`],
    ["T1/T2 vs lacunas", esc(cobertura.texto)],
  ]) + tabela + sub("Fontes e limitações desta análise — registro do passo adversarial", remov)
    + `<p class="scope">Dados de escala regional, quando apresentados, não substituem levantamento de detalhe. Ausência de registro vale somente na janela de cobertura indicada para cada fonte.</p>`);
}

function secRestrito(a: any, c: any): string {
  const itens: string[][] = [];
  const add = (origem: string, tipo: string, valor: any) => { if (valor) itens.push([esc(origem), esc(tipo), esc(String(valor))]); };
  const scm = (a as any).__scmData || {};
  if (scm.titularCpf) add("SCM/ANM", "CPF de titular", scm.titularCpf);
  const titular = c.anmTitular?.titular || c.anmTitular || {};
  if (titular.cpf) add("ANM", "CPF de titular", titular.cpf);
  [titular.telefone, titular.email].forEach((x, i) => add("ANM", i ? "E-mail" : "Telefone", x));
  add("ANM", "Endereço de pessoa física", titular.endereco || titular.address);
  add("Cadastro interno", "Telefone do ofertante", c.ofertanteTelefone);
  add("Cadastro interno", "E-mail do ofertante", c.ofertanteEmail);
  add("Cadastro interno", "Endereço de pessoa física", c.ofertanteEndereco);
  (c.ccirProprietarios || []).forEach((p: any) => { if (p.cpfCnpj && String(p.cpfCnpj).replace(/\D/g, "").length === 11) add("CCIR/INCRA", "CPF de proprietário", `${p.nome || "Pessoa física"} — ${p.cpfCnpj}`); });
  const contatos = c.iaDeepIntel?.contatos || c.iaEnrichment?.investigation?.contatos || [];
  contatos.forEach((x: any) => add(x.fonte || "Investigação", x.tipo || "Contato", x.valor));
  const inv = c.iaDeepIntel || c.iaEnrichment?.investigation || c.investigation;
  const visitarTextoT3 = (valor: any) => {
    if (typeof valor === "string") {
      extrairEnderecosTexto(valor).forEach((endereco) => add("Investigação T3", "Endereço em texto livre", endereco));
    } else if (Array.isArray(valor)) {
      valor.forEach(visitarTextoT3);
    } else if (valor && typeof valor === "object") {
      Object.values(valor).forEach(visitarTextoT3);
    }
  };
  visitarTextoT3(inv);
  if (!itens.length) return "";
  return `<section class="restricted"><h2>Anexo restrito — dados pessoais</h2><p class="warning">Dados pessoais de pessoa física, fora do corpo decisório. Tratamento: diligência pré-contratual e exercício regular de direitos (LGPD, art. 7º, V e VI); acesso deve ser limitado.</p>${dataTable(["Fonte", "Dado", "Valor"], itens)}</section>`;
}

// Monta um resumo textual compacto de todos os dados do ativo para a IA.
export function buildAssetDigest(asset: any): string {
  asset = anexarVigenciaCalculada(asset);
  const c = (asset.camposEspecificos || {}) as any;
  const strip = (obj: any, max = 4000): string => {
    try {
      const s = JSON.stringify(obj, (k, v) =>
        k.endsWith("UpdatedAt") || k === "ndviGrid" || k === "ccirRawData" || k === "__geometry" || k === "geometry"
          || (/(cpf)/i.test(k) && String(v ?? "").replace(/\D/g, "").length !== 14)
          || /(telefone|email|endereco|address|contato|celular|whatsapp)/i.test(k)
          || /^(contatos|proprietarios)$/i.test(k) ? undefined : v);
      return s.length > max ? s.slice(0, max) + "…" : s;
    } catch { return ""; }
  };
  const vigenciaAlvara = obterVigenciaCalculada(asset);
  const partes: string[] = [
    `ATIVO: ${asset.title} | tipo=${asset.type} | local=${[asset.location, asset.municipio, asset.estado].filter(Boolean).join("/")} | area_ha=${asset.areaHa ?? "N/D"} | preco=${asset.priceAsking ?? "N/D"}`,
    // descrição é campo livre e pode conter contato/endereço de PF; não é
    // insumo necessário para o catálogo determinístico e fica fora da IA.
    c.processoAnm ? `ANM: processo=${c.processoAnm} substancia=${c.substancia ?? ""} fase=${c.faseAnm ?? ""}` : "",
    (asset.type === "MINA" || c.processoAnm) ? formatarVigenciaParaPrompt(vigenciaAlvara) : "",
    (asset as any).__scmData ? `SCM_PROCESSO (campos cadastrais sem histórico de vigência): ${strip((() => {
      const scm = (asset as any).__scmData || {};
      return {
        fase: scm.fase,
        titularNome: scm.titularNome,
        titularCnpj: scm.titularCnpj,
        tipoPessoa: scm.tipoPessoa,
        uf: scm.uf,
        areaHa: scm.areaHa,
        nup: scm.nup,
        statusAtivo: scm.statusAtivo,
        consultadoEm: scm.consultadoEm,
      };
    })(), 1500)}` : "",
    c.anmTitular ? `ANM_TITULAR: ${strip(c.anmTitular, 2000)}` : "",
    c.anmGeologia ? `GEOLOGIA: ${strip(c.anmGeologia, 2500)}` : "",
    c.anmRecursos ? `OCORRENCIAS_PROXIMAS: ${strip(c.anmRecursos, 2000)}` : "",
    c.anmFunai ? `FUNAI: ${strip(c.anmFunai, 1200)}` : "",
    c.anmRestricoes ? `RESTRICOES_AMBIENTAIS_FUNDIARIAS (semaforo=${c.anmRestricoes.semaforo ?? "?"}; camadas nao consultadas nao significam ausencia de restricao): ${strip(c.anmRestricoes, 2500)}` : "",
    (() => {
      // Quadro determinístico de camadas — mesma fonte da injeção de riscos na
      // renderização; a IA recebe a regra de nunca omitir camada com ocorrência.
      if (!c.anmRestricoes && !c.anmFunai && !c.anmFunaiTerras) return "";
      const quadro = montarQuadroCamadas(c);
      const linhas = quadro.linhas.map((l) => ({ camada: l.label, status: l.status, ...(l.destaque ? { destaque: l.destaque } : {}) }));
      return `QUADRO_RESTRICOES (REGRA OBRIGATORIA: toda camada com ocorrencia > 0 ou SOBREPOSICAO DIRETA deve aparecer em "riscos" com o nome da ocorrencia e a distancia; camadas sem ocorrencia podem ir em "pontosFortes"): ${strip(linhas, 2200)}`;
    })(),
    (() => {
      // TAH ambígua (vínculo só por número-base) não alimenta a IA
      const vinculo = filtrarTahPorProcesso(c.anmTah, c.processoAnm);
      return !vinculo.ambiguo && vinculo.rows.length > 0 ? `TAH: ${strip(vinculo.rows, 2000)}` : "";
    })(),
    (asset.type === "MINA" || c.processoAnm)
      ? `ESCOPO_BASES (toda conclusao negativa sobre TAH/CFEM/multa/cessao DEVE citar estas bases e periodos; nao generalizar alem delas): ${montarNotaEscopoBases((asset as any).__escopoBases || null)}`
      : "",
    c.anmCfem ? `CFEM_PRODUCAO_REAL (recolhimento de CFEM = producao comercializada; processo que nunca recolheu nunca produziu): ${strip(c.anmCfem, 3000)}` : "",
    (() => {
      // barragens casadas so por nome do empreendedor ficam FORA dos insumos
      if (!c.anmBarragens) return "";
      const { confirmadas, naoConfirmadas } = separarBarragensTitular(c.anmBarragens);
      const payload = { ...c.anmBarragens, doTitular: confirmadas };
      const nota = naoConfirmadas.length > 0
        ? ` [${naoConfirmadas.length} barragem(ns) casada(s) so por nome do empreendedor excluida(s) — vinculacao nao confirmada]`
        : "";
      return `BARRAGENS_SIGBM (barragens do titular e proximas, com categoria de risco e dano potencial)${nota}: ${strip(payload, 2500)}`;
    })(),
    (() => {
      if (!c.anmCertidoesTitular) return "";
      const aviso = avisoCertidoesVinculo(c.anmCertidoesTitular);
      const marca = aviso ? ` ATENCAO — VINCULACAO NAO CONFIRMADA POR DOCUMENTO: ${aviso} NAO tratar como fato do titular;` : "";
      return `CERTIDOES_TITULAR (PGFN divida ativa, CNJ processos, CEIS sancoes;${marca}): ${strip(c.anmCertidoesTitular, 2000)}`;
    })(),
    c.anmSondagem ? `SONDAGENS_CPRM_PROXIMAS: ${strip(c.anmSondagem, 2000)}` : "",
    c.anmGeoquimica ? `GEOQUIMICA_CPRM: ${strip(c.anmGeoquimica, 1500)}` : "",
    c.anmLogistica ? `LOGISTICA (ferrovia, porto e linha de transmissao mais proximos; fonte nao consultada nao significa ausencia): ${strip(c.anmLogistica, 1500)}` : "",
    (() => {
      // Pesquisa complementar: só resumos por fonte (estado + contagens); as
      // listagens ficam no anexo. Fonte indisponivel nao e ausencia de registro.
      const pc = c.anmPesquisaComplementar;
      if (!pc?.fontes) return "";
      const resumo = Object.values(pc.fontes as Record<string, any>).map((f: any) => ({
        fonte: f.label, vinculo: f.vinculo, estado: f.estado, total: f.total ?? null, raioKm: f.raioKm ?? null, motivo: f.motivo || undefined,
        ...(f.id === "processosVizinhos" ? { mesmaSubstancia: f.data?.totalMesmaSubstancia, porFase: f.data?.porFase } : {}),
        ...(f.id === "afloramentos" ? { topRochas: f.data?.topRochas } : {}),
        ...(f.id === "litoDetalhada" ? { unidades: f.data?.unidades } : {}),
        ...(f.id === "sgbContexto" ? { bacias: f.data?.bacias } : {}),
        ...(f.id === "recursosHidricos" ? { cursos: (f.data?.cursosDagua?.itens || []).slice(0, 3), outorgasFederais: f.data?.outorgasFederais?.total } : {}),
        ...(f.id === "rigeo" ? { documentos: (f.data?.documentos || []).slice(0, 6).map((d: any) => ({ titulo: d.titulo, ano: d.ano, casaSubstancia: d.casaSubstancia })) } : {}),
      }));
      return `PESQUISA_COMPLEMENTAR (vizinhanca/regional/documental; proximidade NAO comprova mineralizacao, disponibilidade hidrica, outorga, conexao ou acesso; estado=indisponivel NAO e ausencia de registro): ${strip(resumo, 3000)}`;
    })(),
    c.sigefParcelas ? `SIGEF_PARCELAS (propriedades certificadas sobre o processo; se totalSobrepostas=0 nao ha registro de georreferenciamento certificado para o poligono consultado — sinal de informalidade fundiaria): ${strip(c.sigefParcelas, 2500)}` : "",
    c.carImoveis ? `CAR_IMOVEIS (imoveis CAR/SICAR sobre o poligono do processo, com % de sobreposicao — indica ocupantes/posseiros declarados alem das parcelas certificadas): ${strip(c.carImoveis, 2500)}` : "",
    c.ccirImoveis ? `CCIR_IMOVEIS (base fundiaria consolidada por imovel identificado sobre o processo: codigo INCRA, denominacao, detentores SNCR, situacao, area): ${strip(c.ccirImoveis, 2500)}` : "",
    asset.geoScore != null ? `GEO: score=${asset.geoScore} altMed=${asset.geoAltMed} declividade=${asset.geoDeclivityMed} rio=${asset.geoTemRio} energia=${asset.geoTemEnergia}` : "",
    c.ccirCodigoIncra ? `CCIR: incra=${c.ccirCodigoIncra} denominacao=${c.ccirDenominacao ?? ""} area=${c.ccirAreaTotalIncra ?? ""} proprietarios=${strip(c.ccirProprietarios, 800)}` : "",
    c.embrapa ? `EMBRAPA: ${strip(c.embrapa, 1500)}` : "",
    c.ambiental ? `AMBIENTAL: ${strip(c.ambiental, 1500)}` : "",
    // Saídas de IA e busca web (investigação profunda, enriquecimento, análises
    // e pricing antigos) NÃO entram nos insumos do parecer: são material T3/T4
    // — não verificado em fonte oficial — e vão para o anexo/hipóteses na
    // renderização, nunca para o corpo. (A Due Diligence de IA foi removida a
    // pedido do usuário; dados antigos são inertes.)
  ];
  return partes.filter(Boolean).join("\n");
}

export function buildAssetReportHtml(asset: any): string {
  asset = anexarVigenciaCalculada(asset);
  const c = (asset.camposEspecificos || {}) as any;
  const attrs = (asset.attributesJson || {}) as any;
  const vigenciaAlvara = obterVigenciaCalculada(asset);
  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const geometry = (asset as any).__reportGeometry || null;
  const mapSection = geometry
    ? `<section style="page-break-inside: avoid;"><h2>Mapa do Polígono</h2><div id="map"></div><p class="text" style="color:#6b7f7c;font-size:9px;">Polígono ${esc(asset.type === "MINA" ? "do processo minerário (SIGMINE/ANM)" : "da propriedade")} sobre base OpenStreetMap.</p></section>`
    : "";
  const mapCss = geometry ? `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>` : "";
  const mapScript = geometry ? `
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  window.__mapReady = false;
  try {
    var map = L.map('map', { zoomControl: false, attributionControl: false, preferCanvas: true });
    var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 17 });
    tiles.addTo(map);
    var layer = L.geoJSON(${JSON.stringify(geometry)}, { style: { color: '#b45309', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.25 } }).addTo(map);
    map.fitBounds(layer.getBounds().pad(0.35));
    var done = function(){ window.__mapReady = true; };
    tiles.on('load', done);
    setTimeout(done, 8000); // fallback se algum tile falhar
  } catch (e) { window.__mapReady = true; }
</script>` : "";

  // Corpo: só evidência T1/T2 e derivadas reproduzíveis, na ordem em que uma
  // decisão de capital é tomada. As listagens brutas permanecem auditáveis nos
  // anexos, com uma cópia sanitizada para que PF nunca escape do bloco restrito.
  const cAnexo = JSON.parse(JSON.stringify(c, (key, value) => {
    if (/(cpf)/i.test(key) && String(value ?? "").replace(/\D/g, "").length !== 14) return undefined;
    if (/(telefone|email|endereco|address|contato|celular|whatsapp)/i.test(key)) return undefined;
    return typeof value === "string" ? limparTextoPessoal(value) : value;
  }));
  if (cAnexo.anmTitular?.titular) delete cAnexo.anmTitular.titular.cpf;
  if (cAnexo.anmTitular) delete cAnexo.anmTitular.cpf;
  if (Array.isArray(cAnexo.ccirProprietarios)) cAnexo.ccirProprietarios = cAnexo.ccirProprietarios.map((p: any) =>
    String(p.cpfCnpj || "").replace(/\D/g, "").length === 11 ? { ...p, cpfCnpj: "dado pessoal no anexo restrito" } : p);
  const anexoAsset = { ...asset, __scmData: { ...((asset as any).__scmData || {}), titularCpf: undefined } };
  const parecer = prepararParecerRender(asset, c);
  const escopoVigencia = (html: string): string => html ? `<div data-vigencia-validar="true">${html}</div>` : "";
  const corpo = [
    secMaturidadeDecisoria(asset, c),
    escopoVigencia(secParecerDecisorio(parecer)),
    escopoVigencia(secSituacaoProcessual(asset, c)),
    secContraparte(asset, c),
    secFundiarioSocioambiental(c),
    secEvidenciasJazida(asset, c, geometry),
    secInfraestruturaContexto(asset, c),
    escopoVigencia(secRiscosDecisorios(parecer)),
    secFontesLimitacoes(asset, c, parecer),
  ].filter(Boolean).join("\n");
  const anexos = [
    `<div class="annex-break"><h1>Anexos e evidências brutas</h1><p class="text">As listagens completas abaixo não integram o corpo decisório. Material T3 é rotulado como não verificado; hipóteses não são fatos.</p></div>`,
    mapSection,
    escopoVigencia(secAnm(anexoAsset, cAnexo, attrs)),
    secSigef(cAnexo),
    secCarImoveis(cAnexo),
    secCcirImoveis(cAnexo),
    secCcir(cAnexo),
    secGeo(anexoAsset),
    secEmbrapa(cAnexo),
    secAmbiental(cAnexo),
    secSicor(cAnexo),
    secAnexoPesquisaComplementar(cAnexo),
    escopoVigencia(secIa(cAnexo, vigenciaAlvara)),
    secAnexoContraparteT3(cAnexo),
    escopoVigencia(secHipoteses(cAnexo, vigenciaAlvara)),
    escopoVigencia(secHipotesesLegadas(cAnexo, vigenciaAlvara)),
    secAnexoAuditoriaParecer(parecer),
    secRestrito(asset, c),
  ].filter(Boolean).join("\n");
  const sections = corpo + anexos;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
${mapCss}
<style>
  * { box-sizing: border-box; }
  body { font-family: "DejaVu Sans", "Helvetica Neue", Arial, sans-serif; font-size: 10px; color: #1a2b2a; margin: 0; }
  .cover { background: #042f2e; color: #fff; padding: 26px 32px; }
  .cover .brand { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #7dd3c8; }
  .cover h1 { font-size: 22px; margin: 8px 0 4px; }
  .cover .meta { color: #b8dcd6; font-size: 10px; }
  main { padding: 18px 32px; }
  section { margin-bottom: 18px; page-break-inside: auto; }
  h2 { font-size: 13px; color: #042f2e; border-bottom: 2px solid #042f2e; padding-bottom: 4px; margin: 0 0 8px; page-break-after: avoid; }
  h3 { font-size: 11px; color: #0f5d58; margin: 12px 0 4px; page-break-after: avoid; }
  .sub { margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  table.kv th { text-align: left; width: 32%; font-weight: 600; color: #4b5f5d; padding: 3px 8px 3px 0; vertical-align: top; border-bottom: 1px solid #e4ecea; }
  table.kv td { padding: 3px 0; border-bottom: 1px solid #e4ecea; }
  table.data th { background: #eef5f4; color: #042f2e; text-align: left; padding: 4px 6px; font-size: 9px; border: 1px solid #d5e3e0; }
  table.data td { padding: 3px 6px; border: 1px solid #e4ecea; vertical-align: top; }
  table.data tr:nth-child(even) td { background: #f7fbfa; }
  tr { page-break-inside: avoid; }
  .text { white-space: normal; line-height: 1.45; margin: 4px 0; }
  #map { width: 100%; height: 420px; border: 1px solid #d5e3e0; }
  ul.lista, ol.lista { margin: 4px 0 4px 16px; padding: 0; }
  ul.lista li, ol.lista li { margin-bottom: 3px; line-height: 1.4; }
   .citation { color: #4b5f5d; font-size: 8px; white-space: nowrap; }
   .scope { color: #526966; font-size: 8px; line-height: 1.35; margin: 5px 0; }
   .missing, .warning { color: #92400e; }
   .restricted { page-break-before: always; border: 2px solid #92400e; padding: 12px; background: #fffaf0; }
   .annex-break { page-break-before: always; padding-top: 8px; }
</style></head>
<body>
  <div class="cover">
    <div class="brand">Mavrion Connect</div>
    <h1>${esc(asset.title || "Ativo")}</h1>
    <div class="meta">${esc(TIPO_LABEL[asset.type] || asset.type || "")} · Relatório gerado em ${esc(geradoEm)}</div>
  </div>
  <main>${sections}</main>
${mapScript}
</body></html>`;
}

// Insumo canônico do parecer consolidado: é EXATAMENTE esta string que vai ao
// modelo e é ela que é hasheada para o cache — qualquer mudança nela invalida
// o cache. (A Due Diligence de IA foi removida a pedido do usuário; dados
// antigos iaDueDiligence são inertes e NÃO entram no insumo.)
export function buildConsolidatedInsumos(asset: any): string {
  return buildAssetDigest(asset);
}
// Blindagem da geração do parecer (falha real observada em produção em
// 14/08/2026: o teto de 1500 tokens truncava o JSON no meio de uma string →
// "Unterminated string in JSON at position ~5000" → parecer null → PDF só com
// a nota de indisponibilidade):
// - teto inicial maior e dobrado quando finish_reason=length (truncamento);
// - retry com backoff curto para erros transitórios (429/5xx/timeout/rede);
// - timeout explícito por tentativa (o default do SDK é 10 min — uma chamada
//   pendurada seguraria a exportação inteira);
// - logs com status/código HTTP, finish_reason e forma do JSON (antes só
//   e.message, sem contexto para diagnóstico).
// Contrato preservado: QUALQUER falha ⇒ null ⇒ PDF sai com a nota explícita e
// nada é persistido.
const PARECER_MAX_TOKENS_INICIAL = 4000;
const PARECER_MAX_TOKENS_TETO = 16000;
const PARECER_TIMEOUT_MS = 120_000;
const PARECER_TENTATIVAS = 3;

export async function generateConsolidatedAnalysis(asset: any): Promise<ParecerConsolidado | null> {
  try {
    asset = anexarVigenciaCalculada(asset);
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: PARECER_TIMEOUT_MS,
      maxRetries: 0, // o retry é o loop abaixo, com log por tentativa
    });
    const insumos = buildConsolidatedInsumos(asset);
    const insumosHash = hashInsumos(insumos);
    // Disciplina de certeza: o modelo NÃO narra — preenche campos citando
    // fatos do catálogo determinístico. Sem fatos, não há o que citar.
    const { fatos } = montarCatalogoFatos(asset);
    if (fatos.length === 0) {
      console.error("[Relatório] Parecer v3: catálogo de fatos vazio (nenhum dado com fonte+data+identificador) — parecer não gerado");
      return null;
    }
    const fatosParaModelo = fatos.filter((f) => !/^Eventos? do processo/i.test(f.campo));
    const catalogo = formatarCatalogoParaPrompt(fatosParaModelo);
    const fatosPorId = new Map(fatos.map((f) => [f.id, f]));
    const tipos = formatarTiposParaPrompt();
    let maxTokens = PARECER_MAX_TOKENS_INICIAL;
    // Reprocesso limitado por vocabulário proibido: UMA rodada de feedback;
    // persistindo, os itens são descartados e viram lacunas declaradas
    // (nunca reescritos aqui — a remontagem legítima é refazer o template).
    let feedbackVocab: ViolacaoVocabulario[] | null = null;
    for (let tentativa = 1; tentativa <= PARECER_TENTATIVAS; tentativa++) {
      const ultima = tentativa === PARECER_TENTATIVAS;
      try {
        const resp = await chamarParecerIa(openai, insumos, catalogo, tipos, maxTokens, feedbackVocab);
        const choice = resp.choices[0];
        const finish = choice?.finish_reason;
        const content = choice?.message?.content || "";
        if (finish === "length") {
          // truncou no teto de tokens — a causa real do JSON inválido
          console.error(`[Relatório] Parecer consolidado truncado (finish_reason=length, teto=${maxTokens} tokens, tentativa ${tentativa}/${PARECER_TENTATIVAS})`);
          if (ultima) return null;
          maxTokens = Math.min(maxTokens * 2, PARECER_MAX_TOKENS_TETO);
          continue;
        }
        if (finish !== "stop") {
          // content_filter etc.: repetir não muda o resultado
          console.error(`[Relatório] Parecer consolidado com finish_reason inesperado: ${finish ?? "ausente"} (tentativa ${tentativa}/${PARECER_TENTATIVAS})`);
          return null;
        }
        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch (e: any) {
          console.error(`[Relatório] Parecer consolidado: JSON inválido apesar de finish_reason=stop (${e?.message}; ${content.length} chars; tentativa ${tentativa}/${PARECER_TENTATIVAS})`);
          if (ultima) return null;
          continue;
        }
        const temCampos = ["prioridades", "riscos", "encaminhamentos", "hipoteses"].some((k) => Array.isArray(parsed?.[k]));
        if (!temCampos) {
          console.error(`[Relatório] Parecer v3: JSON válido sem campos estruturados (chaves: ${Object.keys(parsed || {}).join(", ") || "nenhuma"}; tentativa ${tentativa}/${PARECER_TENTATIVAS})`);
          if (ultima) return null;
          continue;
        }
        // Validação: item sem fato válido citado = erro registrado (nunca
        // null silencioso); vocabulário proibido = violação com reprocesso.
        const validado = validarParecerEstruturado(parsed, fatos);
        if (validado.violacoes.length > 0 && feedbackVocab === null && !ultima) {
          feedbackVocab = validado.violacoes;
          console.error(`[Relatório] Parecer v3: vocabulário proibido em ${validado.violacoes.length} item(ns) — um reprocesso limitado com feedback`);
          continue;
        }
        // Vocabulário persistente após o reprocesso ⇒ rebaixamento a lacuna
        // declarada (o enunciado NÃO é publicado nem reescrito).
        const lacunasDisciplina = validado.violacoes.map((v) => ({
          campo: v.campo,
          motivo: `vocabulário proibido persistente após reprocesso (${v.termos.join(", ")}) — enunciado descartado: "${v.texto.slice(0, 140)}"`,
        }));
        // Montagem por template + conversão dos itens validados em DERIVADOS
        const sintese = montarSintese(fatos);
        const prioridades = validado.prioridades.map((i) => itemParaEnunciado(i, "prioridade", fatosPorId));
        const riscosSelecionados = validado.riscos;
        const riscosDeterministicos = montarRiscosDeterministicos(fatos);
        const riscosItens = [...riscosSelecionados, ...riscosDeterministicos].filter((item, i, todos) =>
          todos.findIndex((x) => x.tipo === item.tipo && x.fatos.join(",") === item.fatos.join(",")) === i);
        const riscos = riscosItens.map((i) => itemParaEnunciado(i, "risco", fatosPorId));
        const encaminhamentos = validado.encaminhamentos.map((i) => itemParaEnunciado(i, "encaminhamento", fatosPorId));
        // Passo adversarial pós-montagem: SÓ REMOVE (fonte+data? identificador?
        // contradição? vocabulário? conferível?); remoções ficam registradas.
        const { mantidas, remocoes } = passoAdversarial(
          [...sintese, ...prioridades, ...riscos, ...encaminhamentos],
          montarContradicoes(asset),
        );
        const porOrigem = (o: string) => mantidas.filter((e) => e.origem === o);
        if (tentativa > 1) {
          console.log(`[Relatório] Parecer consolidado recuperado na tentativa ${tentativa}/${PARECER_TENTATIVAS}`);
        }
        return {
          versao: PARECER_VERSAO,
          insumosHash,
          geradoEm: new Date().toISOString(),
          modelo: "gpt-5.4",
          sintese: porOrigem("sintese"),
          prioridades: porOrigem("prioridade"),
          riscos: porOrigem("risco"),
          encaminhamentos: porOrigem("encaminhamento"),
          hipoteses: validado.hipoteses,
          fatos,
          errosRegistrados: validado.erros,
          lacunasDisciplina,
          remocoes,
        };
      } catch (e: any) {
        const status = e?.status ?? e?.response?.status;
        const code = e?.code ?? e?.error?.code;
        console.error(`[Relatório] Falha ao gerar parecer consolidado (IA): ${e?.message} (status=${status ?? "sem status"}, code=${code ?? "sem código"}, tipo=${e?.name || typeof e}, tentativa ${tentativa}/${PARECER_TENTATIVAS})`);
        // transitório: limite de requisições (429), 5xx do provedor, timeout/erro de rede (sem status HTTP)
        const transitorio = status === 429 || (typeof status === "number" && status >= 500) || status == null;
        if (!transitorio || ultima) return null;
        await new Promise((r) => setTimeout(r, 1000 * tentativa)); // backoff curto: 1s, 2s
      }
    }
    return null;
  } catch (e: any) {
    // falha fora do loop (import do SDK, chave ausente, montagem dos insumos): mesmo contrato falha⇒null
    console.error("[Relatório] Falha ao gerar parecer consolidado (IA):", e?.message || e);
    return null;
  }
}

// Chamada isolada só para o loop acima ficar legível. gpt-5.4 usa
// max_completion_tokens (rejeita max_tokens) — não trocar.
function chamarParecerIa(
  openai: any,
  insumos: string,
  catalogo: string,
  tipos: string,
  maxTokens: number,
  feedbackVocab: ViolacaoVocabulario[] | null,
) {
  const feedback = feedbackVocab && feedbackVocab.length > 0
    ? `\nATENÇÃO — REPROCESSO: os itens abaixo foram rejeitados por vocabulário proibido. Reenvie o JSON completo apenas com o que os fatos citados sustentam diretamente, sem os termos proibidos — ou omita o item:\n${feedbackVocab.map((v) => `- [${v.campo}] "${v.texto.slice(0, 200)}" (termos proibidos: ${v.termos.join(", ")})`).join("\n")}`
    : "";
  return openai.chat.completions.create({
      model: "gpt-5.4",
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_completion_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: `Você abastece um relatório estruturado de deal origination em mineração e terras no Brasil (Mavrion Connect). Você NÃO escreve o relatório e NÃO envia texto publicável para prioridades, riscos ou encaminhamentos: você SOMENTE seleciona um "tipo" do catálogo fixo de templates e os IDs de fatos que satisfazem a regra daquele tipo. A prosa do corpo é montada localmente por template determinístico, exclusivamente com o texto fixo do tipo e os valores dos fatos.
${secaoDataAtual()}
DISCIPLINA DE CERTEZA (obrigatória):
1. Cada item de prioridades/riscos/encaminhamentos é EXATAMENTE {"tipo":"um_tipo_listado","fatos":["F1"]}. Não inclua a chave "texto"; qualquer texto livre é descartado e nunca publicado.
2. Todo item cita em "fatos" os IDs do catálogo que satisfazem a regra do "tipo". Tipo inexistente, fato inexistente ou fatos que não satisfazem a regra são rejeitados e registrados como erro.
3. PROIBIDO usar: possivelmente, provavelmente, aparentemente, sugere-se, pode indicar, tudo indica, não se descarta, estima-se, acredita-se, é razoável supor, em tese, a princípio, tende a, costuma, geralmente, via de regra, espera-se.
4. Não invente números, datas ou nomes fora do catálogo. Não escolha entre valores divergentes de fontes diferentes.
5. O que não se enquadra como afirmação lastreada vai em "hipoteses" (com o motivo), nunca nos outros campos.
6. Publicar menos é melhor: listas curtas. Campos podem ficar vazios — campo vazio não gera frase.
CATÁLOGO DE TIPOS PUBLICÁVEIS (use somente estes nomes e respeite a condição indicada):
${tipos}
Responda em JSON:
{"prioridades":[{"tipo":"verificar_na_fonte","fatos":["F1"]}],"riscos":[{"tipo":"restricao_socioambiental","fatos":["F2"]}],"encaminhamentos":[{"tipo":"consultar_fonte_primaria","fatos":["F3"]}],"hipoteses":[{"texto":"…","motivo":"por que não é verificável com o catálogo"}]}${feedback}`,
        },
        { role: "user", content: `CATÁLOGO DE FATOS (única base citável — cite pelos IDs):\n${catalogo}\n\nCONTEXTO COMPLETO (somente para entendimento; afirmações citáveis SÓ do catálogo):\n${insumos}` },
      ],
    });
}

// Limite de renderizações simultâneas — cada uma sobe um Chromium inteiro.
// Sem isso, requisições concorrentes derrubam o servidor por CPU/RAM.
const MAX_CONCURRENT = 2;
const MAX_QUEUE = 8;
let running = 0;
const waiting: Array<() => void> = [];

export class ReportBusyError extends Error {
  constructor() { super("Servidor ocupado gerando outros relatórios. Tente novamente em instantes."); }
}

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) { running++; return; }
  if (waiting.length >= MAX_QUEUE) throw new ReportBusyError();
  await new Promise<void>(resolve => waiting.push(resolve));
  running++;
}

function releaseSlot(): void {
  running--;
  const next = waiting.shift();
  if (next) next();
}

const RENDER_TIMEOUT_MS = 60000;

export async function renderAssetReportPdf(asset: any): Promise<Buffer> {
  await acquireSlot();
  try {
    // O slot só é liberado quando doRender realmente terminar (sucesso, erro
    // ou timeout). O timeout fecha o browser à força, o que faz as operações
    // pendentes do puppeteer rejeitarem — sem Chromium órfão consumindo CPU.
    return await doRender(anexarVigenciaCalculada(asset));
  } finally {
    releaseSlot();
  }
}

async function doRender(asset: any): Promise<Buffer> {
  const html = buildAssetReportHtml(asset);
  const executablePath = chromiumPath();
  const puppeteer = (await import("puppeteer")).default;
  // --no-sandbox: o app roda como root no VPS (pm2) e o sandbox do Chromium
  // não inicializa como root; o HTML renderizado é gerado localmente (tudo
  // escapado, sem recursos externos), o que limita a exposição.
  const browser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    browser.close().catch(() => {});
  }, RENDER_TIMEOUT_MS);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    if ((asset as any).__reportGeometry) {
      // espera os tiles do mapa carregarem (o script marca __mapReady)
      await page.waitForFunction("window.__mapReady === true", { timeout: 12000 }).catch(() => {});
    }
    const textoPublicavel = await page.evaluate(() => {
      const copia = document.body.cloneNode(true) as HTMLElement;
      copia.querySelectorAll("[data-vigencia-memoria], [data-vigencia-historico]").forEach((el) => el.remove());
      return Array.from(copia.querySelectorAll("[data-vigencia-validar]"))
        .map((el) => (el as HTMLElement).innerText)
        .join("\n");
    });
    validarConsistenciaVigenciaTexto(
      textoPublicavel,
      obterVigenciaCalculada(asset),
      { escopoMinerario: true },
    );
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "14mm", left: "0mm", right: "0mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#6b7f7c;padding:0 32px;display:flex;justify-content:space-between;">
        <span>Mavrion Connect — Relatório de Ativo</span>
        <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
      </div>`,
    });
    return Buffer.from(pdf);
  } catch (e: any) {
    if (timedOut) throw new Error("Tempo limite ao gerar o relatório");
    throw e;
  } finally {
    clearTimeout(killTimer);
    await browser.close().catch(() => {});
  }
}

function secCcirImoveis(c: any): string {
  const s = c.ccirImoveis;
  if (!s || !Array.isArray(s.imoveis) || s.imoveis.length === 0) return "";
  let body = kvTable([
    ["Imóveis identificados", fmtNum(s.totalImoveis, 0)],
    ["Com código INCRA (SNCR)", fmtNum(s.comCodigoIncra, 0)],
    ["Com detentor identificado", fmtNum(s.comDetentor, 0)],
    ["Fonte", val(s.fonte)],
    ["Consultado em", fmtDate(s.consultadoEm)],
  ]);
  body += sub("Imóveis (base fundiária consolidada)", dataTable(
    ["Código INCRA", "Código CAR", "Denominação", "Detentores", "Área (ha)", "Sobreposição", "Situação", "Composição"],
    s.imoveis.map((i: any) => [
      esc(i.codigoIncra || "—"), esc(i.codigoCar || "—"), esc(i.denominacao || "—"),
      esc(Array.isArray(i.detentores) && i.detentores.length > 0 ? i.detentores.join("; ") : "—"),
      fmtNum(i.areaHa), formatSobreposicao(i.sobreposicaoHa, i.sobreposicaoPct, i.sobreposicaoAVerificar),
      esc(i.situacao || "—"), esc(rotuloOrigemImovel(i)),
    ]))
    + `<p class="text" style="color:#6b7f7c;font-size:9px;">${esc(NOTA_METODOLOGIA_CONSOLIDACAO)}</p>`);
  if (s.observacao) body += para(s.observacao);
  return section("CCIR / Base Fundiária por Imóvel", body);
}

export function hashConsolidatedInsumos(asset: any): string {
  return hashInsumos(buildConsolidatedInsumos(asset));
}
