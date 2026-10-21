/**
 * Perfis por grupo mineral e fase ANM — orientam a pesquisa (termos de busca,
 * substâncias equivalentes) e as lacunas prioritárias do dossiê da jazida.
 *
 * Regras:
 * - Classificação determinística por vocabulário (sem IA). Substância não
 *   mapeada cai no perfil genérico — nunca é inventado um grupo.
 * - "Lacuna prioritária" é o que falta para avaliar tecnicamente aquele tipo
 *   de depósito; o catálogo (o que falta / por que importa / onde obter /
 *   próximo passo) é fixo e nunca redigido por IA.
 * - Substância requerida na ANM não significa jazida comprovada: ocorrência,
 *   recurso e reserva são coisas distintas — o perfil só diz o que procurar.
 */

export type GrupoMineral =
  | "metalico_precioso"
  | "metalico_base"
  | "ferroso"
  | "terras_raras_criticos"
  | "industrial"
  | "agregados_construcao"
  | "rocha_ornamental"
  | "energetico"
  | "gemas"
  | "agua_mineral"
  | "generico";

export type FaseCategoria =
  | "requerimento_pesquisa"
  | "autorizacao_pesquisa"
  | "requerimento_lavra"
  | "concessao_lavra"
  | "licenciamento"
  | "registro_extracao"
  | "lavra_garimpeira"
  | "disponibilidade"
  | "desconhecida";

export interface LacunaPerfil {
  id: string;
  tema: string;
  oQueFalta: string;
  porQueImporta: string;
  ondeObter: string;
  proximoPasso: string;
  /** Fases em que a lacuna é relevante; ausente = todas. */
  fases?: FaseCategoria[];
  /** 1 = decide a avaliação; 2 = condiciona; 3 = complementa. */
  prioridade: 1 | 2 | 3;
}

export interface PerfilGrupo {
  grupo: GrupoMineral;
  rotulo: string;
  /** Temas de evidência em ordem de prioridade para este grupo. */
  prioridades: string[];
  /** Unidade/forma esperada para teor ou qualidade. */
  unidadesTeor: string;
  lacunas: LacunaPerfil[];
}

export interface SubstanciaClassificada {
  substancia: string;
  normalizada: string;
  grupo: GrupoMineral;
  /** Termos para casar substâncias equivalentes (ex.: estanho ↔ cassiterita)
   *  em ocorrências do GeoSGB, processos SIGMINE e busca documental. */
  termos: string[];
}

