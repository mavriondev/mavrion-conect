// Testes de geo-medicao — rodar com: npx tsx server/lib/__tests__/geo-medicao.test.ts
import assert from "node:assert";
import {
  amostrarInterior,
  aneisExternos,
  classificarEnergia,
  declividadeMediaPct,
  distanciaAtePoligonoM,
  estatisticasAltitude,
  pontuarGeo,
  resumirGeo,
  separarAguaOsm,
} from "../geo-medicao";

// Imóvel quadrado de ~4 km x ~4 km perto de -16.7, -43.0 (norte de MG)
const LAT0 = -16.7;
const LNG0 = -43.0;
const GRAU = 0.036; // ~4 km
const imovel = {
  type: "Polygon",
  coordinates: [
    [
      [LNG0, LAT0],
      [LNG0 + GRAU, LAT0],
      [LNG0 + GRAU, LAT0 + GRAU],
      [LNG0, LAT0 + GRAU],
      [LNG0, LAT0],
    ],
  ],
};
const M_POR_GRAU_LAT = 111195;
const fc = (...geoms: any[]) => ({ type: "FeatureCollection", features: geoms.map((geometry) => ({ type: "Feature", geometry, properties: {} })) });

// ---- amostragem interna ----
{
  const pts = amostrarInterior(imovel, 100);
  assert.ok(pts.length >= 40 && pts.length <= 100, `esperava 40-100 pontos, veio ${pts.length}`);
  const aneis = aneisExternos(imovel);
  for (const [lat, lng] of pts) {
    assert.ok(lng > LNG0 && lng < LNG0 + GRAU && lat > LAT0 && lat < LAT0 + GRAU, "ponto fora do imóvel");
  }
  assert.ok(aneis.length === 1);

  // polígono em "L" (côncavo): nenhum ponto pode cair no recorte vazio
  const L = {
    type: "Polygon",
    coordinates: [[[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]].map(([x, y]) => [LNG0 + x * 0.02, LAT0 + y * 0.02])],
  };
  const ptsL = amostrarInterior(L, 60);
  assert.ok(ptsL.length > 10);
  for (const [lat, lng] of ptsL) {
    const x = (lng - LNG0) / 0.02;
    const y = (lat - LAT0) / 0.02;
    assert.ok(!(x > 1 && y > 1), "ponto caiu no recorte do L");
  }

  // imóvel minúsculo: devolve ao menos 1 ponto
  const mini = { type: "Polygon", coordinates: [[[LNG0, LAT0], [LNG0 + 0.0001, LAT0], [LNG0 + 0.0001, LAT0 + 0.0001], [LNG0, LAT0 + 0.0001], [LNG0, LAT0]]] };
  assert.ok(amostrarInterior(mini, 100).length >= 1);
  assert.deepEqual(amostrarInterior({ type: "Point", coordinates: [0, 0] }, 10), []);
}

