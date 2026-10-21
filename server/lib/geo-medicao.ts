// Medições geográficas puras (sem rede) — testáveis sem API.
//
// Por que existe: o cálculo antigo em routes/geo.ts amostrava a altitude só nos vértices do
// CONTORNO, media a distância a partir do CENTRO até os VÉRTICES das linhas e tratava
// "qualquer linha num raio de ~11 km" como "tem rio/energia". Aqui:
//  - amostra pontos no INTERIOR do polígono;
//  - distância é da BORDA do imóvel até a feição (0 quando toca ou está dentro);
//  - declividade vem de vizinhos próximos, não de cordas do perímetro;
//  - o score ignora categorias sem dado (ausência de dado não é nota zero).
//
// Convenção: pontos são [lat, lng]; GeoJSON é [lng, lat].

export type Ponto = [number, number];

const R_TERRA_M = 6371000;
const RAD = Math.PI / 180;

export function distanciaHaversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return R_TERRA_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Anel = Array<[number, number]>; // [lng, lat]

/** Anéis externos de Polygon/MultiPolygon (aceita Feature ou geometria). Buracos são ignorados. */
export function aneisExternos(geojson: any): Anel[] {
  const geom = geojson?.geometry || geojson;
  if (!geom?.coordinates) return [];
  const limpa = (r: any): Anel =>
    Array.isArray(r)
      ? (r.filter((p: any) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") as Anel)
      : [];
  if (geom.type === "Polygon") return [limpa(geom.coordinates[0])].filter((r) => r.length >= 3);
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.map((poly: any) => limpa(poly?.[0])).filter((r: Anel) => r.length >= 3);
  }
  return [];
}

function pontoNoAnel(lng: number, lat: number, anel: Anel): boolean {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i];
    const [xj, yj] = anel[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function pontoNosAneis(lng: number, lat: number, aneis: Anel[]): boolean {
  return aneis.some((a) => pontoNoAnel(lng, lat, a));
}

/** Centro aproximado (média dos vértices do primeiro anel) — só para referência. */
function centroDosAneis(aneis: Anel[]): { lat: number; lng: number } | null {
  const a = aneis[0];
  if (!a?.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of a) {
    sx += x;
    sy += y;
  }
  return { lng: sx / a.length, lat: sy / a.length };
}

/**
 * Pontos de amostra DENTRO do polígono, em grade regular (ordem linha a linha).
 * Retorna até `max` pontos [lat, lng]. Se o imóvel for minúsculo, devolve ao menos 1 ponto interno.
 */
export function amostrarInterior(geojson: any, max = 100): Ponto[] {
  const aneis = aneisExternos(geojson);
  if (aneis.length === 0 || max < 1) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of aneis) {
    for (const [x, y] of a) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX) || !isFinite(minY)) return [];

  let k = Math.max(3, Math.ceil(Math.sqrt(max * 1.6)));
  let dentro: Ponto[] = [];
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    dentro = [];
    for (let iy = 0; iy < k; iy++) {
      const lat = minY + ((iy + 0.5) / k) * (maxY - minY);
      for (let ix = 0; ix < k; ix++) {
        const lng = minX + ((ix + 0.5) / k) * (maxX - minX);
        if (pontoNosAneis(lng, lat, aneis)) dentro.push([lat, lng]);
      }
    }
    if (dentro.length >= Math.min(max, 8) || k >= 90) break;
    k = Math.ceil(k * 1.6); // polígono fino/irregular: refina a grade
  }

  if (dentro.length === 0) {
    const c = centroDosAneis(aneis);
    if (c && pontoNosAneis(c.lng, c.lat, aneis)) return [[c.lat, c.lng]];
    const [x, y] = aneis[0][0];
    return [[y, x]];
  }
  if (dentro.length <= max) return dentro;
  const passo = dentro.length / max;
  const saida: Ponto[] = [];
  for (let i = 0; i < max; i++) saida.push(dentro[Math.floor(i * passo)]);
  return saida;
}

// ---------- distância borda do imóvel -> feições ----------

type Seg = [number, number, number, number]; // x1,y1,x2,y2 (metros)

