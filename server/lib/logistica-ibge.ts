// Rodovia e ferrovia mais próximas de um imóvel, pela Base Cartográfica Contínua do IBGE (WFS).
//
// Por que BC250 e não BC100: no GeoServer do IBGE as camadas genéricas "CCAR:BC100_Trecho_Rodoviario_L"
// e "CCAR:BC100_Trecho_Ferroviario_L" NÃO são nacionais — a extensão publicada cobre só o Centro-Oeste
// (lon −53,3..−45,7, lat −19,5..−12,3; a ferroviária tem 77 feições, todas no DF/GO). Fora dessa área o
// servidor responde HTTP 200 com zero feições, igualzinho a "não existe". Foi isso que marcou a fazenda de
// Patos de Minas/MG como "sem rodovia num raio de 33 km" com a BR-365 passando ao lado.
// A BC250 2025 ("CCAR:BC250_2025_rod_trecho_rodoviario_l" / "..._fer_trecho_ferroviario_l") é nacional.
//
// Regra de confiança: "não detectado" só sai quando (1) a camada passou num controle positivo — uma caixa
// pequena num ponto com rodovia/ferrovia conhecida devolveu feições — e (2) a caixa consultada está dentro
// da extensão publicada da camada. Qualquer outra situação (falha, fora da cobertura, extensão desconhecida)
// é "sem dado". Ordem dos eixos: neste servidor a BBOX com EPSG:4326 é lon,lat (validado com os controles).

import { distanciaAtePoligonoM } from "./geo-medicao";
import { extensaoCamadaWfs, caixaDentroDaExtensao, type ExtensaoWfs } from "./wfs-descoberta";
import { verificacaoAutomatica, type Verificacao } from "./confianca-dados";

export const IBGE_WFS = "https://geoservicos.ibge.gov.br/geoserver/wfs";
export const LIMITE_FEICOES_WFS = 1000;
/** Raio da busca normal (~33 km) e da busca ampliada quando nada aparece no raio normal (~110 km). */
export const MARGEM_GRAUS = 0.3;
export const MARGEM_AMPLA_GRAUS = 1.0;
const MEIA_CAIXA_CONTROLE_GRAUS = 0.02; // ~2 km de cada lado do ponto de controle

export type Malha = "rodovia" | "ferrovia";

export interface CamadaMalha {
  layer: string;
  fonte: string;
  nome: string;
  /** Ponto onde a malha comprovadamente existe (vértice real da própria camada, conferido em 22/10/2026). */
  controle: { lon: number; lat: number; descricao: string };
  nomeFeicao: (props: Record<string, unknown>) => string | null;
  /** Feições que contam como "principal" (ex.: rodovia pavimentada). O valor publicado é a principal mais próxima; sem nenhuma, vale a feição mais próxima de qualquer tipo. */
  principal?: { rotulo: string; filtro: (props: Record<string, unknown>) => boolean };
}

export const CAMADAS_MALHA: Record<Malha, CamadaMalha> = {
  rodovia: {
    layer: "CCAR:BC250_2025_rod_trecho_rodoviario_l",
    fonte: "IBGE BC250 2025 (CCAR:BC250_2025_rod_trecho_rodoviario_l)",
    nome: "Rodovia",
    controle: { lon: -46.5787, lat: -18.687, descricao: "BR-365/BR-352 junto a Patos de Minas/MG" },
    nomeFeicao: (p) => {
      const sigla = typeof p.sigla === "string" && p.sigla.trim() ? p.sigla.trim() : null;
      const jur = typeof p.jurisdicao === "string" && p.jurisdicao !== "Desconhecida" ? p.jurisdicao : null;
      const rev = typeof p.revestimento === "string" ? p.revestimento : null;
      return [sigla ?? "via sem sigla", jur, rev].filter(Boolean).join(", ");
    },
    principal: { rotulo: "pavimentada", filtro: (p) => p.revestimento === "Pavimentado" },
  },
  ferrovia: {
    layer: "CCAR:BC250_2025_fer_trecho_ferroviario_l",
    fonte: "IBGE BC250 2025 (CCAR:BC250_2025_fer_trecho_ferroviario_l)",
    nome: "Ferrovia",
    controle: { lon: -46.823, lat: -19.0289, descricao: "Ferrovia Centro-Atlântica (EF-045) perto de Serra do Salitre/MG" },
    nomeFeicao: (p) => {
      const nome = typeof p.nome === "string" && p.nome.trim() ? p.nome.trim() : null;
      const cod = typeof p.codtrechoferrov === "string" && p.codtrechoferrov.trim() ? p.codtrechoferrov.trim() : null;
      const op = p.operacional === "Não" ? "não operacional" : null;
      return [nome ?? cod ?? "trecho sem nome", nome && cod ? cod : null, op].filter(Boolean).join(", ");
    },
  },
};

