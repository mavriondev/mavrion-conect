import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classificarSubstancia, casaSubstancia, categorizarFase, lacunasDoPerfil } from "../jazida-perfis";
import { construirCatalogoEvidencias } from "../jazida-evidencias";
import { pointInGeom } from "../pesquisa-complementar";

// quadrado ~2 km de lado em torno de (-18.0, -45.0)
const POLIGONO = {
  type: "Polygon",
  coordinates: [[[-45.01, -18.01], [-44.99, -18.01], [-44.99, -17.99], [-45.01, -17.99], [-45.01, -18.01]]],
};

function ativoBase(extra: any = {}) {
  return {
    id: 1, type: "MINA", title: "Alvo teste", areaHa: 400, estado: "MG", municipio: "Teste",
    camposEspecificos: {
      processoAnm: "830.123/2015", substancia: "MINÉRIO DE ESTANHO", faseAnm: "AUTORIZAÇÃO DE PESQUISA",
      latitude: -18.0, longitude: -45.0,
      ...extra,
    },
  };
}

describe("perfis por substância e fase", () => {
  test("classifica grupos e equivalências (estanho ↔ cassiterita)", () => {
    const sn = classificarSubstancia("MINÉRIO DE ESTANHO");
    assert.equal(sn.grupo, "metalico_base");
    assert.ok(casaSubstancia("CASSITERITA, COLUMBITA", sn));
    assert.ok(!casaSubstancia("OURO", sn));
    assert.equal(classificarSubstancia("Areia").grupo, "agregados_construcao");
    assert.equal(classificarSubstancia("AREIA INDUSTRIAL").grupo, "industrial");
    assert.equal(classificarSubstancia("TERRAS RARAS").grupo, "terras_raras_criticos");
    assert.equal(classificarSubstancia("Granito ornamental").grupo, "rocha_ornamental");
    assert.equal(classificarSubstancia("ÁGUA MINERAL").grupo, "agua_mineral");
    assert.equal(classificarSubstancia("substância desconhecida xyz").grupo, "generico");
  });

  test("fase ANM condiciona as lacunas do perfil (beneficiamento só em lavra)", () => {
    assert.equal(categorizarFase("REQUERIMENTO DE LAVRA"), "requerimento_lavra");
    assert.equal(categorizarFase("LAVRA GARIMPEIRA"), "lavra_garimpeira");
    const pesquisa = lacunasDoPerfil("metalico_base", "autorizacao_pesquisa").map((l) => l.id);
    const lavra = lacunasDoPerfil("metalico_base", "concessao_lavra").map((l) => l.id);
    assert.ok(!pesquisa.includes("beneficiamento"));
    assert.ok(lavra.includes("beneficiamento"));
    // ordenação estável por prioridade
    const prios = lacunasDoPerfil("ferroso", "concessao_lavra").map((l) => l.prioridade);
    assert.deepEqual(prios, prios.slice().sort((a, b) => a - b));
  });
});