// ---- distância borda -> feição ----
{
  // córrego que ATRAVESSA a fazenda => 0 (o método antigo media do centro até os vértices)
  const atravessa = { type: "LineString", coordinates: [[LNG0 - 0.05, LAT0 + GRAU / 2], [LNG0 + GRAU + 0.05, LAT0 + GRAU / 2]] };
  assert.equal(distanciaAtePoligonoM(imovel, fc(atravessa)), 0);

  // linha elétrica paralela, 1 km ao norte da divisa
  const umKmGrau = 1000 / M_POR_GRAU_LAT;
  const norte = { type: "LineString", coordinates: [[LNG0 - 0.05, LAT0 + GRAU + umKmGrau], [LNG0 + GRAU + 0.05, LAT0 + GRAU + umKmGrau]] };
  const d1 = distanciaAtePoligonoM(imovel, fc(norte))!;
  assert.ok(Math.abs(d1 - 1000) < 20, `esperava ~1000 m, veio ${d1}`);

  // linha longa com só 2 vértices, passando a 500 m da divisa: medir vértices daria dezenas de km
  const meioKm = 500 / M_POR_GRAU_LAT;
  const longa = { type: "LineString", coordinates: [[LNG0 - 0.5, LAT0 - meioKm], [LNG0 + 0.5, LAT0 - meioKm]] };
  const d2 = distanciaAtePoligonoM(imovel, fc(longa))!;
  assert.ok(Math.abs(d2 - 500) < 20, `esperava ~500 m, veio ${d2}`);

  // ponto dentro => 0; ponto a ~300 m
  assert.equal(distanciaAtePoligonoM(imovel, fc({ type: "Point", coordinates: [LNG0 + GRAU / 2, LAT0 + GRAU / 2] })), 0);
  const tresCem = 300 / M_POR_GRAU_LAT;
  const dp = distanciaAtePoligonoM(imovel, fc({ type: "Point", coordinates: [LNG0 + GRAU / 2, LAT0 - tresCem] }))!;
  assert.ok(Math.abs(dp - 300) < 10, `esperava ~300 m, veio ${dp}`);

  // represa que engloba a fazenda inteira => 0
  const represa = { type: "Polygon", coordinates: [[[LNG0 - 1, LAT0 - 1], [LNG0 + 1, LAT0 - 1], [LNG0 + 1, LAT0 + 1], [LNG0 - 1, LAT0 + 1], [LNG0 - 1, LAT0 - 1]]] };
  assert.equal(distanciaAtePoligonoM(imovel, fc(represa)), 0);

  // lago pequeno fora, ~2 km a leste
  const doisKmGrau = 2000 / (M_POR_GRAU_LAT * Math.cos((LAT0 * Math.PI) / 180));
  const lagoLeste = { type: "Polygon", coordinates: [[[LNG0 + GRAU + doisKmGrau, LAT0 + 0.01], [LNG0 + GRAU + doisKmGrau + 0.005, LAT0 + 0.01], [LNG0 + GRAU + doisKmGrau + 0.005, LAT0 + 0.015], [LNG0 + GRAU + doisKmGrau, LAT0 + 0.015], [LNG0 + GRAU + doisKmGrau, LAT0 + 0.01]]] };
  const dl = distanciaAtePoligonoM(imovel, fc(lagoLeste))!;
  assert.ok(Math.abs(dl - 2000) < 30, `esperava ~2000 m, veio ${dl}`);

  // a mais próxima vence
  assert.equal(distanciaAtePoligonoM(imovel, fc(norte, atravessa)), 0);

  // sem feição => null (desconhecido, nunca "longe")
  assert.equal(distanciaAtePoligonoM(imovel, fc()), null);
  assert.equal(distanciaAtePoligonoM(imovel, null), null);
  assert.equal(distanciaAtePoligonoM({ type: "Point", coordinates: [0, 0] }, fc(norte)), null);
}

// ---- relevo ----
{
  assert.deepEqual(estatisticasAltitude([830, null, 1100, 900]), { media: 943, min: 830, max: 1100, amostras: 3 });
  assert.deepEqual(estatisticasAltitude([null, undefined]), { media: null, min: null, max: null, amostras: 0 });

  const pts = amostrarInterior(imovel, 64);
  // plano inclinado 5% para norte e para leste: qualquer vizinho dá ~5% (ou ~7% na diagonal)
  const cosLat = Math.cos((LAT0 * Math.PI) / 180);
  const inclinado = pts.map(([lat, lng]) => 0.05 * ((lat - LAT0) * M_POR_GRAU_LAT + (lng - LNG0) * M_POR_GRAU_LAT * cosLat) + 800);
  const dec = declividadeMediaPct(pts, inclinado)!;
  assert.ok(dec > 4 && dec < 8, `esperava ~5%, veio ${dec}`);

  assert.equal(declividadeMediaPct(pts, pts.map(() => 900)), 0);
  assert.equal(declividadeMediaPct(pts.slice(0, 3), [1, 2, 3]), null);
  assert.equal(declividadeMediaPct(pts, pts.map(() => null)), null);
}

