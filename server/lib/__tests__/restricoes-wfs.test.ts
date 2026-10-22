import assert from "node:assert/strict";
import { consultarRestricaoWfs, FONTES_RESTRICOES } from "../restricoes-wfs";
import { descobrirCamadaWfs } from "../wfs-descoberta";

const originalFetch = globalThis.fetch;
const bbox = { minLon: -46.116, minLat: -18.611, maxLon: -46.059, maxLat: -18.556 };
const feature = (id: number, nome = "no_ti") => ({
  type: "Feature", id: `area.${id}`, properties: { [nome]: `Área ${id}` },
  geometry: { type: "Polygon", coordinates: [[[-46.11, -18.60], [-46.10, -18.60], [-46.10, -18.59], [-46.11, -18.60]]] },
});
const response = (features: any[], total: number | string = features.length) =>
  new Response(JSON.stringify({ type: "FeatureCollection", features, numberMatched: total }));
const silenciar = console.warn;
console.warn = () => {};

try {
  for (const camada of Object.keys(FONTES_RESTRICOES) as Array<keyof typeof FONTES_RESTRICOES>) {
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      assert.equal(url.origin + url.pathname, FONTES_RESTRICOES[camada].url);
      assert.equal(url.searchParams.get("typeNames"), FONTES_RESTRICOES[camada].camada);
      assert.equal(url.searchParams.get("bbox"), "-46.116,-18.611,-46.059,-18.556,CRS:84");
      assert.equal(url.searchParams.get("srsName"), "CRS:84");
      assert.equal(url.searchParams.get("version"), "2.0.0");
      assert.equal(url.searchParams.get("sortBy"), FONTES_RESTRICOES[camada].campoOrdenacao);
      assert.equal(url.searchParams.has("CQL_FILTER"), false); // nenhum nome de geometria presumido
      return response([feature(1, FONTES_RESTRICOES[camada].campoNome)]);
    };
    const r = await consultarRestricaoWfs(camada, bbox);
    assert.equal(r.ok, true);
    assert.equal(r.features.length, 1);
    assert.ok(r.evidencia.dataBase);
    assert.ok(r.evidencia.limitacoes);
    assert.ok(r.evidencia.consultadoEm);
  }
  // Mais de 50 feições e paginação completa, sem truncamento silencioso.
  let chamadas = 0;
  globalThis.fetch = async input => {
    const u = new URL(String(input));
    const inicio = Number(u.searchParams.get("startIndex"));
    assert.equal(inicio, chamadas * 200);
    chamadas++;
    return response(Array.from({ length: inicio === 0 ? 200 : 5 }, (_, n) => feature(inicio + n)), 205);
  };
  assert.equal((await consultarRestricaoWfs("terraIndigena", bbox)).features.length, 205);
  assert.equal(chamadas, 2);

  // Vazio de fonte válida é distinto de indisponibilidade.
  globalThis.fetch = async () => response([]);
  assert.equal((await consultarRestricaoWfs("terraIndigena", bbox)).ok, true);

  const falhas: Array<() => Promise<Response>> = [
    async () => { throw new TypeError("fetch failed"); },
    async () => { throw new DOMException("timeout", "TimeoutError"); },
    async () => new Response("indisponível", { status: 503 }),
    async () => new Response("<ExceptionReport>camada inválida</ExceptionReport>"),
    async () => new Response(JSON.stringify({ features: [] })), // HTTP 200 não basta
    async () => response([{ ...feature(1), geometry: null }]),
    async () => response([{ ...feature(1), properties: { n1: "schema novo" } }]),
    async () => response([], 1), // total indica resultado que não veio
    async () => response(Array.from({ length: 200 }, (_, n) => feature(n)), 401), // ignora startIndex
  ];
  for (const falha of falhas) {
    globalThis.fetch = falha;
    const r = await consultarRestricaoWfs("terraIndigena", bbox);
    assert.equal(r.ok, false);
    assert.deepEqual(r.features, []);
    assert.ok(r.evidencia.erro);
  }
  // Falha posterior não pode devolver as páginas já recebidas.
  chamadas = 0;
  globalThis.fetch = async () => ++chamadas === 1
    ? response(Array.from({ length: 200 }, (_, n) => feature(n)), 201)
    : new Response("erro", { status: 502 });
  assert.equal((await consultarRestricaoWfs("terraIndigena", bbox)).ok, false);

  // Limite de segurança nunca vira consulta completa.
  globalThis.fetch = async input => {
    const inicio = Number(new URL(String(input)).searchParams.get("startIndex"));
    return response(Array.from({ length: 200 }, (_, n) => feature(inicio + n)), "unknown");
  };
  const limite = await consultarRestricaoWfs("terraIndigena", bbox);
  assert.equal(limite.ok, false);
  assert.match(limite.evidencia.erro!, /limite/);
  assert.deepEqual(limite.features, []);

  globalThis.fetch = async () => { throw new Error("BBOX inválido não deve acessar rede"); };
  assert.equal((await consultarRestricaoWfs("terraIndigena", { ...bbox, minLon: NaN })).ok, false);

  // A descoberta respeita as preferências de cada chamada (cache separado).
  globalThis.fetch = async () => new Response(`<WFS_Capabilities><FeatureTypeList>
    <FeatureType><Name>x:ponto_assentamento</Name></FeatureType>
    <FeatureType><Name>x:poligono_assentamento</Name></FeatureType>
    </FeatureTypeList></WFS_Capabilities>`);
  const base = "https://exemplo.test/wfs";
  assert.equal(await descobrirCamadaWfs(base, /assentamento/i), "x:ponto_assentamento");
  assert.equal(await descobrirCamadaWfs(base, /assentamento/i, { evitar: /ponto/i }), "x:poligono_assentamento");
  assert.equal(await descobrirCamadaWfs(base, /assentamento/i, { preferir: /poligono/i }), "x:poligono_assentamento");
  console.log("restricoes-wfs: parâmetros, fontes, paginação, falhas e descoberta passaram");
} finally {
  globalThis.fetch = originalFetch;
  console.warn = silenciar;
}