describe("catálogo de evidências", () => {
  test("separa ocorrência dentro do polígono de ocorrência no entorno", () => {
    const ativo = ativoBase({
      anmRecursos: {
        disponivel: true, fonte: "GeoSGB", raio_km: 25, total: 2, consultadoEm: "2026-10-01T00:00:00Z",
        data: [
          { nome_ocorrencia: "Dentro", substancias: "CASSITERITA", lat: -18.0, lon: -45.0, distancia_km: 0.1 },
          { nome_ocorrencia: "Fora", substancias: "OURO", lat: -18.2, lon: -45.2, distancia_km: 30 },
        ],
      },
    });
    const cat = construirCatalogoEvidencias(ativo, POLIGONO);
    const dentro = cat.itens.find((i) => i.titulo.startsWith("Dentro"));
    const fora = cat.itens.find((i) => i.titulo.startsWith("Fora"));
    assert.equal(dentro?.vinculo, "poligono");
    assert.equal(dentro?.mesmaSubstancia, true);
    assert.equal(fora?.vinculo, "entorno");
    assert.equal(fora?.mesmaSubstancia, false);
    assert.equal(cat.poligono.disponivel, true);
    assert.ok(cat.sintese.destaques.some((d) => d.includes("dentro do polígono")));
    assert.ok(pointInGeom([-45.0, -18.0], POLIGONO) && !pointInGeom([-45.2, -18.2], POLIGONO));
  });

  test("sem polígono usa raio equivalente e avisa explicitamente", () => {
    const ativo = ativoBase({
      anmRecursos: { disponivel: true, raio_km: 25, total: 1, data: [{ nome_ocorrencia: "Perto", substancias: "ESTANHO", distancia_km: 0.5 }] },
    });
    const cat = construirCatalogoEvidencias(ativo, null);
    assert.equal(cat.poligono.disponivel, false);
    assert.ok(cat.poligono.raioEquivalenteKm! > 1);
    assert.equal(cat.itens.find((i) => i.titulo.startsWith("Perto"))?.vinculo, "entorno");
    assert.ok(cat.sintese.avisos.some((a) => a.includes("Polígono do ativo indisponível")));
    assert.ok(cat.proximosPassos.some((p) => p.includes("polígono")));
  });

  test("falha de fonte é 'indisponível', nunca 'sem registro'; não consultada aparece como tal", () => {
    const ativo = ativoBase({
      anmSondagem: { disponivel: false, message: "Serviço instável" },
      anmPesquisaComplementar: {
        versao: 1, consultadoEm: "2026-10-02T00:00:00Z", fontes: {
          rigeo: { id: "rigeo", label: "Documentos técnicos (RIGeo/SGB)", fonte: "RIGeo", vinculo: "documento", estado: "indisponivel", motivo: "tempo esgotado", consultadoEm: "2026-10-02T00:00:00Z", cobertura: "" },
          afloramentos: { id: "afloramentos", label: "Afloramentos", fonte: "GeoSGB", vinculo: "entorno", estado: "sem_registro", total: 0, raioKm: 10, consultadoEm: "2026-10-02T00:00:00Z", cobertura: "" },
        },
      },
    });
    const cat = construirCatalogoEvidencias(ativo, POLIGONO);
    const f = Object.fromEntries(cat.fontes.map((x) => [x.id, x.estado]));
    assert.equal(f["anmSondagem"], "indisponivel");
    assert.equal(f["pc.rigeo"], "indisponivel");
    assert.equal(f["pc.afloramentos"], "sem_registro");
    assert.equal(f["pc.processosVizinhos"], "nao_consultado");
    assert.equal(f["anmRestricoes"], "nao_consultado");
    assert.ok(cat.proximosPassos.some((p) => p.includes("indisponíveis")));
    assert.ok(cat.proximosPassos.some((p) => p.includes("ainda não realizadas")));
  });

  test("processos vizinhos: proximidade não vira mineralização e divergência é registrada", () => {
    const ativo = ativoBase({
      anmPesquisaComplementar: {
        versao: 1, consultadoEm: "2026-10-02T00:00:00Z", fontes: {
          processosVizinhos: {
            id: "processosVizinhos", label: "Processos ANM vizinhos", fonte: "SIGMINE", vinculo: "entorno", estado: "registro", total: 3, raioKm: 25, consultadoEm: "2026-10-02T00:00:00Z", cobertura: "",
            data: { totalMesmaSubstancia: 0, sobrepostosAoPonto: 0, porFase: { "REQUERIMENTO DE PESQUISA": 3 }, topSubstancias: [{ substancia: "OURO", total: 3 }], processos: [{ processo: "1/2020", fase: "REQUERIMENTO DE PESQUISA", substancia: "OURO", distanciaKm: 2, mesmaSubstancia: false }] },
          },
        },
      },
    });
    const cat = construirCatalogoEvidencias(ativo, POLIGONO);
    const resumo = cat.itens.find((i) => i.id === "viz-resumo");
    assert.ok(resumo && resumo.detalhe.includes("interesse exploratório, não mineralização"));
    assert.ok(cat.divergencias.some((d) => d.tema.includes("distrito")));
    assert.ok(!cat.itens.some((i) => i.id.startsWith("viz-") && i.id !== "viz-resumo"), "processos de outra substância não entram como evidência individual");
  });

  test("impeditivos vêm do quadro de camadas (sobreposição direta × ocorrência no raio)", () => {
    const ativo = ativoBase({
      anmFunai: { sobreposicao: true, consultadoEm: "2026-09-01T00:00:00Z" },
      anmFunaiTerras: { total: 1, data: [{ terrai_nome: "TI Teste", distancia_km: 0 }] },
      anmRestricoes: { camadas: { unidadesConservacao: { consultado: true, total: 2, sobreposicao: false, ocorrencias: [{ nome: "APA X", distancia_km: 4 }] } } },
    });
    const cat = construirCatalogoEvidencias(ativo, POLIGONO);
    assert.equal(cat.impeditivos[0].severidade, "impeditivo");
    assert.ok(cat.impeditivos[0].titulo.includes("sobreposição direta"));
    assert.ok(cat.impeditivos.some((i) => i.severidade === "atencao"));
    assert.ok(cat.proximosPassos.some((p) => p.includes("sobreposições diretas")));
  });

  test("determinismo: mesmos insumos ⇒ mesmo catálogo", () => {
    const ativo = ativoBase({
      anmRecursos: { disponivel: true, raio_km: 25, total: 2, data: [{ nome_ocorrencia: "B", substancias: "ESTANHO", lat: -18.3, lon: -45.3, distancia_km: 40 }, { nome_ocorrencia: "A", substancias: "ESTANHO", lat: -18.0, lon: -45.0, distancia_km: 0.2 }] },
      anmCfem: { disponivel: true, processo: { jaProduziu: true, totalRecolhido: 1234.5, porAno: [{ ano: 2019 }] } },
    });
    const a = JSON.stringify(construirCatalogoEvidencias(ativo, POLIGONO));
    const b = JSON.stringify(construirCatalogoEvidencias(JSON.parse(JSON.stringify(ativo)), POLIGONO));
    assert.equal(a, b);
    const cat = construirCatalogoEvidencias(ativo, POLIGONO);
    // dentro do polígono vem antes do entorno; valor só com unidade
    assert.equal(cat.itens[0].titulo.startsWith("A"), true);
    const cfem = cat.itens.find((i) => i.id === "cfem-processo");
    assert.deepEqual(cfem?.valor, { numero: 1234.5, unidade: "R$ (CFEM recolhida)" });
    // CFEM em fase de pesquisa gera divergência fase × produção
    assert.ok(cat.divergencias.some((d) => d.tema === "Fase × produção"));
  });
});