export const normalizar = (s: any): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Ordem importa: a primeira regra que casar define o grupo. Termos específicos
// (ex.: "areia industrial") vêm antes dos genéricos ("areia").
const REGRAS: Array<{ grupo: GrupoMineral; chaves: string[]; termos: string[] }> = [
  { grupo: "agua_mineral", chaves: ["agua mineral", "agua potavel", "agua de mesa"], termos: ["agua mineral", "hidrogeologia", "aquifero"] },
  { grupo: "terras_raras_criticos", chaves: ["terras raras", "terra rara", "monazita", "xenotima", "bastnaesita", "etr "], termos: ["terras raras", "monazita", "xenotima", "etr"] },
  { grupo: "terras_raras_criticos", chaves: ["litio", "espodumenio", "petalita", "lepidolita", "ambligonita"], termos: ["litio", "espodumenio", "pegmatito"] },
  { grupo: "terras_raras_criticos", chaves: ["grafita", "grafite"], termos: ["grafita", "grafite"] },
  { grupo: "terras_raras_criticos", chaves: ["niobio", "pirocloro", "columbita"], termos: ["niobio", "pirocloro", "columbita"] },
  { grupo: "terras_raras_criticos", chaves: ["tantalo", "tantalita"], termos: ["tantalo", "tantalita", "columbita"] },
  { grupo: "terras_raras_criticos", chaves: ["cobalto", "vanadio", "berilo", "berilio", "escandio", "galio", "germanio", "telurio", "indio"], termos: [] },
  { grupo: "metalico_precioso", chaves: ["ouro", "prata", "platina", "paladio", "pgm"], termos: ["ouro", "aurifero"] },
  { grupo: "ferroso", chaves: ["ferro", "hematita", "itabirito", "magnetita", "manganes"], termos: ["ferro", "itabirito", "hematita", "manganes"] },
  { grupo: "metalico_base", chaves: ["estanho", "cassiterita"], termos: ["estanho", "cassiterita", "estanifera"] },
  { grupo: "metalico_base", chaves: ["tungstenio", "scheelita", "volframita", "wolframita"], termos: ["tungstenio", "scheelita", "volframita"] },
  { grupo: "metalico_base", chaves: ["cobre", "calcopirita"], termos: ["cobre", "cuprifero"] },
  { grupo: "metalico_base", chaves: ["niquel", "zinco", "chumbo", "molibdenio", "antimonio", "bismuto", "cromo", "cromita", "titanio", "ilmenita", "rutilo", "zirconio", "zirconita", "bauxita", "aluminio", "mercurio"], termos: [] },
  { grupo: "energetico", chaves: ["carvao", "uranio", "turfa", "torio", "linhito", "folhelho"], termos: [] },
  { grupo: "gemas", chaves: ["diamante", "esmeralda", "turmalina", "agua-marinha", "agua marinha", "ametista", "topazio", "opala", "gema", "berilo gema", "alexandrita", "cristal de rocha", "agata"], termos: ["gema", "pegmatito"] },
  { grupo: "rocha_ornamental", chaves: ["ornamental", "revestimento", "marmore", "ardosia", "quartzito", "granito", "gnaisse", "sienito", "pedra sao tome", "pedra miracema", "pedra madeira"], termos: ["rocha ornamental", "granito", "marmore"] },
  { grupo: "industrial", chaves: ["areia industrial", "areia quartzosa", "areia silicosa", "silica"], termos: ["areia industrial", "silica", "quartzo"] },
  { grupo: "agregados_construcao", chaves: ["areia", "cascalho", "saibro", "brita", "basalto", "diabasio", "piçarra", "picarra", "seixo", "argila para construcao", "material de emprestimo"], termos: ["areia", "agregado", "brita"] },
  { grupo: "industrial", chaves: ["calcario", "dolomito", "calcita", "cal ", "rocha carbonatica", "argila", "caulim", "feldspato", "quartzo", "gipsita", "gesso", "magnesita", "talco", "vermiculita", "bentonita", "fosfato", "apatita", "potassio", "silvinita", "sal", "halita", "barita", "fluorita", "mica", "diatomita", "agalmatolito", "filito", "pirofilita", "leucita", "nefelina", "enxofre", "pirita", "turmalina industrial", "amianto", "grafita amorfa", "bauxita refrataria", "cianita", "sillimanita", "wollastonita", "zeolita", "perlita", "pedra-pomes", "conchas calcarias", "calcario conchifero", "marga", "rochas fosfaticas", "siltito", "arenito", "folhelho piroc", "xisto"], termos: [] },
];

export function classificarSubstancia(substancia: any): SubstanciaClassificada {
  const bruto = String(substancia ?? "").trim();
  const norm = normalizar(bruto);
  // "MINÉRIO DE X" / "MINERIO DE X" → X
  const base = norm.replace(/^minerio de /, "").replace(/^minerios de /, "").trim();
  if (!base) return { substancia: bruto, normalizada: "", grupo: "generico", termos: [] };
  for (const regra of REGRAS) {
    const chave = regra.chaves.find((k) => base.includes(k.trim()) || (k.endsWith(" ") && (base + " ").includes(k)));
    if (chave) {
      const termos = Array.from(new Set([base, chave.trim(), ...regra.termos].filter(Boolean)));
      return { substancia: bruto, normalizada: base, grupo: regra.grupo, termos };
    }
  }
  return { substancia: bruto, normalizada: base, grupo: "generico", termos: [base] };
}

/** Verdadeiro quando o texto (substâncias de uma ocorrência/processo) casa
 *  com a substância classificada ou seus equivalentes. */
