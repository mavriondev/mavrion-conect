import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

export interface CafLead {
  id?: string;
  idUfpa: string;
  nufpa: string;
  nome: string;
  cpfMascarado: string;
  situacao: string;
  grauParentesco: string;
  municipio: string;
  uf: string;
  atividade: string;
  areaHa: number | null;
  condicaoPosse: string;
  numImoveis: number;
  enquadramentoPronaf: boolean;
  dataValidade: string | null;
  dataInscricao: string | null;
  entidadeCadastradora: string;
  membros: Array<{ nome: string; cpf: string; parentesco: string }>;
  classificacao: 'pendente' | 'qualificado' | 'descartado' | 'enviado_sdr';
  notasClassificacao?: string;
  norionProfile?: 'alto' | 'medio' | 'baixo';
  extraidoEm: string;
}

export interface CafCrawlerJob {
  id: string;
  orgId: string;
  modo: 'paginado' | 'sequencial' | 'municipio';
  uf: string;
  ano: number;
  mes: number;
  seqInicio: number;
  seqFim: number;
  municipio?: string;
  codIBGE?: string;
  areaMinHa: number;
  areaMaxHa: number;
  delayMs: number;
  apenasProprietario: boolean;
  apenasAtivos: boolean;
  apenasComPronaf: boolean;
  status: 'pendente' | 'rodando' | 'pausado' | 'concluido' | 'erro';
  progresso: number;
  totalVaridos: number;
  totalEncontrados: number;
  totalSalvos: number;
  totalErros: number;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  mensagemErro?: string;
  paginaAtual?: number;
  totalPaginas?: number;
}

const DELAY_MS = 1100;
const TIMEOUT = 15000;
const PAGE_SIZE = 50;
const MAX_404_CONSECUTIVOS = 50;
const BASE_URL = 'https://caf.mda.gov.br';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const httpJson: AxiosInstance = axios.create({
  timeout: TIMEOUT,
  httpsAgent,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://caf.mda.gov.br/consulta-publica/ufpa',
    'Origin': 'https://caf.mda.gov.br',
  },
  validateStatus: s => s < 500,
});

const httpHtml: AxiosInstance = axios.create({
  timeout: TIMEOUT,
  httpsAgent,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://caf.mda.gov.br/consulta-publica/ufpa',
  },
  validateStatus: s => s < 500,
});

export function montarNufpa(uf: string, ano: number, mes: number, seq: number): string {
  return `${uf.toUpperCase()}03${ano}.${mes.toString().padStart(2, '0')}.${seq.toString().padStart(9, '0')}CAF`;
}

