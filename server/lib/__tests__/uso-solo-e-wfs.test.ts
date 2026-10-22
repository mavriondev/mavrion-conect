import assert from "node:assert/strict";
import { grupoDaClasse, resumirUsoSolo, descreverUsoSolo } from "../uso-solo-amostragem";
import { escolherCamada } from "../wfs-descoberta";
import { verificacaoAutomatica, projecaoPublica } from "../confianca-dados";

// agrupamento
assert.equal(grupoDaClasse(3), "vegetacao_nativa");
assert.equal(grupoDaClasse(15), "pastagem");
assert.equal(grupoDaClasse(39), "agricultura");
assert.equal(grupoDaClasse(27), null); // não observado fica fora

// proporção arredondada a 5% e só com amostra suficiente
const r = resumirUsoSolo([3, 3, 3, 3, 3, 3, 15, 15, 15, 39, null, null])!;
assert.equal(r.amostrasValidas, 10);
assert.equal(r.grupos.vegetacao_nativa, 50);
assert.equal(r.grupos.pastagem, 25);
assert.equal(r.grupos.agricultura, 10);
assert.equal(r.percentualSemDado, 15);
assert.match(descreverUsoSolo(r), /~50% vegetação nativa/);
assert.equal(resumirUsoSolo([3, 15, null, null, null, null]), null);       // poucas respostas
assert.equal(resumirUsoSolo([3, 3, 3]), null);                              // < 4 pontos
assert.equal(resumirUsoSolo([27, 27, 27, 27, 0, 0]), null);                 // nada classificável

// projeção pública do uso do solo usa só a faixa
const pub = projecaoPublica([verificacaoAutomatica({ chave: "uso_solo", achado: "detectado", valor: { ...r, descricao: descreverUsoSolo(r) }, fonte: "MapBiomas" })]);
assert.equal(pub.length, 1);
assert.match(pub[0].texto, /50%/);

// descoberta de camada WFS
const xml = `<WFS_Capabilities><FeatureTypeList>
 <FeatureType><Name>incra:ponto_assentamento</Name><Title>Pontos</Title></FeatureType>
 <FeatureType><Name>incra:assentamentos</Name><Title>Projetos de assentamento</Title></FeatureType>
 <FeatureType><Name>incra:quilombolas</Name><Title>Quilombolas</Title></FeatureType>
</FeatureTypeList></WFS_Capabilities>`;
assert.equal(escolherCamada(xml, /assentamento/i, undefined, /ponto/i), "incra:assentamentos");
assert.equal(escolherCamada(xml, /assentamento/i), "incra:ponto_assentamento");
assert.equal(escolherCamada(xml, /ferrovi/i), null);
console.log("uso-solo-e-wfs: todos os testes passaram");