export function casaSubstancia(texto: any, classe: SubstanciaClassificada): boolean {
  const t = normalizar(texto);
  if (!t || classe.termos.length === 0) return false;
  return classe.termos.some((termo) => termo.length >= 3 && t.includes(termo));
}

export function categorizarFase(fase: any): FaseCategoria {
  const f = normalizar(fase);
  if (!f) return "desconhecida";
  if (f.includes("disponibilidade")) return "disponibilidade";
  if (f.includes("garimpeira")) return "lavra_garimpeira";
  if (f.includes("registro de extracao")) return "registro_extracao";
  if (f.includes("licenciamento")) return "licenciamento";
  if (f.includes("concessao de lavra")) return "concessao_lavra";
  if (f.includes("requerimento de lavra")) return "requerimento_lavra";
  if (f.includes("autorizacao de pesquisa")) return "autorizacao_pesquisa";
  if (f.includes("requerimento de pesquisa")) return "requerimento_pesquisa";
  if (f.includes("lavra")) return "concessao_lavra";
  if (f.includes("pesquisa")) return "autorizacao_pesquisa";
  return "desconhecida";
}

export const ROTULO_FASE: Record<FaseCategoria, string> = {
  requerimento_pesquisa: "Requerimento de pesquisa",
  autorizacao_pesquisa: "Autorização de pesquisa",
  requerimento_lavra: "Requerimento de lavra",
  concessao_lavra: "Concessão de lavra",
  licenciamento: "Licenciamento",
  registro_extracao: "Registro de extração",
  lavra_garimpeira: "Lavra garimpeira (PLG)",
  disponibilidade: "Disponibilidade",
  desconhecida: "Fase não informada",
};

const FASES_PRE_LAVRA: FaseCategoria[] = ["requerimento_pesquisa", "autorizacao_pesquisa", "requerimento_lavra", "disponibilidade", "desconhecida"];
const FASES_LAVRA: FaseCategoria[] = ["requerimento_lavra", "concessao_lavra", "licenciamento", "registro_extracao", "lavra_garimpeira"];

// Lacunas comuns a todos os grupos (além dos seis componentes de maturidade do
// dossiê, que continuam sendo o único indicador de completude).
const LACUNAS_COMUNS: LacunaPerfil[] = [
  {
    id: "teor_metodo", tema: "Teores e qualidade", prioridade: 1,
    oQueFalta: "Resultados analíticos com método, laboratório, unidade e data (certificados de análise ou tabelas do relatório técnico)",
    porQueImporta: "Teor sem método, unidade e lastro documental não é comparável nem auditável; é a base de qualquer avaliação de valor",
    ondeObter: "Relatório Final de Pesquisa / relatórios anuais de lavra no SEI/ANM; certificados de laboratório do titular",
    proximoPasso: "Solicitar ao titular os certificados e a tabela de amostras; conferir página e unidade de cada valor",
  },
  {
    id: "mineralogia", tema: "Mineralogia e liberação", prioridade: 2,
    oQueFalta: "Caracterização mineralógica (minerais de minério, ganga, granulometria de liberação)",
    porQueImporta: "Define a rota de beneficiamento e a recuperação possível — dois minérios com o mesmo teor podem ter valor muito diferente",
    ondeObter: "Estudos de caracterização tecnológica (CETEM, universidades, laboratórios do titular); RIGeo/SGB para analogias regionais",
    proximoPasso: "Verificar se há estudo de caracterização; se não houver, prever amostragem para ensaio",
  },
  {
    id: "beneficiamento", tema: "Recuperação e beneficiamento", prioridade: 2,
    oQueFalta: "Ensaios de beneficiamento com recuperação mássica/metalúrgica e qualidade do produto",
    porQueImporta: "Sem recuperação demonstrada, tonelagem e teor não se convertem em produto vendável",
    ondeObter: "PAE (Plano de Aproveitamento Econômico) no SEI/ANM; relatórios de ensaios em escala de bancada/piloto",
    proximoPasso: "Localizar o PAE ou os ensaios; registrar recuperação, rota e produto com fonte e data",
    fases: FASES_LAVRA,
  },
  {
    id: "infra_agua_energia", tema: "Infraestrutura (água, energia, acesso)", prioridade: 3,
    oQueFalta: "Confirmação de disponibilidade hídrica (outorga), capacidade de conexão elétrica e acesso legal/transitável",
    porQueImporta: "Proximidade de rio, linha de transmissão ou rodovia não comprova outorga, conexão nem acesso — são condicionantes de custo e prazo",
    ondeObter: "Órgão gestor de recursos hídricos da dominialidade do curso d'água (ANA ou órgão estadual); distribuidora/ONS para conexão; DNIT/DER e proprietários para acesso",
    proximoPasso: "Consultar outorgas existentes e órgão gestor identificado; pedir parecer de acesso à distribuidora",
  },
];

