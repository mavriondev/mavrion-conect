// Teste de SANIDADE COM REDE contra o WFS real do IBGE: falha se a consulta numa coordenada com rodovia
// conhecida (centro de Patos de Minas/MG, cortado pela BR-365) devolver vazio. Também confere o controle
// de ferrovia e a verificação completa de um polígono fictício em Patos de Minas.
// Rodar sozinho: node --import tsx server/lib/__tests__/logistica-ibge.sanidade.test.ts
import assert from "node:assert/strict";
import {
  CAMADAS_MALHA, consultarWfsIbge, caixaEmTorno, controlePositivo, verificarMalha, limparCacheControle, IBGE_WFS,
} from "../logistica-ibge";
import { extensaoCamadaWfs, caixaDentroDaExtensao } from "../wfs-descoberta";

const PATOS = { lon: -46.518, lat: -18.579 };          // centro de Patos de Minas/MG
const BR365 = { lon: -46.5787, lat: -18.687 };         // vértice da BR-365/BR-352 na BC250 2025
const siglas = (fs: any[]) => new Set(fs.map((f) => String(f?.properties?.sigla || "")));

// 1) rodovia: centro de Patos de Minas (caixa de ~10 km) tem de devolver feições, incluindo a BR-365
const centro = await consultarWfsIbge(CAMADAS_MALHA.rodovia.layer, caixaEmTorno(PATOS.lon, PATOS.lat, 0.05));
assert.equal(centro.ok, true, "WFS do IBGE não respondeu (rede/serviço) — teste inconclusivo, não ausência");
assert.ok(centro.features.length > 0, "SANIDADE: zero rodovias no centro de Patos de Minas — consulta quebrada (eixos, camada ou filtro)");
assert.ok([...siglas(centro.features)].some((s) => /BR-365/.test(s)), `BR-365 não apareceu em Patos de Minas; siglas: ${[...siglas(centro.features)].join(" | ")}`);

// 2) rodovia: caixa de ~2 km sobre um ponto da BR-365
const br = await consultarWfsIbge(CAMADAS_MALHA.rodovia.layer, caixaEmTorno(BR365.lon, BR365.lat, 0.01));
assert.equal(br.ok, true);
assert.ok(br.features.length > 0, "SANIDADE: zero feições sobre a BR-365");

// 3) controles positivos reais das duas malhas
limparCacheControle();
for (const malha of ["rodovia", "ferrovia"] as const) {
  const c = await controlePositivo(CAMADAS_MALHA[malha]);
  assert.equal(c.confiavel, true, `controle positivo de ${malha} reprovado: ${(c as any).motivo}`);
}

// 4) extensão publicada cobre Patos de Minas (as duas camadas)
for (const malha of ["rodovia", "ferrovia"] as const) {
  const ext = await extensaoCamadaWfs(IBGE_WFS, CAMADAS_MALHA[malha].layer);
  assert.ok(ext, `extensão de ${malha} não encontrada no GetCapabilities`);
  assert.ok(caixaDentroDaExtensao(caixaEmTorno(PATOS.lon, PATOS.lat, 0.3), ext!), `Patos de Minas fora da extensão publicada de ${malha}`);
}

// 5) verificação completa: polígono de ~1 km no centro de Patos → rodovia detectada a poucos km
const ativo = {
  geojson: { type: "Polygon", coordinates: [[[-46.525, -18.585], [-46.515, -18.585], [-46.515, -18.575], [-46.525, -18.575], [-46.525, -18.585]]] },
  bbox: { minLon: -46.525, minLat: -18.585, maxLon: -46.515, maxLat: -18.575 },
};
const rod = await verificarMalha(ativo, "rodovia");
assert.equal(rod.achado, "detectado", `rodovia em Patos de Minas: ${rod.achado} — ${rod.observacao}`);
assert.ok((rod.valor as number) < 10000, `rodovia mais próxima a ${rod.valor} m (esperado < 10 km)`);
const fer = await verificarMalha(ativo, "ferrovia");
// A ferrovia mais próxima (FCA, EF-045) fica a ~59 km do centro: deve vir da busca ampliada, nunca "sem dado".
assert.notEqual(fer.achado, "indeterminado", `ferrovia virou sem dado: ${fer.observacao}`);
if (fer.achado === "detectado") assert.ok((fer.valor as number) > 30000 && (fer.valor as number) < 110000, `ferrovia a ${fer.valor} m`);

console.log("logistica-ibge (sanidade com rede): ok", {
  rodovias_centro_patos: centro.features.length, siglas: [...siglas(centro.features)].filter(Boolean).slice(0, 8),
  rodovia: { achado: rod.achado, distancia_m: rod.valor, obs: rod.observacao },
  ferrovia: { achado: fer.achado, distancia_m: fer.valor, obs: fer.observacao },
});
