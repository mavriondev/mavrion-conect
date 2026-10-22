// Regras de confiança da verificação de rodovia/ferrovia (sem rede): "não detectado" só com controle
// positivo aprovado e caixa dentro da cobertura publicada; o resto é "sem dado".
import assert from "node:assert/strict";
import {
  CAMADAS_MALHA, verificarMalha, limparCacheControle, caixaComMargem, maisProxima,
  type FontesMalha, type RespostaWfs,
} from "../logistica-ibge";
import { extrairExtensao, caixaDentroDaExtensao, type ExtensaoWfs } from "../wfs-descoberta";

// Imóvel quadrado de ~1 km junto a Patos de Minas/MG.
const ativo = {
  geojson: { type: "Polygon", coordinates: [[[-46.53, -18.59], [-46.52, -18.59], [-46.52, -18.58], [-46.53, -18.58], [-46.53, -18.59]]] },
  bbox: { minLon: -46.53, minLat: -18.59, maxLon: -46.52, maxLat: -18.58 },
};
const BRASIL: ExtensaoWfs = { minLon: -73.9, minLat: -33.8, maxLon: -28.8, maxLat: 5.3 };
// Extensão publicada da BC100 genérica (Centro-Oeste) — o caso real que gerou o falso "não detectado".
const BC100_CENTRO_OESTE: ExtensaoWfs = { minLon: -53.3, minLat: -19.51, maxLon: -45.69, maxLat: -12.35 };

const linha = (lon: number, lat: number, props: Record<string, unknown> = {}) => ({
  type: "Feature", properties: props,
  geometry: { type: "LineString", coordinates: [[lon, lat - 0.05], [lon, lat + 0.05]] },
});
const vazio: RespostaWfs = { ok: true, features: [], truncado: false, numberMatched: 0 };
const falha: RespostaWfs = { ok: false, features: [], truncado: false };

function fontes(plano: { controle: RespostaWfs; normal: RespostaWfs; ampla?: RespostaWfs; extensao?: ExtensaoWfs | null }): FontesMalha & { chamadas: string[] } {
  const chamadas: string[] = [];
  const caixaNormal = caixaComMargem(ativo.bbox, 0.3);
  return {
    chamadas,
    wfs: async (_t, c) => {
      const largura = c.maxLon - c.minLon;
      if (largura < 0.1) { chamadas.push("controle"); return plano.controle; }
      if (Math.abs(c.minLon - caixaNormal.minLon) < 1e-9) { chamadas.push("normal"); return plano.normal; }
      chamadas.push("ampla"); return plano.ampla ?? vazio;
    },
    extensao: async () => { chamadas.push("extensao"); return plano.extensao === undefined ? BRASIL : plano.extensao; },
  };
}

// camadas nacionais (a BC100 genérica não cobre o país)
assert.match(CAMADAS_MALHA.rodovia.layer, /^CCAR:BC250_2025_rod_/);
assert.match(CAMADAS_MALHA.ferrovia.layer, /^CCAR:BC250_2025_fer_/);

// extensão publicada: parse do GetCapabilities e teste de contenção
const xml = `<WFS_Capabilities><FeatureTypeList>
 <FeatureType><Name>CCAR:BC100_Trecho_Rodoviario_L</Name><Title>x</Title>
  <ows:WGS84BoundingBox><ows:LowerCorner>-53.3008522247629 -19.51349522332769</ows:LowerCorner><ows:UpperCorner>-45.690489076217894 -12.351792124517104</ows:UpperCorner></ows:WGS84BoundingBox></FeatureType>
 <FeatureType><Name>CCAR:sem_extensao</Name><Title>y</Title></FeatureType>
</FeatureTypeList></WFS_Capabilities>`;
const ext = extrairExtensao(xml, "CCAR:BC100_Trecho_Rodoviario_L")!;
assert.ok(ext && Math.abs(ext.minLon + 53.3) < 0.01 && Math.abs(ext.maxLat + 12.35) < 0.01);
assert.equal(extrairExtensao(xml, "CCAR:sem_extensao"), null);
assert.equal(extrairExtensao(xml, "CCAR:inexistente"), null);
assert.equal(caixaDentroDaExtensao(caixaComMargem(ativo.bbox, 0.3), BRASIL), true);
assert.equal(caixaDentroDaExtensao({ minLon: -47, minLat: -23.5, maxLon: -46, maxLat: -22.5 }, BC100_CENTRO_OESTE), false); // SP fora

// feição mais próxima com nome
const perto = maisProxima(ativo.geojson, [linha(-46.5, -18.585, { sigla: "BR-365", jurisdicao: "Federal", revestimento: "Pavimentado" }), linha(-46.0, -18.585, { sigla: "MG-1" })], CAMADAS_MALHA.rodovia.nomeFeicao)!;
assert.ok(perto.distanciaM > 1500 && perto.distanciaM < 2600, `distância ${perto.distanciaM}`);
assert.equal(perto.nome, "BR-365, Federal, Pavimentado");
assert.equal(CAMADAS_MALHA.ferrovia.nomeFeicao({ nome: "FCA", codtrechoferrov: "EF-045", operacional: "Sim" }), "FCA, EF-045");
assert.equal(CAMADAS_MALHA.ferrovia.nomeFeicao({ operacional: "Não" }), "trecho sem nome, não operacional");