export function calcularPerfilNorion(lead: CafLead): 'alto' | 'medio' | 'baixo' {
  let score = 0;

  if (lead.areaHa && lead.areaHa >= 100) score += 5;
  else if (lead.areaHa && lead.areaHa >= 50) score += 4;
  else if (lead.areaHa && lead.areaHa >= 20) score += 2;
  else if (lead.areaHa && lead.areaHa > 0) score += 1;

  if (lead.enquadramentoPronaf) score += 2;
  if (lead.situacao === 'ATIVA') score += 2;
  if (lead.numImoveis > 1) score += 1;
  if (lead.numImoveis >= 3) score += 1;
  if (lead.membros.length >= 3) score += 1;
  if (lead.membros.length >= 5) score += 1;

  const posse = (lead.condicaoPosse || '').toLowerCase();
  if (posse.includes('proprietário') || posse.includes('proprietario')) score += 3;
  else if (posse.includes('arrendatário') || posse.includes('arrendatario')) score += 1;
  else if (posse.includes('posseiro') || posse.includes('assentado')) score += 1;

  const ativ = (lead.atividade || '').toLowerCase();
  if (ativ.includes('pecuária') || ativ.includes('pecuaria') || ativ.includes('gado') || ativ.includes('bovino')) score += 2;
  if (ativ.includes('soja') || ativ.includes('milho') || ativ.includes('café') || ativ.includes('cafe')) score += 1;
  if (ativ.includes('lavoura') || ativ.includes('grão') || ativ.includes('grao')) score += 1;

  if (lead.dataValidade) {
    const validade = new Date(lead.dataValidade);
    const agora = new Date();
    const mesesRestantes = (validade.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (mesesRestantes > 12) score += 1;
  }

  if (score >= 10) return 'alto';
  if (score >= 5) return 'medio';
  return 'baixo';
}

interface CafApiResult {
  situacao: string;
  nome: string;
  cpf: string;
  numeroCaf: string;
  grauParentesco: string;
  idUfpa: string;
}

async function consultarApiPaginada(params: {
  uf?: string;
  cpf?: string;
  numeroCaf?: string;
  codigoMunicipio?: string;
  idSituacao?: number;
  pagina: number;
  tamanhoPagina: number;
}): Promise<{ dados: CafApiResult[]; sucesso: boolean }> {
  try {
    const queryParams = new URLSearchParams();
    if (params.uf) queryParams.set('uf', params.uf);
    if (params.cpf) queryParams.set('cpf', params.cpf);
    if (params.numeroCaf) queryParams.set('numeroCaf', params.numeroCaf);
    if (params.codigoMunicipio) queryParams.set('codigoMunicipio', params.codigoMunicipio);
    if (params.idSituacao !== undefined) queryParams.set('idSituacao', params.idSituacao.toString());
    queryParams.set('pagina', params.pagina.toString());
    queryParams.set('tamanhoPagina', params.tamanhoPagina.toString());

    const url = `${BASE_URL}/api/ufpa/consulta-publica?${queryParams.toString()}`;
    const res = await httpJson.get(url);

    if (res.status === 200 && res.data?.codigo === 200) {
      return { dados: res.data.dados || [], sucesso: true };
    }

    console.log(`[CAF] API retornou status ${res.status}, código ${res.data?.codigo}: ${res.data?.mensagem}`);
    return { dados: [], sucesso: false };
  } catch (err: any) {
    console.error(`[CAF] Erro na consulta API JSON: ${err.message}`);
    return { dados: [], sucesso: false };
  }
}

async function consultarHtmlScraping(nufpa: string): Promise<CafLead | null> {
  try {
    const url = `${BASE_URL}/consulta-publica/ufpa/${encodeURIComponent(nufpa)}`;
    const res = await httpHtml.get(url);

    if (res.status === 404 || res.status === 204) return null;
    if (res.status !== 200) return null;

    const html = typeof res.data === 'string' ? res.data : '';
    if (!html || html.length < 200) return null;

    const $ = cheerio.load(html);

    const getText = (label: string): string => {
      let value = '';
      const labelLower = label.toLowerCase();
      $('dt, th, label, strong, b, span.label, div.label, p').each((_i, el) => {
        const txt = $(el).text().trim().toLowerCase();
        if (txt.includes(labelLower)) {
          const next = $(el).next();
          if (next.length) {
            const nextText = next.text().trim();
            if (nextText && nextText.length < 500) value = nextText;
          }
          if (!value) {
            const parent = $(el).parent();
            const siblings = parent.children();
            const idx = siblings.index(el);
            if (idx >= 0 && idx + 1 < siblings.length) {
              const sibText = $(siblings[idx + 1]).text().trim();
              if (sibText && sibText.length < 500) value = sibText;
            }
          }
        }
      });
      return value;
    };

    const getFromTable = (label: string): string => {
      let value = '';
      const labelLower = label.toLowerCase();
      $('tr').each((_i, row) => {
        const cells = $(row).find('td, th');
        cells.each((_j, cell) => {
          if ($(cell).text().trim().toLowerCase().includes(labelLower)) {
            const nextCell = $(cell).next('td');
            if (nextCell.length) value = nextCell.text().trim();
            if (!value) {
              const nextTh = $(cell).next('th');
              if (nextTh.length) value = nextTh.text().trim();
            }
          }
        });
      });
      return value;
    };

    const getAnyText = (...labels: string[]): string => {
      for (const label of labels) {
        const v = getText(label) || getFromTable(label);
        if (v) return v;
      }
      return '';
    };

    const nome = getAnyText('nome', 'titular', 'nome completo', 'nome do titular');
    if (!nome) return null;

    const cpf = getAnyText('cpf', 'cpf/cnpj', 'documento');
    const situacao = getAnyText('situação', 'situacao', 'status', 'situação cadastral') || 'DESCONHECIDA';
    const municipio = getAnyText('município', 'municipio', 'cidade', 'localidade');
    const uf = nufpa.substring(0, 2);
    const atividade = getAnyText('atividade', 'atividades produtivas', 'atividade principal', 'atividade econômica', 'exploração');
    const condicaoPosse = getAnyText('condição', 'condicao', 'posse', 'condição de posse', 'tipo de posse', 'relação com a terra');

    const areaStr = getAnyText('área', 'area', 'área total', 'área do imóvel', 'hectares', 'tamanho');
    const areaHa = areaStr ? parseFloat(areaStr.replace(/[^\d,.-]/g, '').replace(',', '.')) || null : null;

    const pronafStr = getAnyText('pronaf', 'enquadramento', 'enquadramento pronaf', 'dap/pronaf');
    const enquadramentoPronaf = /sim|enquadrado|pronaf|apto/i.test(pronafStr);

    const validadeStr = getAnyText('validade', 'data de validade', 'válido até', 'vencimento');
    const inscricaoStr = getAnyText('inscrição', 'inscricao', 'data de inscrição', 'data cadastro', 'emissão');
    const entidade = getAnyText('entidade', 'cadastrador', 'entidade cadastradora', 'órgão emissor', 'emitido por');
    const numImoveisStr = getAnyText('imóveis', 'imoveis', 'número de imóveis', 'qtd imóveis', 'quantidade de imóveis');
    const numImoveis = numImoveisStr ? parseInt(numImoveisStr, 10) || 1 : 1;

    const rendaStr = getAnyText('renda', 'renda bruta', 'renda familiar', 'renda anual');
    const grupoStr = getAnyText('grupo', 'grupo pronaf', 'enquadramento grupo');

    const membros: CafLead['membros'] = [];
    $('table').each((_i, table) => {
      const headers = $(table).find('th').map((_j, th) => $(th).text().trim().toLowerCase()).get();
      const nomeIdx = headers.findIndex(h => h.includes('nome'));
      const cpfIdx = headers.findIndex(h => h.includes('cpf'));
      const parentIdx = headers.findIndex(h => h.includes('parentesco') || h.includes('grau'));

      if (nomeIdx >= 0) {
        $(table).find('tbody tr').each((_j, tr) => {
          const cells = $(tr).find('td').map((_k, td) => $(td).text().trim()).get();
          if (cells[nomeIdx] && cells[nomeIdx] !== nome) {
            membros.push({
              nome: cells[nomeIdx],
              cpf: cpfIdx >= 0 ? cells[cpfIdx] || '' : '',
              parentesco: parentIdx >= 0 ? cells[parentIdx] || '' : '',
            });
          }
        });
      }
    });

    const lead: CafLead = {
      idUfpa: '',
      nufpa,
      nome,
      cpfMascarado: cpf,
      situacao: situacao.toUpperCase(),
      grauParentesco: 'declarante',
      municipio,
      uf,
      atividade,
      areaHa,
      condicaoPosse,
      numImoveis,
      enquadramentoPronaf,
      dataValidade: validadeStr || null,
      dataInscricao: inscricaoStr || null,
      entidadeCadastradora: entidade,
      membros,
      classificacao: 'pendente',
      extraidoEm: new Date().toISOString(),
    };

    lead.norionProfile = calcularPerfilNorion(lead);
    return lead;
  } catch (err: any) {
    console.error(`[CAF] Erro no scraping HTML de ${nufpa}: ${err.message}`);
    return null;
  }
}

export async function consultarNufpa(nufpa: string): Promise<CafLead | null> {
  const result = await consultarApiPaginada({
    numeroCaf: nufpa,
    pagina: 1,
    tamanhoPagina: 10,
  });

  if (result.sucesso && result.dados.length > 0) {
    const declarante = result.dados.find(d => {
      const gp = (d.grauParentesco || '').toLowerCase();
      return gp.includes('declarante') || gp.includes('responsável') || gp.includes('responsavel') || gp.includes('titular');
    }) || result.dados[0];

    const membros: CafLead['membros'] = result.dados
      .filter(d => d.idUfpa === declarante.idUfpa && d !== declarante)
      .map(d => ({ nome: d.nome, cpf: d.cpf, parentesco: d.grauParentesco }));

    const lead = apiResultToLead(declarante, membros, nufpa.substring(0, 2));
    lead.norionProfile = calcularPerfilNorion(lead);
    return lead;
  }

  console.log(`[CAF] API JSON não retornou dados para ${nufpa}, tentando scraping HTML...`);
  return consultarHtmlScraping(nufpa);
}

function apiResultToLead(item: CafApiResult, membros: CafLead['membros'], uf: string): CafLead {
  const lead: CafLead = {
    idUfpa: item.idUfpa,
    nufpa: item.numeroCaf,
    nome: item.nome,
    cpfMascarado: item.cpf,
    situacao: item.situacao,
    grauParentesco: item.grauParentesco || '',
    municipio: '',
    uf,
    atividade: '',
    areaHa: null,
    condicaoPosse: '',
    numImoveis: 1,
    enquadramentoPronaf: false,
    dataValidade: null,
    dataInscricao: null,
    entidadeCadastradora: '',
    membros,
    classificacao: 'pendente',
    extraidoEm: new Date().toISOString(),
  };
  lead.norionProfile = calcularPerfilNorion(lead);
  return lead;
}

async function enriquecerLeadViaHtml(lead: CafLead): Promise<CafLead> {
  if (!lead.nufpa) return lead;
  try {
    const detalhes = await consultarHtmlScraping(lead.nufpa);
    if (!detalhes) return lead;

    if (detalhes.municipio && !lead.municipio) lead.municipio = detalhes.municipio;
    if (detalhes.atividade && !lead.atividade) lead.atividade = detalhes.atividade;
    if (detalhes.areaHa !== null && lead.areaHa === null) lead.areaHa = detalhes.areaHa;
    if (detalhes.condicaoPosse && !lead.condicaoPosse) lead.condicaoPosse = detalhes.condicaoPosse;
    if (detalhes.enquadramentoPronaf && !lead.enquadramentoPronaf) lead.enquadramentoPronaf = detalhes.enquadramentoPronaf;
    if (detalhes.dataValidade && !lead.dataValidade) lead.dataValidade = detalhes.dataValidade;
    if (detalhes.dataInscricao && !lead.dataInscricao) lead.dataInscricao = detalhes.dataInscricao;
    if (detalhes.entidadeCadastradora && !lead.entidadeCadastradora) lead.entidadeCadastradora = detalhes.entidadeCadastradora;
    if (detalhes.numImoveis > lead.numImoveis) lead.numImoveis = detalhes.numImoveis;
    if (detalhes.membros && detalhes.membros.length > lead.membros.length) lead.membros = detalhes.membros;

    lead.norionProfile = calcularPerfilNorion(lead);
    return lead;
  } catch (err: any) {
    console.log(`[CAF] Enriquecimento HTML falhou para ${lead.nufpa}: ${err.message}`);
    return lead;
  }
}

export function passaNosFiltos(lead: CafLead, job: CafCrawlerJob): boolean {
  if (job.apenasAtivos && lead.situacao !== 'ATIVA') return false;
  if (job.apenasProprietario) {
    const gp = (lead.grauParentesco || '').toLowerCase().trim();
    if (!gp.includes('declarante') && !gp.includes('responsável') && !gp.includes('responsavel') && !gp.includes('titular')) return false;
  }
  if (job.apenasComPronaf && !lead.enquadramentoPronaf) return false;
  if (job.areaMinHa > 0 && (lead.areaHa === null || lead.areaHa < job.areaMinHa)) return false;
  if (job.areaMaxHa > 0 && lead.areaHa !== null && lead.areaHa > job.areaMaxHa) return false;
  if (job.municipio && lead.municipio) {
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!norm(lead.municipio).includes(norm(job.municipio))) return false;
  }
  return true;
}

