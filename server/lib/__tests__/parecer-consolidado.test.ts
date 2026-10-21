// Testes do parecer consolidado v3 (fluxo "extrair, não narrar"):
// catálogo determinístico de fatos, exclusão de grandezas em conflito,
// seleção de tipos+fatos, prosa exclusivamente por template e
// contradições estruturadas.
// Rodar com: npx tsx server/lib/__tests__/parecer-consolidado.test.ts
import assert from "node:assert";
import {
  montarCatalogoFatos,
  montarGrandezasProcesso,
  formatarCatalogoParaPrompt,
  formatarTiposParaPrompt,
  validarParecerEstruturado,
  montarSintese,
  itemParaEnunciado,
  reconstruirEnunciadoPersistido,
  montarRiscosDeterministicos,
  montarContradicoes,
  PARECER_VERSAO,
  type FatoCatalogado,
} from "../parecer-consolidado";
import { destinoEnunciado, detectarConflitos } from "../enunciados";
import { ativoMinaSintetico } from "./fixtures/ativo-mina-sintetico";

assert.equal(PARECER_VERSAO, 3);

// ── 1. Catálogo de fatos do ativo sintético: disciplina > cobertura ──
const asset = ativoMinaSintetico();
const { fatos, conflitos } = montarCatalogoFatos(asset);
assert.ok(fatos.length >= 4, `catálogo não-vazio (${fatos.length} fatos)`);
assert.equal(conflitos.length, 0, "fontes únicas por grandeza ⇒ sem conflito");

for (const f of fatos) {
  assert.ok(f.valor.trim().length > 0, `${f.id} com valor`);
  assert.ok(f.fonte.trim().length > 0, `${f.id} com fonte`);
  assert.ok(f.dataConsulta.trim().length > 0, `${f.id} com data da consulta`);
  assert.ok(f.identificador.trim().length > 0, `${f.id} com identificador de vínculo`);
  assert.ok(f.tier === "T1" || f.tier === "T2", "catálogo só aceita T1/T2");
}
// ids sequenciais F1..Fn
fatos.forEach((f, i) => assert.equal(f.id, `F${i + 1}`));

// cadastro sem createdAt ⇒ fatos de cadastro NÃO entram (sem data de consulta)
assert.ok(!fatos.some((f) => f.campo === "Título do ativo"), "fato sem data rastreável fica fora");
// SCM preenche o processo com T1
const fase = fatos.find((f) => f.campo === "Fase");
assert.ok(fase && /SCM/i.test(fase.fonte) && fase.tier === "T1");
// evento falso filtrado ⇒ sem fato de eventos
assert.ok(!fatos.some((f) => f.campo.startsWith("Eventos do processo")));
// TAH ambígua (processo sem ano) ⇒ sem fato de TAH
assert.ok(!fatos.some((f) => f.campo === "TAH do processo"));
// DOU indisponível ⇒ sem fato de DOU
assert.ok(!fatos.some((f) => f.campo.startsWith("Publicações no DOU")));
// fundiário consultado entra com T1
assert.ok(fatos.some((f) => f.campo === "SIGEF — parcelas certificadas"));
assert.ok(fatos.some((f) => f.campo === "CAR — imóveis declarados"));

// data-base/período de cobertura não pode ser publicado como data de consulta
const legadoSemConsulta = ativoMinaSintetico({
  processoAnm: "861261/2021",
  anmHistorico: {
    dataBase: "2026-08-19",
    eventos: [
      { data: "13/09/2021", descricao: "ALVARÁ DE PESQUISA PUBLICADO — prazo 3 anos" },
      { data: "20/10/2021", descricao: "VENCIMENTO DO ALVARÁ ALTERADO PARA 01/10/2024 PELA RESOLUÇÃO ANM 76/2021" },
      { data: "28/04/2025", descricao: "PRORROGAÇÃO DO ALVARÁ DE PESQUISA PUBLICADA — prazo 3 anos" },
    ],
  },
});
legadoSemConsulta.__scmData = { ...legadoSemConsulta.__scmData, consultadoEm: null };
const fatosLegados = montarCatalogoFatos(legadoSemConsulta).fatos;
assert.ok(!fatosLegados.some((f) => f.campo === "Validade"), "dataBase não se passa por data de consulta T1");
assert.ok(!fatosLegados.some((f) => f.campo === "Memória de cálculo da vigência"), "memória sem consulta real fica fora do catálogo T1");

// formato do prompt: uma linha por fato com fonte e consulta
const promptCat = formatarCatalogoParaPrompt(fatos);
assert.ok(promptCat.includes("F1 | ") && promptCat.includes("| fonte: ") && promptCat.includes("| consulta: "));
const promptTipos = formatarTiposParaPrompt();
assert.match(promptTipos, /prioridades:/);
assert.match(promptTipos, /fase_sem_titulo_de_lavra/);
assert.match(promptTipos, /consultar_fonte_primaria/);