async function caso(nome: string, plano: Parameters<typeof fontes>[0]) {
  limparCacheControle();
  const f = fontes(plano);
  const v = await verificarMalha(ativo, "rodovia", f);
  return { v, chamadas: f.chamadas, nome };
}

// 1) controle positivo reprovado → sem dado, sem consultar o imóvel
{
  const { v, chamadas } = await caso("controle vazio", { controle: vazio, normal: { ...vazio, features: [linha(-46.5, -18.585)] } });
  assert.equal(v.estado, "sem_dado"); assert.equal(v.achado, "indeterminado");
  assert.match(v.observacao!, /Controle positivo falhou/);
  assert.deepEqual(chamadas, ["controle"]);
}
{
  const { v } = await caso("controle falhou", { controle: falha, normal: vazio });
  assert.equal(v.achado, "indeterminado"); assert.match(v.observacao!, /não respondeu/);
}

// 2) feição no raio normal → detectado com distância e nome
{
  const { v, chamadas } = await caso("detectado", { controle: { ...vazio, features: [linha(-46.5787, -18.687)] }, normal: { ...vazio, features: [linha(-46.5, -18.585, { sigla: "BR-365" })] } });
  assert.equal(v.estado, "indicado"); assert.equal(v.achado, "detectado");
  assert.equal(typeof v.valor, "number"); assert.equal(v.unidade, "m");
  assert.match(v.observacao!, /pavimentada na área consultada/); // sem revestimento informado, não conta como pavimentada
  assert.match(v.observacao!, /qualquer tipo: BR-365/);
  assert.deepEqual(chamadas, ["controle", "normal"]);
}

// 2b) valor publicado é a PAVIMENTADA mais próxima; a vicinal que cruza o imóvel fica só na observação
{
  const vicinal = linha(-46.525, -18.585, { jurisdicao: "Municipal", revestimento: "Revestimento primário (solto)" });
  const br = linha(-46.5, -18.585, { sigla: "BR-365", jurisdicao: "Federal", revestimento: "Pavimentado" });
  const { v } = await caso("pavimentada", { controle: { ...vazio, features: [linha(0, 0)] }, normal: { ...vazio, features: [vicinal, br] } });
  assert.equal(v.achado, "detectado");
  assert.ok((v.valor as number) > 1500 && (v.valor as number) < 2600, `valor ${v.valor}`);
  assert.match(v.observacao!, /Rodovia pavimentada mais próxima: BR-365, Federal, Pavimentado — [12],\d km/);
  assert.match(v.observacao!, /qualquer tipo: via sem sigla, Municipal, Revestimento primário \(solto\) — cruza ou toca o imóvel/);
}

// 3) vazio no raio normal com extensão desconhecida → sem dado (nunca "não detectado")
{
  const { v } = await caso("extensão desconhecida", { controle: { ...vazio, features: [linha(0, 0)] }, normal: vazio, extensao: null });
  assert.equal(v.achado, "indeterminado"); assert.match(v.observacao!, /extensão da camada desconhecida/);
}

// 4) vazio e imóvel fora da cobertura publicada (o caso SP × BC100 Centro-Oeste) → sem dado
{
  limparCacheControle();
  const sp = { geojson: { type: "Polygon", coordinates: [[[-47, -23], [-46.9, -23], [-46.9, -22.9], [-47, -22.9], [-47, -23]]] }, bbox: { minLon: -47, minLat: -23, maxLon: -46.9, maxLat: -22.9 } };
  const f: FontesMalha = {
    wfs: async (_t, c) => (c.maxLon - c.minLon < 0.1 ? { ...vazio, features: [linha(0, 0)] } : vazio),
    extensao: async () => BC100_CENTRO_OESTE,
  };
  const v = await verificarMalha(sp, "rodovia", f);
  assert.equal(v.estado, "sem_dado"); assert.equal(v.achado, "indeterminado");
  assert.match(v.observacao!, /fora da extensão publicada/);
}

// 5) vazio no raio normal, dentro da cobertura, busca ampliada acha → detectado com aviso
{
  const { v, chamadas } = await caso("ampla", { controle: { ...vazio, features: [linha(0, 0)] }, normal: vazio, ampla: { ...vazio, features: [linha(-46.0, -18.585, { sigla: "BR-040" })] } });
  assert.equal(v.achado, "detectado"); assert.ok((v.valor as number) > 40000);
  assert.match(v.observacao!, /busca ampliada/); assert.match(v.observacao!, /BR-040/);
  assert.deepEqual(chamadas, ["controle", "normal", "extensao", "ampla"]);
}

// 6) tudo vazio, cobertura confirmada e controle aprovado → único caminho para "não detectado"
{
  const { v } = await caso("nao detectado legítimo", { controle: { ...vazio, features: [linha(0, 0)] }, normal: vazio, ampla: vazio });
  assert.equal(v.estado, "indicado"); assert.equal(v.achado, "nao_detectado");
  assert.match(v.observacao!, /controle positivo/);
}

// 7) controle aprovado fica em cache (não repete a consulta de controle na mesma janela)
{
  limparCacheControle();
  const f = fontes({ controle: { ...vazio, features: [linha(0, 0)] }, normal: { ...vazio, features: [linha(-46.5, -18.585)] } });
  await verificarMalha(ativo, "rodovia", f); await verificarMalha(ativo, "rodovia", f);
  assert.equal(f.chamadas.filter((c) => c === "controle").length, 1);
}

console.log("logistica-ibge: todos os testes passaram");