const jobsAtivos = new Map<string, { cancelar: boolean }>();

export async function executarCrawlerCAF(
  job: CafCrawlerJob,
  onProgresso: (job: CafCrawlerJob) => void,
  onLead: (lead: CafLead) => Promise<void>
): Promise<void> {
  const controle = { cancelar: false };
  jobsAtivos.set(job.id, controle);
  job.status = 'rodando';
  job.iniciadoEm = new Date().toISOString();

  if (job.modo === 'sequencial') {
    await executarModoSequencial(job, controle, onProgresso, onLead);
  } else {
    await executarModoPaginado(job, controle, onProgresso, onLead);
  }

  if (job.status === 'rodando') {
    job.status = 'concluido';
    job.concluidoEm = new Date().toISOString();
  }

  console.log(`[CAF] Varredura ${job.modo} finalizada: ${job.totalEncontrados} encontrados, ${job.totalSalvos} salvos, ${job.totalErros} erros`);
  onProgresso({ ...job });
  jobsAtivos.delete(job.id);
}

async function executarModoPaginado(
  job: CafCrawlerJob,
  controle: { cancelar: boolean },
  onProgresso: (job: CafCrawlerJob) => void,
  onLead: (lead: CafLead) => Promise<void>
): Promise<void> {
  job.modo = 'paginado';
  const idSituacao = job.apenasAtivos ? 1 : undefined;
  let pagina = 1;
  const maxRegistros = job.seqFim;
  const idUfpasProcessados = new Set<string>();
  let paginasVazias = 0;
  const maxPaginasEstimadas = Math.ceil(maxRegistros / PAGE_SIZE) + 10;

  console.log(`[CAF] Iniciando varredura paginada: UF=${job.uf}, maxRegistros=${maxRegistros}, filtro situação=${idSituacao || 'todos'}`);

  while (pagina <= maxPaginasEstimadas) {
    if (controle.cancelar) { job.status = 'pausado'; break; }
    if (idUfpasProcessados.size >= maxRegistros) {
      console.log(`[CAF] Atingiu limite de ${maxRegistros} UFPAs únicos, encerrando.`);
      break;
    }

    job.paginaAtual = pagina;
    job.totalPaginas = Math.ceil(maxRegistros / PAGE_SIZE);

    const result = await consultarApiPaginada({
      uf: job.uf,
      codigoMunicipio: job.codIBGE || undefined,
      idSituacao,
      pagina,
      tamanhoPagina: PAGE_SIZE,
    });

    if (!result.sucesso) {
      job.totalErros++;
      paginasVazias++;
      if (paginasVazias >= 3) {
        console.log(`[CAF] 3 páginas sem sucesso consecutivas, encerrando.`);
        job.mensagemErro = 'API indisponível após 3 tentativas sem sucesso';
        break;
      }
      await sleep((job.delayMs || DELAY_MS) * 2);
      continue;
    }

    if (result.dados.length === 0) {
      console.log(`[CAF] Página ${pagina} vazia, encerrando varredura.`);
      break;
    }

    paginasVazias = 0;
    const ufpaGroups = new Map<string, CafApiResult[]>();
    for (const item of result.dados) {
      const group = ufpaGroups.get(item.idUfpa) || [];
      group.push(item);
      ufpaGroups.set(item.idUfpa, group);
    }

    for (const [idUfpa, members] of ufpaGroups) {
      if (idUfpasProcessados.has(idUfpa)) continue;
      idUfpasProcessados.add(idUfpa);

      job.totalVaridos++;

      const declarante = members.find(m => {
        const gp = (m.grauParentesco || '').toLowerCase();
        return gp.includes('declarante') || gp.includes('responsável') || gp.includes('responsavel') || gp.includes('titular');
      }) || members[0];

      const outrosMembros = members
        .filter(m => m !== declarante)
        .map(m => ({ nome: m.nome, cpf: m.cpf, parentesco: m.grauParentesco }));

      let lead = apiResultToLead(declarante, outrosMembros, job.uf);

      if (lead.nufpa) {
        try {
          lead = await enriquecerLeadViaHtml(lead);
        } catch {}
        await sleep(job.delayMs || DELAY_MS);
      }

      job.totalEncontrados++;

      if (passaNosFiltos(lead, job)) {
        try {
          await onLead(lead);
          job.totalSalvos++;
        } catch (err: any) {
          console.error(`[CAF] Erro ao salvar lead ${lead.nufpa}: ${err.message}`);
          job.totalErros++;
        }
      }
    }

    job.progresso = pagina;
    onProgresso({ ...job });

    pagina++;
    await sleep(job.delayMs || DELAY_MS);
  }
}

