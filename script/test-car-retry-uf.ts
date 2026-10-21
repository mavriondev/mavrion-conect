// Regressão — Imóveis CAR no Enriquecimento Completo:
// 1) derivação de UF do ativo (fallback pelas parcelas SIGEF / código IBGE);
// 2) retry com backoff na consulta ao GeoServer do SICAR (instável).
// Rodar: npx tsx script/test-car-retry-uf.ts
import assert from "node:assert";
import { resolveAssetUfs, extrairUfs, ufDeCodigoIbge } from "../server/lib/uf";

async function main() {
  // --- resolveAssetUfs ---
  assert.deepEqual(resolveAssetUfs({ estado: "MG" }), ["MG"]);
  assert.deepEqual(resolveAssetUfs({ estado: "Bahia - BA" }), ["BA"]);
  assert.deepEqual(resolveAssetUfs({ camposEspecificos: { anmLiveData: { UF: "PA" } } }), ["PA"]);
  // fallback: código IBGE de município das parcelas SIGEF (prefixo → UF)
  assert.deepEqual(
    resolveAssetUfs({ camposEspecificos: { sigefParcelas: { parcelas: [{ municipioIbge: 2927408 }] } } }),
    ["BA"],
  );
  // fallback: uf textual e uf_id numérico (código IBGE da UF, ex.: "31" = MG)
  assert.deepEqual(
    resolveAssetUfs({ camposEspecificos: { sigefParcelas: { parcelas: [{ uf: "MG" }, { uf: "MG" }] } } }),
    ["MG"],
  );
  assert.deepEqual(
    resolveAssetUfs({ camposEspecificos: { sigefParcelas: { parcelas: [{ uf: "31" }] } } }),
    ["MG"],
  );
  // duas UFs distintas via municípios
  const duas = resolveAssetUfs({
    camposEspecificos: { sigefParcelas: { parcelas: [{ municipioIbge: 2927408 }, { municipioIbge: 3106200 }] } },
  });
  assert.deepEqual([...duas].sort(), ["BA", "MG"]);
  // fallback: UFs da última consulta CAR
  assert.deepEqual(resolveAssetUfs({ camposEspecificos: { carImoveis: { ufsConsultadas: ["ES"] } } }), ["ES"]);
  // cadastro tem prioridade sobre fallback
  assert.deepEqual(
    resolveAssetUfs({ estado: "SP", camposEspecificos: { sigefParcelas: { parcelas: [{ municipioIbge: 2927408 }] } } }),
    ["SP"],
  );
  // nada resolvível → []
  assert.deepEqual(resolveAssetUfs({ camposEspecificos: {} }), []);
  assert.deepEqual(resolveAssetUfs({ estado: "Brasil" }), []);
  // helpers
  assert.equal(ufDeCodigoIbge("52"), "GO");
  assert.equal(ufDeCodigoIbge("9999999"), null);
  assert.equal(ufDeCodigoIbge(123), null);
  assert.deepEqual(extrairUfs("SP/MG"), ["SP", "MG"]);
  console.log("uf.ts: todos os casos OK");

  // --- retry do SICAR (fetch mockado; nenhuma chamada de rede real) ---
  const realFetch = globalThis.fetch;
  try {
    let chamadas = 0;
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          properties: { cod_imovel: "BA-123", municipio: "Teste", uf: "BA", area: 10, status_imovel: "AT", tipo_imovel: "IRU" },
          geometry: { type: "Polygon", coordinates: [[[-40.0005, -12.0005], [-39.9995, -12.0005], [-39.9995, -11.9995], [-40.0005, -11.9995], [-40.0005, -12.0005]]] },
        },
      ],
    };
    globalThis.fetch = (async () => {
      chamadas++;
      if (chamadas === 1) return new Response("erro", { status: 503 });
      if (chamadas === 2)
        return new Response("<ows:ExceptionReport><ows:ExceptionText>Falha simulada</ows:ExceptionText></ows:ExceptionReport>", { status: 200 });
      return new Response(JSON.stringify(fc), { status: 200 });
    }) as any;

    const { consultarImoveisCar } = await import("../server/lib/car-imoveis");
    const geom = { type: "Polygon", coordinates: [[[-40.001, -12.001], [-39.999, -12.001], [-39.999, -11.999], [-40.001, -11.999], [-40.001, -12.001]]] };

    // 503 + exceção XML c/ HTTP 200 são transitórias → sucesso na 3ª tentativa
    const r = await consultarImoveisCar(geom, ["BA"]);
    assert.equal(chamadas, 3, `esperava 3 chamadas, houve ${chamadas}`);
    assert.equal(r.disponivel, true);
    assert.equal(r.imoveis.length, 1);
    console.log("retry: sucesso após 503 + exceção XML OK");

    // 4xx é permanente: sem retry, erro específico preservado
    chamadas = 0;
    globalThis.fetch = (async () => { chamadas++; return new Response("bad request", { status: 400 }); }) as any;
    const r2 = await consultarImoveisCar(geom, ["BA"]);
    assert.equal(chamadas, 1, `400 não deve ter retry; houve ${chamadas}`);
    assert.equal(r2.disponivel, false);
    assert.ok(r2.erro && r2.erro.includes("400"), `erro deveria citar HTTP 400: ${r2.erro}`);
    console.log("sem retry em 4xx OK");

    // transitório persistente: esgota as 3 tentativas e devolve erro específico
    chamadas = 0;
    globalThis.fetch = (async () => { chamadas++; return new Response("erro", { status: 502 }); }) as any;
    const r3 = await consultarImoveisCar(geom, ["BA"]);
    assert.equal(chamadas, 3, `esperava 3 tentativas, houve ${chamadas}`);
    assert.equal(r3.disponivel, false);
    assert.ok(r3.erro && r3.erro.includes("502"), `erro deveria citar HTTP 502: ${r3.erro}`);
    console.log("3 tentativas esgotadas OK");
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log("car-imoveis retry: todos os casos OK");
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FALHA:", e?.message || e); process.exit(1); },
);