export interface RespostaWfs { ok: boolean; features: any[]; truncado: boolean; numberMatched?: number | null }

/** Consulta WFS distinguindo FALHA (ok:false) de "nenhuma feição" (ok:true, features vazio). BBOX em lon,lat. */
export async function consultarWfsIbge(typeName: string, caixa: ExtensaoWfs, baseUrl = IBGE_WFS): Promise<RespostaWfs> {
  try {
    const params = new URLSearchParams({
      service: "WFS", version: "2.0.0", request: "GetFeature", typeName,
      outputFormat: "application/json", srsName: "EPSG:4326", count: String(LIMITE_FEICOES_WFS),
      bbox: `${caixa.minLon},${caixa.minLat},${caixa.maxLon},${caixa.maxLat},EPSG:4326`,
    });
    const r = await fetch(`${baseUrl}?${params}`, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { ok: false, features: [], truncado: false };
    const j: any = await r.json();
    if (!Array.isArray(j?.features)) return { ok: false, features: [], truncado: false };
    const numberMatched = typeof j.numberMatched === "number" ? j.numberMatched : null;
    return { ok: true, features: j.features, truncado: j.features.length >= LIMITE_FEICOES_WFS, numberMatched };
  } catch {
    return { ok: false, features: [], truncado: false };
  }
}

export function caixaEmTorno(lon: number, lat: number, meia: number): ExtensaoWfs {
  return { minLon: lon - meia, minLat: lat - meia, maxLon: lon + meia, maxLat: lat + meia };
}
export function caixaComMargem(bbox: ExtensaoWfs, margem: number): ExtensaoWfs {
  return { minLon: bbox.minLon - margem, minLat: bbox.minLat - margem, maxLon: bbox.maxLon + margem, maxLat: bbox.maxLat + margem };
}

export interface FontesMalha {
  wfs: (typeName: string, caixa: ExtensaoWfs) => Promise<RespostaWfs>;
  extensao: (typeName: string) => Promise<ExtensaoWfs | null>;
  agora?: () => number;
}

const fontesReais: FontesMalha = {
  wfs: (t, c) => consultarWfsIbge(t, c),
  extensao: (t) => extensaoCamadaWfs(IBGE_WFS, t),
};

// Controle positivo por camada: sucesso vale 6 h; falha não fica em cache (tenta de novo na próxima).
const CONTROLE_OK_MS = 6 * 3600 * 1000;
const controleCache = new Map<string, number>();

export type ResultadoControle = { confiavel: true } | { confiavel: false; motivo: string };

/** A camada devolve feições onde sabidamente há malha? Se não, nenhuma resposta vazia dela pode ser lida como ausência. */
export async function controlePositivo(cam: CamadaMalha, fontes: FontesMalha = fontesReais): Promise<ResultadoControle> {
  const agora = fontes.agora ? fontes.agora() : Date.now();
  const ok = controleCache.get(cam.layer);
  if (ok && ok > agora) return { confiavel: true };
  const r = await fontes.wfs(cam.layer, caixaEmTorno(cam.controle.lon, cam.controle.lat, MEIA_CAIXA_CONTROLE_GRAUS));
  if (!r.ok) return { confiavel: false, motivo: `Controle positivo não respondeu (${cam.controle.descricao}).` };
  if (r.features.length === 0) {
    return { confiavel: false, motivo: `Controle positivo falhou: a camada devolveu zero feições em ${cam.controle.descricao} — a consulta não pode ser confiada.` };
  }
  controleCache.set(cam.layer, agora + CONTROLE_OK_MS);
  return { confiavel: true };
}

export function limparCacheControle(): void { controleCache.clear(); }

export interface MaisProxima { distanciaM: number; nome: string | null }

/** Feição mais próxima do polígono (distância pela divisa; 0 quando cruza o imóvel). */
export function maisProxima(geojson: any, features: any[], nomeFeicao: CamadaMalha["nomeFeicao"], filtro?: (props: Record<string, unknown>) => boolean): MaisProxima | null {
  let melhor: MaisProxima | null = null;
  for (const f of features) {
    if (!f?.geometry) continue;
    if (filtro && !filtro(f.properties || {})) continue;
    const d = distanciaAtePoligonoM(geojson, { type: "FeatureCollection", features: [f] });
    if (d === null) continue;
    if (!melhor || d < melhor.distanciaM) melhor = { distanciaM: d, nome: nomeFeicao(f.properties || {}) };
  }
  return melhor;
}

export interface AtivoParaMalha { geojson: any; bbox: ExtensaoWfs }

/**
 * Verificação de uma malha (rodovia ou ferrovia) para um imóvel.
 *  - detectado: distância até a feição mais próxima (raio ~33 km; se vazio, tenta ~110 km e avisa).
 *  - nao_detectado: só com controle positivo OK, caixa dentro da extensão publicada e busca ampliada vazia.
 *  - indeterminado (sem dado): falha, controle reprovado, extensão desconhecida ou caixa fora da cobertura.
 */
export async function verificarMalha(a: AtivoParaMalha, malha: Malha, fontes: FontesMalha = fontesReais): Promise<Verificacao> {
  const cam = CAMADAS_MALHA[malha];
  const chave = `logistica_${malha}`;
  const sem = (observacao: string) => verificacaoAutomatica({ chave, achado: "indeterminado", fonte: cam.fonte, observacao });

  const controle = await controlePositivo(cam, fontes);
  if (!controle.confiavel) return sem(controle.motivo);

  const caixa = caixaComMargem(a.bbox, MARGEM_GRAUS);
  const w = await fontes.wfs(cam.layer, caixa);
  if (!w.ok) return sem("Camada não respondeu.");

  const avisoEscala = `Camada 1:250.000 (BC250 2025); distância da divisa até a feição mais próxima, não indica qualidade de acesso.`;
  const detectado = (resp: RespostaWfs, prefixo?: string): Verificacao | null => {
    const qualquer = maisProxima(a.geojson, resp.features, cam.nomeFeicao);
    if (!qualquer) return null;
    const principal = cam.principal ? maisProxima(a.geojson, resp.features, cam.nomeFeicao, cam.principal.filtro) : null;
    const escolhida = principal ?? qualquer;
    const fmt = (m: number) => (m === 0 ? "cruza ou toca o imóvel" : m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m)} m`);
    const partes: Array<string | null> = [prefixo ?? null];
    if (cam.principal) {
      partes.push(principal
        ? `${cam.nome} ${cam.principal.rotulo} mais próxima: ${principal.nome} — ${fmt(principal.distanciaM)}.`
        : `Nenhuma ${cam.nome.toLowerCase()} ${cam.principal.rotulo} na área consultada; o valor é a via mais próxima de qualquer tipo.`);
      if (!principal || qualquer.distanciaM < principal.distanciaM) partes.push(`Via mais próxima de qualquer tipo: ${qualquer.nome} — ${fmt(qualquer.distanciaM)}.`);
    } else partes.push(`Mais próxima: ${escolhida.nome} — ${fmt(escolhida.distanciaM)}.`);
    partes.push(avisoEscala, resp.truncado ? "Limite de feições da consulta atingido — a distância pode estar superestimada." : null);
    return verificacaoAutomatica({
      chave, achado: "detectado", valor: Math.round(escolhida.distanciaM), unidade: "m", fonte: cam.fonte,
      observacao: partes.filter(Boolean).join(" "),
    });
  };
  const perto = detectado(w);
  if (perto) return perto;

  // Vazio no raio normal: só vale como "não há" se a camada cobre a área consultada.
  const extensao = await fontes.extensao(cam.layer);
  if (!extensao) return sem("Zero feições num raio de ~33 km e extensão da camada desconhecida (GetCapabilities falhou) — não dá para distinguir ausência de falta de cobertura.");
  if (!caixaDentroDaExtensao(caixa, extensao)) {
    return sem(`Zero feições num raio de ~33 km, mas a área consultada está fora da extensão publicada da camada (lon ${extensao.minLon.toFixed(1)}..${extensao.maxLon.toFixed(1)}, lat ${extensao.minLat.toFixed(1)}..${extensao.maxLat.toFixed(1)}) — falta de cobertura, não ausência.`);
  }

  const ampla = await fontes.wfs(cam.layer, caixaComMargem(a.bbox, MARGEM_AMPLA_GRAUS));
  if (!ampla.ok) return sem("Zero feições num raio de ~33 km; a busca ampliada (~110 km) não respondeu.");
  const longe = detectado(ampla, `Nenhuma ${cam.nome.toLowerCase()} num raio de ~33 km; a mais próxima foi encontrada na busca ampliada (~110 km).`);
  if (longe) return longe;
  return verificacaoAutomatica({
    chave, achado: "nao_detectado", fonte: cam.fonte,
    observacao: `Nenhuma ${cam.nome.toLowerCase()} mapeada na BC250 2025 num raio de ~110 km (camada cobre a área e passou no controle positivo). Não prova ausência de vias fora da base 1:250.000.`,
  });
}