const PERFIS: Record<GrupoMineral, PerfilGrupo> = {
  metalico_precioso: {
    grupo: "metalico_precioso", rotulo: "Metálico precioso (Au, Ag, PGM)",
    prioridades: ["teor (g/t) e continuidade", "controle estrutural/litológico", "recuperação (gravimétrica, cianetação)", "deletérios (As, Sb, Hg, C orgânico)", "licenciamento e passivo garimpeiro"],
    unidadesTeor: "g/t",
    lacunas: [
      ...LACUNAS_COMUNS,
      { id: "deleterios_au", tema: "Contaminantes", prioridade: 2, oQueFalta: "Teores de As, Sb, Hg e carbono orgânico nas amostras", porQueImporta: "Minério refratário ou com arsênio muda rota, custo e licenciamento", ondeObter: "Certificados de análise multielementar; relatórios de pesquisa", proximoPasso: "Conferir se as análises incluíram multielementar; se não, prever reanálise" },
      { id: "passivo_garimpo", tema: "Passivo e ocupação", prioridade: 2, oQueFalta: "Registro de atividade garimpeira atual/pretérita no polígono", porQueImporta: "Garimpo gera passivo ambiental, conflito possessório e perda de recurso", ondeObter: "Imagens de satélite recentes, eventos ANM, autos de infração (IBAMA/ANM)", proximoPasso: "Checar imagens e autuações; registrar com data" },
    ],
  },
  metalico_base: {
    grupo: "metalico_base", rotulo: "Metálico de base (Sn, Cu, Ni, Zn, Pb, W…)",
    prioridades: ["teor (%) e tonelagem", "mineralogia de minério e liberação", "recuperação e concentrado (qualidade/penalidades)", "contaminantes (As, Bi, Sb, F, U/Th)", "logística para concentrado"],
    unidadesTeor: "% (ou g/t para subprodutos)",
    lacunas: [
      ...LACUNAS_COMUNS,
      { id: "concentrado", tema: "Qualidade do concentrado", prioridade: 2, oQueFalta: "Especificação do concentrado produzível e penalidades de refinaria/fundição", porQueImporta: "O preço realizado depende do teor do concentrado e dos elementos penalizados", ondeObter: "Ensaios de beneficiamento; contratos ou cotações de compra de concentrado", proximoPasso: "Obter análise química do concentrado; comparar com especificações de compradores", fases: FASES_LAVRA },
    ],
  },
  ferroso: {
    grupo: "ferroso", rotulo: "Ferroso (Fe, Mn)",
    prioridades: ["teor (% Fe/Mn) e tipologia (hematita, itabirito)", "contaminantes (SiO2, Al2O3, P, S)", "granulometria e produto (granulado, sinter feed, pellet feed)", "logística de volume (ferrovia/porto)", "barragens/rejeito"],
    unidadesTeor: "% Fe (ou % Mn)",
    lacunas: [
      ...LACUNAS_COMUNS,
      { id: "contaminantes_fe", tema: "Contaminantes", prioridade: 1, oQueFalta: "SiO2, Al2O3, P, S e perda ao fogo por tipologia de minério", porQueImporta: "Define produto, prêmio/desconto e necessidade de concentração", ondeObter: "Análises químicas do titular; RFP/PAE no SEI", proximoPasso: "Tabular contaminantes por litotipo com fonte e data" },
      { id: "logistica_volume", tema: "Logística de volume", prioridade: 1, oQueFalta: "Modal e custo de escoamento para volumes de minério de ferro/manganês", porQueImporta: "Em ferrosos a logística decide a viabilidade mais que o teor", ondeObter: "Concessionárias ferroviárias, portos (ANTAQ), estudos de tráfego", proximoPasso: "Estimar distância e modal até terminal; consultar capacidade disponível", fases: FASES_LAVRA },
    ],
  },
  terras_raras_criticos: {
    grupo: "terras_raras_criticos", rotulo: "Terras raras e minerais críticos (ETR, Li, Nb, Ta, grafita…)",
    prioridades: ["teor total e distribuição individual (ETR pesados × leves; Li2O; Nb2O5)", "mineralogia hospedeira (iônica, monazita, carbonatito, pegmatito)", "recuperação/rota hidrometalúrgica", "radionuclídeos (U, Th) e licenciamento CNEN", "mercado/offtake"],
    unidadesTeor: "% TREO (ou ppm por elemento), % Li2O, % Nb2O5",
    lacunas: [
      ...LACUNAS_COMUNS,
      { id: "distribuicao_etr", tema: "Distribuição individual", prioridade: 1, oQueFalta: "Distribuição por elemento (ETR leves/pesados, Nd-Pr, Dy-Tb) ou por fase mineral", porQueImporta: "O valor de terras raras depende da cesta de elementos, não do teor total", ondeObter: "Análises ICP-MS do titular; relatórios de pesquisa; RIGeo/SGB para analogias", proximoPasso: "Solicitar tabela por elemento com método e laboratório" },
      { id: "radionuclideos", tema: "Radionuclídeos", prioridade: 1, oQueFalta: "Teores de U e Th e enquadramento junto à CNEN", porQueImporta: "U/Th condicionam licenciamento, disposição de rejeito e aceitação do produto", ondeObter: "Análises multielementares; CNEN (normas de mineração com radionuclídeos)", proximoPasso: "Verificar U/Th nas análises; consultar enquadramento regulatório" },
      { id: "rota_metalurgica", tema: "Rota de processo", prioridade: 2, oQueFalta: "Ensaios de lixiviação/flotação com recuperação por elemento", porQueImporta: "Minerais críticos frequentemente falham na rota de processo, não na geologia", ondeObter: "Ensaios em laboratórios especializados (CETEM, CDTN, universidades)", proximoPasso: "Localizar ensaios existentes; prever programa de testes" },
    ],
  },
  industrial: {
    grupo: "industrial", rotulo: "Mineral industrial (calcário, argila, caulim, fosfato, quartzo…)",
    prioridades: ["especificação química/física do produto (ex.: CaO/MgO, alvura, Fe2O3, granulometria)", "uniformidade do depósito", "mercado regional e distância ao consumidor", "beneficiamento simples × complexo", "licenciamento"],
    unidadesTeor: "% de óxidos ou propriedade física conforme uso (alvura, plasticidade, granulometria)",
    lacunas: [
      ...LACUNAS_COMUNS,
      { id: "especificacao_uso", tema: "Especificação para o uso", prioridade: 1, oQueFalta: "Ensaios que enquadrem o material na especificação do uso pretendido (cimento, cal, cerâmica, carga, fertilizante)", porQueImporta: "Em minerais industriais o valor é definido pela conformidade com a especificação, não pelo teor isolado", ondeObter: "Ensaios tecnológicos (laboratórios de cerâmica/cimento, CETEM); normas ABNT do uso", proximoPasso: "Identificar o uso e a norma aplicável; conferir ensaios existentes" },
      { id: "mercado_regional", tema: "Mercado regional", prioridade: 2, oQueFalta: "Consumidores em raio econômico e preços regionais praticados", porQueImporta: "Minerais industriais têm baixo valor unitário: a distância ao consumidor decide a viabilidade", ondeObter: "Anuário Mineral/ANM, CFEM municipal, sindicatos setoriais", proximoPasso: "Mapear consumidores no raio de 100–300 km com fonte e data" },
    ],
  },
  agregados_construcao: {
    grupo: "agregados_construcao", rotulo: "Agregados para construção (areia, brita, cascalho, saibro)",
    prioridades: ["mercado consumidor e distância (raio econômico curto)", "qualidade (granulometria, abrasão, reatividade álcali-agregado, impurezas)", "volume lavrável e relação estéril/minério", "licenciamento ambiental e conflito urbano", "regime (licenciamento/registro de extração)"],
    unidadesTeor: "ensaios físicos (granulometria, Los Angeles, RAA, teor de finos)",
    lacunas: [
      ...LACUNAS_COMUNS.filter((l) => l.id !== "mineralogia"),
      { id: "qualidade_agregado", tema: "Qualidade do agregado", prioridade: 1, oQueFalta: "Ensaios físicos do material (granulometria, abrasão Los Angeles, reatividade álcali-agregado, material pulverulento)", porQueImporta: "Define aceitação em concreto/asfalto e preço", ondeObter: "Laboratórios de materiais de construção; normas ABNT NBR 7211 e correlatas", proximoPasso: "Coletar amostras e ensaiar; registrar norma e resultado" },
      { id: "mercado_local", tema: "Mercado consumidor", prioridade: 1, oQueFalta: "Demanda e preços no raio econômico (tipicamente < 50–100 km) e concorrentes ativos", porQueImporta: "O frete domina o custo do agregado — sem mercado próximo não há viabilidade", ondeObter: "CFEM municipal, processos SIGMINE vizinhos da mesma substância, obras públicas e concreteiras locais", proximoPasso: "Listar concorrentes e consumidores no raio com fonte e data" },
      { id: "conflito_uso_solo", tema: "Uso do solo", prioridade: 2, oQueFalta: "Compatibilidade com zoneamento municipal e vizinhança urbana", porQueImporta: "Pedreiras e areais próximos a áreas urbanas enfrentam restrição de licenciamento e horário", ondeObter: "Plano diretor/zoneamento municipal; órgão ambiental estadual", proximoPasso: "Consultar o zoneamento do município para o polígono" },
    ],
  },
  rocha_ornamental: {
    grupo: "rocha_ornamental", rotulo: "Rocha ornamental e de revestimento",
    prioridades: ["padrão estético e aceitação comercial", "recuperação em blocos (fraturamento, homogeneidade)", "ensaios tecnológicos (ABNT 15844)", "logística de blocos", "licenciamento"],
    unidadesTeor: "recuperação em blocos (%) e ensaios físico-mecânicos",
    lacunas: [
      ...LACUNAS_COMUNS.filter((l) => l.id !== "mineralogia" && l.id !== "beneficiamento"),
      { id: "recuperacao_blocos", tema: "Recuperação em blocos", prioridade: 1, oQueFalta: "Levantamento de fraturamento e recuperação esperada em blocos comerciais", porQueImporta: "Em ornamentais a recuperação em blocos vale mais que o volume de rocha", ondeObter: "Mapeamento estrutural de detalhe; histórico de lavra de pedreiras vizinhas", proximoPasso: "Verificar se há levantamento estrutural; pedir dados de pedreiras vizinhas" },
      { id: "ensaios_ornamental", tema: "Ensaios tecnológicos", prioridade: 2, oQueFalta: "Ensaios de caracterização (ABNT NBR 15844): absorção, resistência, desgaste", porQueImporta: "Condicionam o uso (piso, fachada) e a aceitação no mercado", ondeObter: "Laboratórios de rochas ornamentais (CETEM, CETEMAG)", proximoPasso: "Localizar ensaios ou prever amostragem de blocos" },
    ],
  },
  energetico: {
    grupo: "energetico", rotulo: "Energético (carvão, urânio, turfa)",
    prioridades: ["qualidade (poder calorífico, cinzas, enxofre / teor de U3O8)", "regime jurídico especial (urânio é monopólio da União)", "licenciamento e passivo", "mercado"],
    unidadesTeor: "kcal/kg, % cinzas, % S (carvão) · ppm U3O8 (urânio)",
    lacunas: [
      ...LACUNAS_COMUNS,
      { id: "regime_especial", tema: "Regime jurídico", prioridade: 1, oQueFalta: "Confirmação do regime aplicável (urânio: monopólio da União/INB; carvão: licenciamento ambiental específico)", porQueImporta: "Pode impedir a exploração privada ou condicionar o aproveitamento", ondeObter: "Legislação (Constituição art. 177; CNEN/INB); ANM", proximoPasso: "Enquadrar a substância no regime e registrar a base legal" },
    ],
  },
  gemas: {
    grupo: "gemas", rotulo: "Gemas e pedras preciosas",
    prioridades: ["qualidade gemológica (cor, limpidez, tamanho)", "tipologia do depósito (primário/secundário)", "histórico de produção (CFEM/garimpo)", "informalidade e comercialização"],
    unidadesTeor: "quilates por tonelada/m³ e classificação gemológica",
    lacunas: [
      ...LACUNAS_COMUNS.filter((l) => l.id !== "beneficiamento"),
      { id: "qualidade_gema", tema: "Qualidade gemológica", prioridade: 1, oQueFalta: "Laudos gemológicos e distribuição de qualidade/tamanho da produção", porQueImporta: "Em gemas o valor varia ordens de grandeza com a qualidade — o teor médio pouco informa", ondeObter: "Laudos de laboratórios gemológicos; registros de venda do titular", proximoPasso: "Solicitar laudos e histórico de comercialização" },
    ],
  },
  agua_mineral: {
    grupo: "agua_mineral", rotulo: "Água mineral",
    prioridades: ["vazão sustentável e teste de bombeamento", "hidroquímica e classificação (LAMIN/SGB)", "perímetro de proteção e uso do solo", "licenciamento sanitário"],
    unidadesTeor: "m³/h (vazão) e mg/L (hidroquímica)",
    lacunas: [
      LACUNAS_COMUNS[3],
      { id: "vazao", tema: "Vazão e hidrogeologia", prioridade: 1, oQueFalta: "Teste de bombeamento com vazão de explotação e rebaixamento", porQueImporta: "A vazão sustentável é o 'recurso' da água mineral", ondeObter: "Relatório hidrogeológico no SEI/ANM; SIAGAS/SGB para poços vizinhos", proximoPasso: "Localizar o relatório hidrogeológico; conferir data e método" },
      { id: "hidroquimica", tema: "Hidroquímica", prioridade: 1, oQueFalta: "Análises físico-químicas e classificação pelo LAMIN/SGB", porQueImporta: "Define o enquadramento como água mineral e as alegações permitidas no rótulo", ondeObter: "LAMIN/SGB; relatórios no SEI/ANM", proximoPasso: "Solicitar o laudo LAMIN e a resolução de classificação" },
    ],
  },
  generico: {
    grupo: "generico", rotulo: "Substância sem perfil específico",
    prioridades: ["teor/qualidade com método e unidade", "mineralogia", "recuperação e produto", "infraestrutura e licenciamento"],
    unidadesTeor: "conforme a substância (informar unidade sempre)",
    lacunas: [...LACUNAS_COMUNS],
  },
};

export function perfilDoGrupo(grupo: GrupoMineral): PerfilGrupo {
  return PERFIS[grupo] || PERFIS.generico;
}

/** Lacunas do perfil aplicáveis à fase, ordenadas por prioridade e id (estável). */
export function lacunasDoPerfil(grupo: GrupoMineral, fase: FaseCategoria): LacunaPerfil[] {
  return perfilDoGrupo(grupo).lacunas
    .filter((l) => !l.fases || l.fases.includes(fase))
    .slice()
    .sort((a, b) => a.prioridade - b.prioridade || a.id.localeCompare(b.id));
}

export { FASES_PRE_LAVRA, FASES_LAVRA };
