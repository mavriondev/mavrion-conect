// Ativo MINA sintético usado nos testes de ponta a ponta do relatório:
// dados espalhados entre fontes — o SCM completa o que falta no cadastro,
// TAH legada sem ano (ambígua), histórico só com evento falso, anmRestricoes
// parcial (camadas faltando/falhadas), FUNAI com ocorrências (menções
// obrigatórias nos riscos), DOU indisponível (telemetria de módulos) e base
// fundiária SIGEF/CAR/consolidada com sobreposição em ha e % (mesma fonte).
// `extraCampos` permite variantes por teste (ex.: parecer IA em cache).
export function ativoMinaSintetico(extraCampos: any = {}): any {
  return {
    title: "Mina Sintética",
    type: "MINA",
    estado: null,
    areaHa: null,
    __scmData: {
      fase: "REQUERIMENTO DE LAVRA",
      titularNome: "MINERADORA SINTETICA LTDA",
      titularCnpj: "12345678000199",
      tipoPessoa: "PJ",
      uf: "MG",
      areaHa: 49.2,
      nup: "48054.000001/2024-01",
      statusAtivo: true,
      consultadoEm: "2026-08-10T12:00:00Z",
    },
    camposEspecificos: {
      processoAnm: "832070", // sem ano → TAH ambígua
      anmTah: [
        { anoBase: 1989, nomeTitular: "Titular Antigo A" },
        { anoBase: 2024, nomeTitular: "Titular Recente" },
      ],
      anmHistorico: {
        eventos: [{ descricao: "832.070", data: null, tipo: "outro" }], // evento falso
      },
      anmRestricoes: {
        raio_km: 25,
        camadas: {
          unidadesConservacao: { consultado: true, sobreposicao: false, total: 0, ocorrencias: [], sobreposicoes: [] },
          embargos: { consultado: false },
          // quilombolas/assentamentos/cavernas ausentes → não consultadas
        },
      },
      // FUNAI com ocorrências: menção obrigatória nos riscos do parecer
      anmFunaiTerras: {
        total: 2,
        raio_km: 50,
        data: [
          { terrai_nome: "TI Exemplo", distancia_km: 12 },
          { terrai_nome: "TI Outra", distancia_km: 20 },
        ],
      },
      // Módulo consultado que FALHOU → "indisponível nesta geração"
      anmDou: { disponivel: false, erro: "timeout na Imprensa Nacional" },
      // Parcela SIGEF isolada: 423,23 ha (2,39% do polígono)
      sigefParcelas: {
        disponivel: true,
        totalSobrepostas: 1,
        totalVizinhas: 0,
        coberturaPct: 2.39,
        fonte: "SIGEF/INCRA (espelho ArcGIS)",
        dataBase: "2026-08-01",
        consultadoEm: "2026-08-10T12:00:00Z",
        parcelas: [
          {
            codigoParcela: "PAR-3",
            nomeArea: "Fazenda Canadá",
            detentor: "José Canadá",
            areaHa: 423.23,
            sobreposicaoHa: 423.23,
            sobreposicaoPct: 2.39,
            relacao: "sobreposta",
            situacao: "Certificada",
            registroMatricula: "M-777",
          },
        ],
      },
      carImoveis: {
        disponivel: true,
        totalSobrepostos: 1,
        totalVizinhos: 0,
        coberturaPct: 0.88,
        fonte: "SICAR",
        consultadoEm: "2026-08-10T12:00:00Z",
        imoveis: [
          {
            codImovel: "MG-3147006-CAR1",
            municipio: "Paracatu",
            uf: "MG",
            areaHa: 500,
            status: "AT",
            condicao: "Ativo",
            tipo: "IRU",
            sobreposicaoHa: 15.5,
            sobreposicaoPct: 0.88,
            relacao: "sobreposto",
          },
        ],
      },
      // Consolidada: imóvel com 2 parcelas somadas (477,15 ha / 3,16%) e a
      // Fazenda Canadá com parcela única (mesmos números da tabela SIGEF)
      ccirImoveis: {
        totalImoveis: 2,
        comCodigoIncra: 2,
        comDetentor: 2,
        fonte: "SIGEF + CAR (casamento geométrico)",
        consultadoEm: "2026-08-10T12:00:00Z",
        imoveis: [
          {
            codigoIncra: "950.000.111.222-3",
            codigoCar: "MG-3147006-CAR1",
            denominacao: "Fazenda Boa Vista",
            detentores: ["Maria Silva"],
            areaHa: 477.15,
            sobreposicaoHa: 477.15,
            sobreposicaoPct: 3.16,
            situacao: "Certificada",
            origem: "SIGEF+CAR",
            parcelas: ["PAR-1", "PAR-2"],
          },
          {
            codigoIncra: "950.000.999.888-7",
            codigoCar: null,
            denominacao: "Fazenda Canadá",
            detentores: ["José Canadá"],
            areaHa: 423.23,
            sobreposicaoHa: 423.23,
            sobreposicaoPct: 2.39,
            situacao: "Certificada",
            origem: "SIGEF",
            parcelas: ["PAR-3"],
          },
        ],
      },
      ...extraCampos,
    },
    attributesJson: {},
  };
}