function distPontoSegmento(px: number, py: number, s: Seg): number {
  const [x1, y1, x2, y2] = s;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentosSeCruzam(a: Seg, b: Seg): boolean {
  const [ax, ay, bx, by] = a;
  const [cx, cy, dx, dy] = b;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function distSegmentoSegmento(a: Seg, b: Seg): number {
  if (segmentosSeCruzam(a, b)) return 0;
  return Math.min(
    distPontoSegmento(a[0], a[1], b),
    distPontoSegmento(a[2], a[3], b),
    distPontoSegmento(b[0], b[1], a),
    distPontoSegmento(b[2], b[3], a),
  );
}

interface Parte {
  coords: Array<[number, number]>; // [lng, lat]
  fechada: boolean; // anel de área (lago/represa)
}

function partesDaFeicao(geom: any): Parte[] {
  if (!geom?.coordinates) return [];
  const ok = (p: any) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number";
  const linha = (c: any): Array<[number, number]> => (Array.isArray(c) ? c.filter(ok) : []);
  switch (geom.type) {
    case "Point":
      return ok(geom.coordinates) ? [{ coords: [geom.coordinates], fechada: false }] : [];
    case "MultiPoint":
      return linha(geom.coordinates).map((p) => ({ coords: [p], fechada: false }));
    case "LineString":
      return [{ coords: linha(geom.coordinates), fechada: false }];
    case "MultiLineString":
      return geom.coordinates.map((l: any) => ({ coords: linha(l), fechada: false }));
    case "Polygon":
      return [{ coords: linha(geom.coordinates[0]), fechada: true }];
    case "MultiPolygon":
      return geom.coordinates.map((p: any) => ({ coords: linha(p?.[0]), fechada: true }));
    default:
      return [];
  }
}

/**
 * Menor distância (m) entre o IMÓVEL (polígono) e as feições. 0 quando a feição toca, cruza ou
 * está dentro do imóvel (ex.: córrego que atravessa a fazenda). null quando não há feição válida.
 */
export function distanciaAtePoligonoM(geojson: any, colecao: any): number | null {
  const aneis = aneisExternos(geojson);
  const feicoes: any[] = colecao?.features || [];
  if (aneis.length === 0 || feicoes.length === 0) return null;

  const ref = centroDosAneis(aneis)!;
  const cosLat = Math.cos(ref.lat * RAD);
  const proj = (lng: number, lat: number): [number, number] => [
    R_TERRA_M * (lng - ref.lng) * RAD * cosLat,
    R_TERRA_M * (lat - ref.lat) * RAD,
  ];

  const segsImovel: Seg[] = [];
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const anel of aneis) {
    const pts = anel.map(([lng, lat]) => proj(lng, lat));
    for (const [x, y] of pts) {
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      segsImovel.push([p[0], p[1], q[0], q[1]]);
    }
  }

  let melhor = Infinity;
  let viuAlgo = false;

  for (const f of feicoes) {
    for (const parte of partesDaFeicao(f?.geometry)) {
      if (parte.coords.length === 0) continue;
      viuAlgo = true;
      const pts = parte.coords.map(([lng, lat]) => proj(lng, lat));

      // limite inferior pela caixa envolvente: descarta feições claramente mais longe que a melhor
      let px0 = Infinity;
      let py0 = Infinity;
      let px1 = -Infinity;
      let py1 = -Infinity;
      for (const [x, y] of pts) {
        if (x < px0) px0 = x;
        if (x > px1) px1 = x;
        if (y < py0) py0 = y;
        if (y > py1) py1 = y;
      }
      const gapX = Math.max(0, px0 - bx1, bx0 - px1);
      const gapY = Math.max(0, py0 - by1, by0 - py1);
      if (Math.hypot(gapX, gapY) >= melhor) continue;

      // vértice da feição dentro do imóvel => 0
      let dentro = false;
      for (let i = 0; i < parte.coords.length; i++) {
        if (pontoNosAneis(parte.coords[i][0], parte.coords[i][1], aneis)) {
          dentro = true;
          break;
        }
      }
      if (dentro) return 0;

      // imóvel dentro de um lago/represa => 0
      if (parte.fechada && parte.coords.length >= 3) {
        const anelFeicao = parte.coords as Anel;
        if (aneis.some((a) => a.length > 0 && pontoNoAnel(a[0][0], a[0][1], anelFeicao))) return 0;
      }

      if (pts.length === 1) {
        for (const s of segsImovel) {
          const d = distPontoSegmento(pts[0][0], pts[0][1], s);
          if (d < melhor) melhor = d;
        }
        continue;
      }

      const total = parte.fechada ? pts.length : pts.length - 1;
      for (let i = 0; i < total; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        const sf: Seg = [p[0], p[1], q[0], q[1]];
        for (const si of segsImovel) {
          const d = distSegmentoSegmento(sf, si);
          if (d === 0) return 0;
          if (d < melhor) melhor = d;
        }
      }
    }
  }

  if (!viuAlgo || !isFinite(melhor)) return null;
  return Math.round(melhor);
}

// ---------- relevo ----------

export interface EstatisticaAltitude {
  media: number | null;
  min: number | null;
  max: number | null;
  amostras: number;
}

export function estatisticasAltitude(elev: Array<number | null | undefined>): EstatisticaAltitude {
  const v = elev.filter((e): e is number => typeof e === "number" && isFinite(e));
  if (v.length === 0) return { media: null, min: null, max: null, amostras: 0 };
  return {
    media: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    min: Math.min(...v),
    max: Math.max(...v),
    amostras: v.length,
  };
}

/**
 * Declividade média estimada (%), usando o vizinho mais próximo de cada ponto amostrado.
 * Com amostragem espaçada (centenas de metros) ela SUAVIZA o relevo: serve para classificar
 * "plano / ondulado", não para projeto de terraceamento. null com menos de 4 pontos válidos.
 */
export function declividadeMediaPct(pontos: Ponto[], elev: Array<number | null | undefined>): number | null {
  const itens: Array<{ lat: number; lng: number; h: number }> = [];
  for (let i = 0; i < pontos.length; i++) {
    const h = elev[i];
    if (typeof h === "number" && isFinite(h)) itens.push({ lat: pontos[i][0], lng: pontos[i][1], h });
  }
  if (itens.length < 4) return null;

  let soma = 0;
  let n = 0;
  for (let i = 0; i < itens.length; i++) {
    let melhorD = Infinity;
    let melhorJ = -1;
    for (let j = 0; j < itens.length; j++) {
      if (i === j) continue;
      const d = distanciaHaversineM(itens[i].lat, itens[i].lng, itens[j].lat, itens[j].lng);
      if (d >= 20 && d < melhorD) {
        melhorD = d;
        melhorJ = j;
      }
    }
    if (melhorJ >= 0) {
      soma += (Math.abs(itens[i].h - itens[melhorJ].h) / melhorD) * 100;
      n++;
    }
  }
  return n > 0 ? Math.round((soma / n) * 10) / 10 : null;
}

// ---------- pontuação ----------

export interface EntradaScoreGeo {
  temRio: boolean;
  temLago: boolean;
  distAguaM: number | null;
  temEnergia: boolean;
  distEnergiaM: number | null;
  altMedia: number | null;
  declivMed: number | null;
  areaHa: number | null;
}

export interface ResultadoScoreGeo {
  /** 0-100 sobre as categorias COM dado; null quando há dado de menos (< 50% do peso total). */
  score: number | null;
  breakdown: Record<string, number>;
  /** Fração do peso total (0-1) que tinha dado. */
  confianca: number;
  /** Categorias que NÃO entraram no cálculo por falta de dado. */
  semDado: string[];
}

export function pontuarGeo(d: EntradaScoreGeo): ResultadoScoreGeo {
  const breakdown: Record<string, number> = {};
  const semDado: string[] = [];
  let pontos = 0;
  let pesoConhecido = 0;

  const somar = (nome: string, conhecido: boolean, max: number, valor: number) => {
    if (!conhecido) {
      semDado.push(nome);
      return;
    }
    breakdown[nome] = valor;
    pontos += valor;
    pesoConhecido += max;
  };

  const aguaConhecida = d.temRio || d.temLago || d.distAguaM !== null;
  let agua = 0;
  if (d.temRio || d.temLago) agua = d.temRio && d.temLago ? 30 : 25;
  else if (d.distAguaM !== null) agua = d.distAguaM < 500 ? 15 : d.distAguaM < 2000 ? 5 : 0;
  somar("agua", aguaConhecida, 30, agua);

  const energiaConhecida = d.temEnergia || d.distEnergiaM !== null;
  let energia = 0;
  if (d.distEnergiaM !== null) energia = d.distEnergiaM < 1000 ? 25 : d.distEnergiaM < 5000 ? 15 : 5;
  else if (d.temEnergia) energia = 25;
  somar("energia", energiaConhecida, 25, energia);

  let altitude = 5;
  if (d.altMedia !== null) {
    if (d.altMedia >= 200 && d.altMedia <= 800) altitude = 20;
    else if (d.altMedia > 800 && d.altMedia <= 1200) altitude = 15;
  }
  somar("altitude", d.altMedia !== null, 20, altitude);

  let decliv = 0;
  if (d.declivMed !== null) decliv = d.declivMed < 8 ? 10 : d.declivMed < 15 ? 5 : 0;
  somar("decliv", d.declivMed !== null, 10, decliv);

  let area = 5;
  if (d.areaHa !== null) {
    if (d.areaHa > 1000) area = 15;
    else if (d.areaHa > 500) area = 12;
    else if (d.areaHa > 100) area = 8;
  }
  somar("area", d.areaHa !== null, 15, area);

  const confianca = Math.round((pesoConhecido / 100) * 100) / 100;
  const score = pesoConhecido >= 50 ? Math.min(100, Math.round((pontos / pesoConhecido) * 100)) : null;
  return { score, breakdown, confianca, semDado };
}

/** "ALTA/MEDIA/BAIXA" só quando há dado; sem distância e sem registro => null (nunca "BAIXA" por falta de dado). */
export function classificarEnergia(distM: number | null, temEnergia: boolean): string | null {
  if (distM === null) return temEnergia ? "ALTA" : null;
  if (distM < 1000) return "ALTA";
  if (distM < 5000) return "MEDIA";
  return "BAIXA";
}

// ---------- resumo único usado pelas análises do Connect ----------

/** Rede elétrica mapeada até esta distância da divisa conta como "energia próxima". */
export const LIMITE_ENERGIA_PROXIMA_M = 1000;

export interface EntradaResumoGeo {
  geometry: any;
  areaHa: number | null;
  /** Pontos amostrados (de amostrarInterior) e elevações ALINHADAS a eles (null quando a API não respondeu). */
  pontos: Ponto[];
  elevacoes: Array<number | null | undefined>;
  /** FeatureCollections: cursos d'água (linhas), corpos d'água (áreas) e linhas de energia. */
  rios: any;
  lagos: any;
  energia: any;
}

export interface ResumoGeo extends ResultadoScoreGeo {
  /** Rio/lago que toca ou atravessa o imóvel (distância 0). NÃO é "algum rio na região". */
  temRio: boolean;
  temLago: boolean;
  /** Rede de energia mapeada a até LIMITE_ENERGIA_PROXIMA_M da divisa. */
  temEnergia: boolean;
  distRioM: number | null;
  distLagoM: number | null;
  distAguaM: number | null;
  distEnergiaM: number | null;
  scoreEnergia: string | null;
  altMin: number | null;
  altMax: number | null;
  altMedia: number | null;
  declivMed: number | null;
  amostrasAltitude: number;
}

export function resumirGeo(e: EntradaResumoGeo): ResumoGeo {
  const distRioM = distanciaAtePoligonoM(e.geometry, e.rios);
  const distLagoM = distanciaAtePoligonoM(e.geometry, e.lagos);
  const distAguaM = [distRioM, distLagoM].filter((v): v is number => v !== null).reduce<number | null>(
    (menor, v) => (menor === null || v < menor ? v : menor),
    null,
  );
  const distEnergiaM = distanciaAtePoligonoM(e.geometry, e.energia);

  const temRio = distRioM === 0;
  const temLago = distLagoM === 0;
  const temEnergia = distEnergiaM !== null && distEnergiaM <= LIMITE_ENERGIA_PROXIMA_M;

  const alt = estatisticasAltitude(e.elevacoes);
  const declivMed = declividadeMediaPct(e.pontos, e.elevacoes);

  const pontuacao = pontuarGeo({
    temRio,
    temLago,
    distAguaM,
    temEnergia,
    distEnergiaM,
    altMedia: alt.media,
    declivMed,
    areaHa: e.areaHa,
  });

  return {
    ...pontuacao,
    temRio,
    temLago,
    temEnergia,
    distRioM,
    distLagoM,
    distAguaM,
    distEnergiaM,
    scoreEnergia: classificarEnergia(distEnergiaM, temEnergia),
    altMin: alt.min,
    altMax: alt.max,
    altMedia: alt.media,
    declivMed,
    amostrasAltitude: alt.amostras,
  };
}

/** Separa corpos d'água de cursos d'água numa coleção do OpenStreetMap (propriedade natural=water/lake/reservoir). */
export function separarAguaOsm(colecao: any): { rios: any; lagos: any } {
  const todas: any[] = colecao?.features || [];
  const ehLago = (f: any) => ["water", "lake", "reservoir"].includes(f?.properties?.natural);
  return {
    rios: { type: "FeatureCollection", features: todas.filter((f) => !ehLago(f)) },
    lagos: { type: "FeatureCollection", features: todas.filter(ehLago) },
  };
}
