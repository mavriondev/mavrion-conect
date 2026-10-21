import { getCached, setCached } from "../cache";

interface CulturaProducao {
  nome: string;
  areaColhida: number | null;
  quantidadeProduzida: number | null;
  valorProducao: number | null;
}

interface ContextoRegionalResult {
  municipio: string;
  estado: string;
  codigoIbge: string;
  anoReferencia: string;
  fonte: string;
  culturas: CulturaProducao[];
  totalAreaColhida: number;
  totalQuantidadeProduzida: number;
  totalValorProducao: number;
  atualizadoEm: string;
}

const PRINCIPAIS_CULTURAS: Record<string, number> = {
  "Soja (em grão)": 40124,
  "Milho (em grão)": 40126,
  "Cana-de-açúcar": 40128,
  "Café (em grão) - Total": 40132,
  "Algodão herbáceo (em caroço)": 40093,
  "Arroz (em casca)": 40096,
  "Feijão (em grão) - Total": 40104,
  "Trigo (em grão)": 40130,
  "Mandioca": 40113,
  "Laranja": 40111,
  "Banana (cacho)": 40097,
  "Cacau (em amêndoa)": 40098,
};

function parseNumericValue(val: string | undefined): number | null {
  if (!val || val === "..." || val === ".." || val === "-" || val === "X") return null;
  const num = Number(val.replace(/\s/g, ""));
  return isNaN(num) ? null : num;
}

export async function getProducaoMunicipio(codigoIbge: string): Promise<ContextoRegionalResult | null> {
  const cacheKey = `pam_${codigoIbge}`;
  const cached = await getCached<ContextoRegionalResult>("ibge_pam", cacheKey);
  if (cached) return cached;

  try {
    const culturaIds = Object.values(PRINCIPAIS_CULTURAS).join(",");
    const url = `https://servicodados.ibge.gov.br/api/v3/agregados/5457/periodos/2023/variaveis/216|214|215?localidades=N6[${codigoIbge}]&classificacao=782[${culturaIds}]`;

    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`IBGE PAM: HTTP ${response.status} para ${codigoIbge}`);
      return null;
    }

    const data = await response.json() as any[];

    const culturasMap = new Map<string, CulturaProducao>();

    for (const variavel of data) {
      const varId = variavel.id;
      for (const resultado of variavel.resultados || []) {
        const categorias = resultado.classificacoes?.[0]?.categoria || {};
        for (const [catId, catNome] of Object.entries(categorias)) {
          const nome = catNome as string;
          const valor = resultado.series?.[0]?.serie?.["2023"];
          const parsed = parseNumericValue(valor);

          if (!culturasMap.has(nome)) {
            culturasMap.set(nome, { nome, areaColhida: null, quantidadeProduzida: null, valorProducao: null });
          }
          const cultura = culturasMap.get(nome)!;
          if (varId === "216") cultura.areaColhida = parsed;
          else if (varId === "214") cultura.quantidadeProduzida = parsed;
          else if (varId === "215") cultura.valorProducao = parsed;
        }
      }
    }

    const culturas = Array.from(culturasMap.values())
      .filter(c => c.areaColhida !== null || c.quantidadeProduzida !== null || c.valorProducao !== null)
      .sort((a, b) => (b.valorProducao || 0) - (a.valorProducao || 0));

    const localidade = data[0]?.resultados?.[0]?.series?.[0]?.localidade;
    const nomeMunicipio = localidade?.nome || codigoIbge;

    const resultado: ContextoRegionalResult = {
      municipio: nomeMunicipio,
      estado: nomeMunicipio.match(/\((\w{2})\)/)?.[1] || "",
      codigoIbge,
      anoReferencia: "2023",
      fonte: "IBGE - Produção Agrícola Municipal (PAM)",
      culturas,
      totalAreaColhida: culturas.reduce((s, c) => s + (c.areaColhida || 0), 0),
      totalQuantidadeProduzida: culturas.reduce((s, c) => s + (c.quantidadeProduzida || 0), 0),
      totalValorProducao: culturas.reduce((s, c) => s + (c.valorProducao || 0), 0),
      atualizadoEm: new Date().toISOString(),
    };

    await setCached("ibge_pam", cacheKey, resultado);
    return resultado;
  } catch (error: any) {
    console.error("Erro ao buscar IBGE PAM:", error.message || error);
    return null;
  }
}