// ── 2. Grandeza em conflito NÃO vira fato (ambos os valores exibidos) ──
const assetConflito = ativoMinaSintetico({
  anmLiveData: { features: [{ attributes: { AREA_HA: 62.15, NOME: "OUTRA EMPRESA S.A." } }] },
  anmLiveDataUpdatedAt: "2026-08-05T00:00:00Z",
});
const gr = montarGrandezasProcesso(assetConflito, assetConflito.camposEspecificos, assetConflito.__scmData);
const confl = detectarConflitos(gr);
assert.ok(confl.some((c) => c.grandeza === "Área do processo (ha)"), "área SCM×SIGMINE divergente detectada");
assert.ok(confl.some((c) => c.grandeza === "Titular"), "titular SCM×SIGMINE divergente detectado");
for (const cf of confl) {
  assert.ok(cf.valores.length >= 2, "conflito exibe AMBOS os valores");
}
const catConfl = montarCatalogoFatos(assetConflito);
assert.ok(catConfl.conflitos.length >= 2);
assert.ok(!catConfl.fatos.some((f) => f.campo === "Área (ha)"), "área conflitada fora do catálogo");
assert.ok(!catConfl.fatos.some((f) => f.campo === "Titular"), "titular conflitado fora do catálogo");

// ── 3. Validação da saída estruturada do modelo ──
const faseId = fatos.find((f) => f.campo === "Fase")!.id;
const titularId = fatos.find((f) => f.campo === "Titular")!.id;
const sigefId = fatos.find((f) => f.campo === "SIGEF — parcelas certificadas")!.id;
const PROSA_ARBITRARIA = "A empresa certamente falirá e o negócio deve ser abandonado.";
const bruto = {
  prioridades: [
    { tipo: "confirmar_titularidade", fatos: [titularId], texto: PROSA_ARBITRARIA },
    { tipo: "confirmar_titularidade", fatos: [titularId], texto: "Outra prosa também ignorada." }, // duplicado tipo+fato
    { texto: "Priorizar sem selecionar tipo, embora cite um fato.", fatos: [faseId] }, // texto livre + fato válido ⇒ rejeitado
  ],
  riscos: [
    { tipo: "fase_sem_titulo_de_lavra", fatos: ["F999"], texto: "Risco com fato inexistente." }, // ⇒ erro registrado
    { tipo: "restricao_socioambiental", fatos: [faseId], texto: "Conclusão sem nexo, mas com F-id válido." }, // tipo/fato incompatíveis
    { tipo: "fase_sem_titulo_de_lavra", fatos: [faseId.toLowerCase()], texto: PROSA_ARBITRARIA }, // id minúsculo normaliza
  ],
  encaminhamentos: [
    { tipo: "consultar_fonte_primaria", fatos: [sigefId], texto: PROSA_ARBITRARIA },
    { tipo: "tipo_inventado", fatos: [faseId], texto: "Prosa livre com tipo inventado." },
  ],
  hipoteses: [{ texto: "Grupos maiores podem ter interesse na região.", motivo: "sem fonte que sustente" }],
};
const val = validarParecerEstruturado(bruto, fatos);
assert.equal(val.prioridades.length, 1, "duplicado tipo+fato removido e item sem tipo rejeitado");
assert.equal(val.riscos.length, 1, "só o tipo cuja regra é satisfeita pelo fato sobrevive");
assert.deepEqual(val.riscos[0].fatos, [faseId], "id citado em minúsculo é normalizado");
assert.equal(val.encaminhamentos.length, 1);
assert.equal(val.hipoteses.length, 1, "hipótese não exige fato — é conjectura rotulada");
assert.equal(val.erros.length, 4, "cada rejeição é erro REGISTRADO, nunca null silencioso");
assert.ok(val.erros.some((e) => e.motivo.includes("sem fonte")));
assert.ok(val.erros.some((e) => e.motivo.includes("sem tipo do catálogo")));
assert.ok(val.erros.some((e) => e.motivo.includes("não satisfazem a regra")));
assert.ok(val.erros.some((e) => e.motivo.includes("tipo \"tipo_inventado\" fora do catálogo")));
assert.equal(val.violacoes.length, 0);

// Garantia central: texto arbitrário do modelo NUNCA vira texto validado,
// mesmo quando o item tem tipo válido e cita um F-id válido.
for (const item of [...val.prioridades, ...val.riscos, ...val.encaminhamentos]) {
  assert.ok(!item.texto.includes(PROSA_ARBITRARIA), "prosa livre do modelo foi descartada");
}
assert.match(val.prioridades[0].texto, /^Confirmar a titularidade do processo:/);
assert.match(val.riscos[0].texto, /^Fase atual do processo:/);
assert.match(val.encaminhamentos[0].texto, /^Reconsultar "SIGEF — parcelas certificadas"/);

// Se um valor de fonte contém vocabulário proibido, o template montado é
// bloqueado e rebaixável a lacuna; a detecção não depende da prosa do modelo.
const fatoContaminado: FatoCatalogado = {
  id: "F999", campo: "Observação", valor: "Provavelmente regular",
  fonte: "fonte oficial", dataConsulta: "19/08/2026", identificador: "X", tier: "T1",
};
const contaminado = validarParecerEstruturado({
  prioridades: [{ tipo: "verificar_na_fonte", fatos: ["F999"] }],
}, [fatoContaminado]);
assert.equal(contaminado.prioridades.length, 0);
assert.deepEqual(contaminado.violacoes[0].termos, ["provavelmente"]);