async function executarModoSequencial(
  job: CafCrawlerJob,
  controle: { cancelar: boolean },
  onProgresso: (job: CafCrawlerJob) => void,
  onLead: (lead: CafLead) => Promise<void>
): Promise<void> {
  job.modo = 'sequencial';
  let consecutivos404 = 0;
  const total = job.seqFim - job.seqInicio + 1;

  console.log(`[CAF] Iniciando varredura sequencial: UF=${job.uf}, seq ${job.seqInicio}→${job.seqFim} (${total} NUFPAs)`);

  for (let seq = job.seqInicio; seq <= job.seqFim; seq++) {
    if (controle.cancelar) { job.status = 'pausado'; break; }

    const nufpa = montarNufpa(job.uf, job.ano, job.mes, seq);
    job.totalVaridos++;
    job.progresso = Math.round(((seq - job.seqInicio) / total) * 100);

    let lead = await consultarApiPaginada({
      numeroCaf: nufpa,
      pagina: 1,
      tamanhoPagina: 10,
    }).then(result => {
      if (result.sucesso && result.dados.length > 0) {
        const declarante = result.dados.find(d => {
          const gp = (d.grauParentesco || '').toLowerCase();
          return gp.includes('declarante') || gp.includes('responsável') || gp.includes('responsavel') || gp.includes('titular');
        }) || result.dados[0];

        const membros = result.dados
          .filter(d => d.idUfpa === declarante.idUfpa && d !== declarante)
          .map(d => ({ nome: d.nome, cpf: d.cpf, parentesco: d.grauParentesco }));

        return apiResultToLead(declarante, membros, job.uf);
      }
      return null;
    }).catch(() => null);

    if (!lead) {
      lead = await consultarHtmlScraping(nufpa);
    }

    if (!lead) {
      consecutivos404++;
      if (consecutivos404 >= MAX_404_CONSECUTIVOS) {
        console.log(`[CAF] ${MAX_404_CONSECUTIVOS} NUFPAs consecutivos sem resultado, encerrando.`);
        job.mensagemErro = `Parou após ${MAX_404_CONSECUTIVOS} NUFPAs consecutivos sem resultado`;
        break;
      }
      continue;
    }

    consecutivos404 = 0;
    job.totalEncontrados++;

    if (passaNosFiltos(lead, job)) {
      try {
        await onLead(lead);
        job.totalSalvos++;
      } catch (err: any) {
        console.error(`[CAF] Erro ao salvar lead ${lead.nufpa}: ${err.message}`);
        job.totalErros++;
      }
    }

    if (seq % 10 === 0) onProgresso({ ...job });
    await sleep(job.delayMs || DELAY_MS);
  }
}

export function cancelarJob(jobId: string) {
  const ctrl = jobsAtivos.get(jobId);
  if (ctrl) ctrl.cancelar = true;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