// ---- score ----
{
  // tudo conhecido: mesma soma da fórmula antiga (30+25+15+10+15 = 95)
  const cheio = pontuarGeo({ temRio: true, temLago: true, distAguaM: 0, temEnergia: true, distEnergiaM: 500, altMedia: 900, declivMed: 5, areaHa: 1454 });
  assert.equal(cheio.score, 95);
  assert.equal(cheio.confianca, 1);
  assert.deepEqual(cheio.semDado, []);

  // energia sem dado: NÃO é penalizada (antes valia 0 e derrubava a nota)
  const semEnergia = pontuarGeo({ temRio: true, temLago: true, distAguaM: 0, temEnergia: false, distEnergiaM: null, altMedia: 900, declivMed: 5, areaHa: 1454 });
  assert.deepEqual(semEnergia.semDado, ["energia"]);
  assert.equal(semEnergia.score, Math.round((70 / 75) * 100));
  assert.ok(semEnergia.score! > 90);

  // dado de menos (só altitude e área = 35% do peso) => sem nota
  const pouco = pontuarGeo({ temRio: false, temLago: false, distAguaM: null, temEnergia: false, distEnergiaM: null, altMedia: 900, declivMed: null, areaHa: 500 });
  assert.equal(pouco.score, null);
  assert.equal(pouco.confianca, 0.35);

  // água a 3 km é dado real (0 ponto), diferente de água sem dado
  const longe = pontuarGeo({ temRio: false, temLago: false, distAguaM: 3000, temEnergia: false, distEnergiaM: 800, altMedia: 700, declivMed: 3, areaHa: 2000 });
  assert.ok(!longe.semDado.includes("agua"));
  assert.equal(longe.breakdown.agua, 0);
}

// ---- energia ----
assert.equal(classificarEnergia(null, false), null);
assert.equal(classificarEnergia(null, true), "ALTA");
assert.equal(classificarEnergia(500, false), "ALTA");
assert.equal(classificarEnergia(3000, false), "MEDIA");
assert.equal(classificarEnergia(9000, false), "BAIXA");

// ---- resumo completo ----
{
  const pts = amostrarInterior(imovel, 64);
  const elev = pts.map((_, i) => 830 + (i % 8) * 38); // 830..1096 m
  const atravessa = { type: "LineString", coordinates: [[LNG0 - 0.05, LAT0 + GRAU / 2], [LNG0 + GRAU + 0.05, LAT0 + GRAU / 2]] };
  const umKmGrau = 1000 / M_POR_GRAU_LAT;
  const linhaEnergia = { type: "LineString", coordinates: [[LNG0 - 0.05, LAT0 + GRAU + umKmGrau * 3], [LNG0 + GRAU + 0.05, LAT0 + GRAU + umKmGrau * 3]] };

  const r = resumirGeo({ geometry: imovel, areaHa: 1454, pontos: pts, elevacoes: elev, rios: fc(atravessa), lagos: fc(), energia: fc(linhaEnergia) });
  assert.equal(r.temRio, true, "córrego atravessa a fazenda");
  assert.equal(r.temLago, false);
  assert.equal(r.distLagoM, null);
  assert.ok(r.distEnergiaM! > 2900 && r.distEnergiaM! < 3100, `energia ~3 km, veio ${r.distEnergiaM}`);
  assert.equal(r.temEnergia, false, "3 km não é energia próxima");
  assert.equal(r.scoreEnergia, "MEDIA");
  assert.equal(r.altMin, 830);
  assert.equal(r.altMax, 1096);
  assert.ok(r.score !== null && r.confianca === 1);

  // nada mapeado: desconhecido, não "sem rio" nem nota zero
  const vazio = resumirGeo({ geometry: imovel, areaHa: 1454, pontos: pts, elevacoes: elev, rios: fc(), lagos: fc(), energia: fc() });
  assert.equal(vazio.temRio, false);
  assert.equal(vazio.distAguaM, null);
  assert.equal(vazio.scoreEnergia, null);
  assert.deepEqual(vazio.semDado.sort(), ["agua", "energia"]);

  // API de elevação fora do ar: sem altitude, sem declividade, e o score não finge
  const semElev = resumirGeo({ geometry: imovel, areaHa: null, pontos: pts, elevacoes: pts.map(() => null), rios: fc(), lagos: fc(), energia: fc() });
  assert.equal(semElev.altMedia, null);
  assert.equal(semElev.declivMed, null);
  assert.equal(semElev.score, null);

  const osm = separarAguaOsm({ features: [
    { geometry: atravessa, properties: { waterway: "stream" } },
    { geometry: atravessa, properties: { natural: "water" } },
    { geometry: atravessa, properties: { natural: "reservoir" } },
  ] });
  assert.equal(osm.rios.features.length, 1);
  assert.equal(osm.lagos.features.length, 2);
}

console.log("geo-medicao: todos os testes passaram");