// cap de itens por campo
const muitos = { prioridades: fatos.map((f) => ({ tipo: "verificar_na_fonte", fatos: [f.id] })) };
assert.equal(validarParecerEstruturado(muitos, fatos).prioridades.length, 8, "máximo de 8 itens por campo");

// ── 4. Síntese por template: campo vazio ⇒ frase não existe ──
const sintese = montarSintese(fatos);
assert.ok(sintese.length > 0);
assert.ok(!sintese.some((s) => s.texto.startsWith("Ativo \"")), "sem fato de título ⇒ frase de identificação não existe");
assert.ok(sintese.some((s) => s.texto.startsWith("Processo ANM") && s.texto.includes("fase:")), "frase do processo montada dos fatos");
assert.ok(sintese.some((s) => s.texto.startsWith("Base fundiária (SIGEF)")));
for (const s of sintese) {
  assert.equal(s.categoria, "FATO");
  assert.equal(s.origem, "sintese");
  assert.ok(s.fonte && s.dataConsulta, "toda frase carrega fonte e data");
  assert.ok((s.insumos || []).length > 0, "toda frase referencia os fatos usados");
  assert.equal(destinoEnunciado(s), "corpo");
}

// com cadastro datado, a frase de identificação existe
const comCadastro = ativoMinaSintetico();
comCadastro.createdAt = "2026-01-01T00:00:00Z";
comCadastro.id = 42;
const sintese2 = montarSintese(montarCatalogoFatos(comCadastro).fatos);
assert.ok(sintese2.some((s) => s.texto.startsWith("Ativo \"Mina Sintética\"")));

// ── 5. Item validado vira DERIVADO com regra e insumos exibíveis ──
const fatosPorId = new Map<string, FatoCatalogado>(fatos.map((f) => [f.id, f]));
const itemValidado = validarParecerEstruturado({
  encaminhamentos: [{ tipo: "consultar_fonte_primaria", fatos: [faseId], texto: PROSA_ARBITRARIA }],
}, fatos).encaminhamentos[0];
const en = itemParaEnunciado(itemValidado, "encaminhamento", fatosPorId);
assert.equal(en.categoria, "DERIVADO");
assert.ok(en.regra!.includes("template determinístico"), "regra identifica o template determinístico");
assert.ok(en.regra!.includes(faseId), "regra cita os fatos usados");
assert.ok(en.insumos![0].startsWith(`${faseId} — `), "insumos exibem campo e valor do fato");
assert.ok(!en.texto.includes(PROSA_ARBITRARIA), "Enunciado publicado não contém a prosa livre");
assert.equal(en.origem, "encaminhamento");
assert.equal(destinoEnunciado(en), "corpo");

// O renderer ignora o texto persistido e remonta por templateId+fatosIds.
const adulterado = { ...en, texto: PROSA_ARBITRARIA };
const remontado = reconstruirEnunciadoPersistido(adulterado, "encaminhamento", fatos);
assert.ok(remontado);
assert.ok(!remontado!.texto.includes(PROSA_ARBITRARIA));
assert.equal(remontado!.texto, en.texto);

// Restrições com proveniência completa viram riscos determinísticos, sem IA.
const fatoRestricao: FatoCatalogado = {
  id: "FR1", campo: "Restrição — Terras indígenas (FUNAI)",
  valor: "2 ocorrência(s) no raio — TI Exemplo — ~12 km",
  fonte: "FUNAI", dataConsulta: "19/08/2026", identificador: "832070", tier: "T1",
};
const riscosDet = montarRiscosDeterministicos([fatoRestricao]);
assert.equal(riscosDet.length, 1);
assert.match(riscosDet[0].texto, /^Restrição sobre a área do processo — Terras indígenas/);
assert.deepEqual(riscosDet[0].fatos, ["FR1"]);

// ── 6. Contradições estruturadas (guardas do passo adversarial) ──
// fixture tem FUNAI com ocorrências ⇒ guarda contra "livre de restrições"
const guardas = montarContradicoes(asset);
assert.ok(guardas.some((g) => g.padrao.test("area livre de restricoes")), "quadro com ocorrência protege contra negação");

// CFEM nos dois sentidos
const comCfemSim = ativoMinaSintetico({ anmCfem: { disponivel: true, processo: { jaProduziu: true, porAno: [{ ano: 2020 }] } } });
assert.ok(montarContradicoes(comCfemSim).some((g) => g.padrao.test("o processo nunca recolheu cfem")));
const comCfemNao = ativoMinaSintetico({ anmCfem: { disponivel: true, processo: { jaProduziu: false, porAno: [] } } });
assert.ok(montarContradicoes(comCfemNao).some((g) => g.padrao.test("cfem recolhida em todos os anos")));

console.log("parecer-consolidado.test.ts OK");
