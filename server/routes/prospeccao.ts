import type { Express } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { companies, assets, companyBuyerProfiles } from "@shared/schema";
import { storage } from "../storage";
import { getOrgId } from "../lib/tenant";
import { runMatchingForAsset } from "../lib/auto-match";

const cnpjaHeaders = () => ({
  "Authorization": process.env.CNPJA_API_KEY || "",
});

function normalizeStr(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

let ibgeMunicipiosCache: { nome: string; id: number; uf: string }[] | null = null;

async function getIbgeMunicipios(): Promise<{ nome: string; id: number; uf: string }[]> {
  if (ibgeMunicipiosCache) return ibgeMunicipiosCache;
  try {
    const resp = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado");
    if (!resp.ok) return [];
    const data = await resp.json() as any[];
    ibgeMunicipiosCache = data.map((m: any) => ({
      nome: m["municipio-nome"] || m.nome,
      id: m["municipio-id"] || m.id,
      uf: m["UF-sigla"] || m.microrregiao?.mesorregiao?.UF?.sigla || "",
    }));
    return ibgeMunicipiosCache;
  } catch { return []; }
}

async function cidadesParaCodigosIbge(cidades: string[], uf?: string): Promise<number[]> {
  const municipios = await getIbgeMunicipios();
  const codigos: number[] = [];
  for (const cidade of cidades) {
    const cidadeNorm = normalizeStr(cidade);
    const match = municipios.find(m => {
      const nomeNorm = normalizeStr(m.nome);
      return nomeNorm === cidadeNorm && (!uf || m.uf.toUpperCase() === uf.toUpperCase());
    });
    if (match) codigos.push(match.id);
  }
  return codigos;
}

export function registerProspeccaoRoutes(app: Express, db: NodePgDatabase<any>) {
  app.get("/api/prospeccao/search", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const q = req.query as Record<string, string>;
      const {
        names, state, city, cnae, cnae_side, size, status: statusParam,
        nature, simples, mei, head, has_phone, has_email,
        founded_from, founded_to, equity_min, equity_max, ddd,
        limit = "50",
      } = q;

      const params = new URLSearchParams();
      params.set("limit", String(Math.min(Number(limit), 100)));

      if (names) params.set("names.in", names);
      if (state) params.set("address.state.in", state.split(",").map(s => s.trim()).join(","));
      if (city) {
        const cidadesArr = city.split(",").map(c => c.trim()).filter(Boolean);
        const codigos = await cidadesParaCodigosIbge(cidadesArr, state);
        if (codigos.length > 0) {
          params.set("address.municipality.in", codigos.join(","));
        }
      }

      if (cnae) {
        const codes = cnae.split(",").map(c => parseInt(c.trim(), 10)).filter(n => !isNaN(n));
        if (codes.length > 0) params.set("mainActivity.id.in", codes.join(","));
      }
      if (cnae_side) {
        const codes = cnae_side.split(",").map(c => parseInt(c.trim(), 10)).filter(n => !isNaN(n));
        if (codes.length > 0) params.set("sideActivities.id.in", codes.join(","));
      }
      if (size) {
        const codes = size.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (codes.length > 0) params.set("company.size.id.in", codes.join(","));
      }
      if (statusParam) {
        const codes = statusParam.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (codes.length > 0) params.set("status.id.in", codes.join(","));
      }
      if (nature) {
        const codes = nature.split(",").map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
        if (codes.length > 0) params.set("company.nature.id.in", codes.join(","));
      }
      if (simples === "true") params.set("company.simples.optant.eq", "true");
      if (simples === "false") params.set("company.simples.optant.eq", "false");
      if (mei === "true") params.set("company.simei.optant.eq", "true");
      if (mei === "false") params.set("company.simei.optant.eq", "false");
      if (head === "true") params.set("head.eq", "true");
      if (head === "false") params.set("head.eq", "false");
      if (has_phone === "true") params.set("phones.ex", "true");
      if (has_email === "true") params.set("emails.ex", "true");
      if (founded_from) params.set("founded.gte", founded_from);
      if (founded_to) params.set("founded.lte", founded_to);
      if (equity_min) params.set("company.equity.gte", equity_min);
      if (equity_max) params.set("company.equity.lte", equity_max);
      if (ddd) params.set("phones.area.in", ddd.split(",").map(d => d.trim()).join(","));

      const apiUrl = `https://api.cnpja.com/office?${params.toString()}`;
      const response = await fetch(apiUrl, { headers: cnpjaHeaders() });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as any;
        return res.status(response.status).json({ message: errBody.message || "Erro na busca" });
      }

      const data = await response.json() as any;
      const records: any[] = data.records || [];

      const savedCompanies = await db.select({ cnpj: companies.cnpj, id: companies.id }).from(companies);
      const savedCnpjMap = new Map(savedCompanies.filter(c => c.cnpj).map(c => [c.cnpj!, c.id]));

      const results = records.map((r: any) => ({
        taxId: r.taxId,
        legalName: r.company?.name || "",
        tradeName: r.alias || null,
        status: r.status?.text || null,
        statusId: r.status?.id || null,
        porte: r.company?.size?.text || null,
        cnaePrincipal: r.mainActivity?.text || null,
        cnaeCode: r.mainActivity?.id || null,
        city: r.address?.city || null,
        state: r.address?.state || null,
        founded: r.founded || null,
        alreadySaved: savedCnpjMap.has(r.taxId),
        savedCompanyId: savedCnpjMap.get(r.taxId) || null,
      }));

      res.json({ count: data.count, next: data.next, results });
    } catch (err) {
      console.error("Prospeccao search error:", err);
      res.status(500).json({ message: "Falha na busca" });
    }
  });

  function stripAccents(s: string) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function getPorteIds(tipo: string, preco: number | null): number[] {
    if (tipo === "MINA" || tipo === "DESENVOLVIMENTO") return [4, 5];
    if (tipo === "FII_CRI") return [3, 4, 5];
    if (tipo === "NEGOCIO") {
      if (!preco || preco < 2_000_000)  return [3, 4, 5];
      if (preco < 10_000_000)           return [4, 5];
      return [5];
    }
    if (tipo === "TERRA" || tipo === "AGRO") return [2, 3, 4, 5];
    return [3, 4, 5];
  }

  function getEquityMin(tipo: string, preco: number | null): number | null {
    if (!preco) return null;
    if (tipo === "FII_CRI") return null;
    if (preco < 1_000_000)         return null;
    if (preco < 5_000_000)         return 500_000;
    if (preco < 20_000_000)        return 2_000_000;
    if (preco < 100_000_000)       return 10_000_000;
    return 50_000_000;
  }

  function getFoundedBefore(tipo: string): string | null {
    const now = new Date();
    if (["MINA", "NEGOCIO", "FII_CRI"].includes(tipo)) {
      now.setFullYear(now.getFullYear() - 2);
      return now.toISOString().split("T")[0];
    }
    if (tipo === "DESENVOLVIMENTO") {
      now.setFullYear(now.getFullYear() - 1);
      return now.toISOString().split("T")[0];
    }
    return null;
  }

  function shouldFilterState(tipo: string): boolean {
    return tipo === "TERRA" || tipo === "DESENVOLVIMENTO";
  }

  function getNaturezas(tipo: string): number[] {
    if (tipo === "FII_CRI") return [206, 216, 305, 306];
    return [];
  }

  function shouldExcludeSimples(tipo: string, preco: number | null): boolean {
    if (["MINA", "FII_CRI"].includes(tipo)) return true;
    if (tipo === "NEGOCIO" && preco && preco > 5_000_000) return true;
    return false;
  }

  const CNAE_MAP: Record<string, { primary: number[]; secondary: number[]; keywords: string[] }> = {
    "MINA:BAUXITA":      { primary: [2441501, 2441502], secondary: [4687701, 6470101, 6499301], keywords: ["alumínio", "aluminum", "bauxita", "metals"] },
    "MINA:FERRO":        { primary: [2411300, 2412100, 2422901], secondary: [4687701, 6470101], keywords: ["siderurgia", "ferro", "aço", "steel"] },
    "MINA:OURO":         { primary: [2451000, 6422100, 6431000], secondary: [6470101, 6499301], keywords: ["ouro", "gold", "metais preciosos"] },
    "MINA:PRATA":        { primary: [2451000, 3211601, 3211602], secondary: [6470101, 4649408], keywords: ["prata", "silver", "joalheria"] },
    "MINA:CALCARIO":     { primary: [2320600, 2330301, 2341900], secondary: [2091600, 4687701], keywords: ["cimento", "calcário", "construção"] },
    "MINA:FOSFATO":      { primary: [2091600, 2092401], secondary: [4683400, 6470101], keywords: ["fertilizante", "fosfato", "agroquímico"] },
    "MINA:COBRE":        { primary: [2442300, 2733300], secondary: [2740601, 4687701], keywords: ["cobre", "copper", "elétrico"] },
    "MINA:NIOBIO":       { primary: [2443100, 2441501], secondary: [3011301, 6470101], keywords: ["nióbio", "aços especiais", "liga metálica"] },
    "MINA:AGUA MINERAL": { primary: [1121600, 4729699], secondary: [4635499, 5590601], keywords: ["água mineral", "bebidas", "engarrafamento"] },
    "MINA:AREIA":        { primary: [2391501, 4120400], secondary: [4330499], keywords: ["areia", "brita", "construção civil"] },
    "MINA:GRANITO":      { primary: [2391502, 4744001], secondary: [4120400], keywords: ["granito", "mármore", "pedra"] },
    "MINA:DIAMANTE":     { primary: [2451000, 3211601, 4783101], secondary: [6470101], keywords: ["diamante", "joalheria", "gema"] },
    "MINA:CAULIM":       { primary: [2319200, 2342701], secondary: [4687701], keywords: ["caulim", "cerâmica", "porcelana"] },
    "MINA:MAGNESITA":    { primary: [2319200, 2399101], secondary: [4687701], keywords: ["magnesita", "refratário"] },
    "MINA:ZINCO":        { primary: [2443100, 2442300], secondary: [4687701, 6470101], keywords: ["zinco", "galvanização"] },
    "MINA:CHUMBO":       { primary: [2443100], secondary: [4687701, 2740601], keywords: ["chumbo", "bateria", "acumulador"] },
    "MINA:CROMO":        { primary: [2443100, 2411300], secondary: [4687701], keywords: ["cromo", "inox", "aços especiais"] },
    "MINA":              { primary: [700600, 729099, 910600], secondary: [6470101, 4687701, 6499301], keywords: ["mineração", "minério", "mining"] },
    "TERRA":             { primary: [6810201, 6810202, 119900, 111301, 111302, 115600, 151201, 151202, 141501, 141502], secondary: [6470101, 6499301, 111399, 161001, 161002, 163600, 210101, 210102, 4623108], keywords: ["fazenda", "terra", "rural", "fundo terra", "agropecuária"] },
    "AGRO":              {
      primary: [
        111301, 111302, 111303, 111399, 112101, 112102, 112199,
        113000, 114800, 115600, 116401, 116402, 116499, 119901, 119999,
        121101, 121102, 131800, 132600, 133401, 133402, 133403, 133499,
        141501, 141502, 142300, 151201, 151202, 152101, 152102,
        153901, 153902, 154700, 155501, 155502, 155503, 155504, 155505, 155509,
        161001, 161002, 161003, 161099, 162801, 162802, 162899, 163600,
        210101, 210102, 210107, 210108, 210109,
        6470101,
      ],
      secondary: [
        1011201, 1011202, 1012101, 1012102, 1012103, 1012104,
        1051100, 1052000, 1053800,
        4622200, 4623101, 4623102, 4623108, 4623109, 4623199,
        4683400,
        6612601, 6612602, 6619302,
        161001, 163600, 210101,
      ],
      keywords: ["agropecuária", "fazenda", "pecuária", "cooperativa agrícola", "fundo agro", "rural"],
    },
    "NEGOCIO":           { primary: [6420000, 6430200, 6470101], secondary: [6499301, 7490199, 6612601], keywords: ["holding", "investimento", "private equity", "M&A"] },
    "FII_CRI":           { primary: [6630400, 6499301, 6810201], secondary: [6420000, 6470101, 4110700], keywords: ["fundo imobiliário", "FII", "CRI", "securitizadora"] },
    "DESENVOLVIMENTO":   { primary: [4110700, 4120400], secondary: [4130300, 6630400, 6810201], keywords: ["incorporadora", "construtora", "loteamento"] },
  };

  function getCnaeConfig(tipo: string, substancia?: string) {
    if (substancia) {
      const sub = stripAccents(substancia.toUpperCase().trim());
      const exact = `${tipo}:${sub}`;
      if (CNAE_MAP[exact]) return CNAE_MAP[exact];
      for (const key of Object.keys(CNAE_MAP)) {
        if (key.startsWith(`${tipo}:`) && sub.includes(key.split(":")[1])) {
          return CNAE_MAP[key];
        }
      }
    }
    return CNAE_MAP[tipo] || CNAE_MAP["NEGOCIO"];
  }

  const APTIDAO_CNAE_MAP: Record<string, { primary: number[]; secondary: number[] }> = {
    "soja": { primary: [111301, 111302, 111303, 111399, 4623108, 4623109], secondary: [1051100, 4683400, 6470101] },
    "milho": { primary: [111301, 111302, 111399, 4623108], secondary: [1066000, 4683400, 6470101] },
    "algodao": { primary: [111399, 131800], secondary: [1340501, 4641901, 6470101] },
    "arroz": { primary: [112101, 112102, 112199], secondary: [1061901, 4623108, 6470101] },
    "trigo": { primary: [111301, 111302, 111399], secondary: [1061902, 4623108, 6470101] },
    "feijao": { primary: [111399, 112199], secondary: [4623108, 6470101] },
    "sorgo": { primary: [111399, 4623108], secondary: [6470101, 4683400] },
    "pecuaria": { primary: [141501, 141502, 142300, 151201, 151202], secondary: [1011201, 1012101, 4622200, 6470101] },
    "gado": { primary: [141501, 141502, 151201, 151202], secondary: [1011201, 1012101, 4622200] },
    "boi": { primary: [141501, 141502, 151201, 151202], secondary: [1011201, 1012101, 4622200] },
    "leite": { primary: [141501, 142300, 1051100, 1052000], secondary: [4622200, 6470101] },
    "suino": { primary: [155501, 155502, 155503], secondary: [1012101, 1012102, 4622200] },
    "aves": { primary: [155504, 155505, 155509], secondary: [1012103, 1012104, 4622200] },
    "frango": { primary: [155504, 155505], secondary: [1012103, 1012104, 4622200] },
    "eucalipto": { primary: [210101, 210102, 210107, 210108], secondary: [1610001, 1610002, 6470101] },
    "pinus": { primary: [210101, 210102, 210109], secondary: [1610001, 1610002, 6470101] },
    "madeira": { primary: [210101, 210102, 161001, 161002], secondary: [1610001, 1620001, 6470101] },
    "cana": { primary: [115600, 116401, 116402, 116499], secondary: [1071600, 1072401, 6470101] },
    "etanol": { primary: [115600, 116401, 1072401], secondary: [6470101, 4681801] },
    "frutas": { primary: [113000, 114800, 119901], secondary: [4637102, 4637199, 6470101] },
    "citrus": { primary: [113000, 114800], secondary: [1033301, 4637102, 6470101] },
    "laranja": { primary: [113000, 1033301], secondary: [4637102, 6470101] },
    "uva": { primary: [121101, 121102], secondary: [1111901, 1111902, 4635401] },
    "vinho": { primary: [121101, 1111901, 1111902], secondary: [4635401, 6470101] },
    "cafe": { primary: [133401, 133402, 133403, 133499], secondary: [1081301, 4637199, 6470101] },
    "irrigacao": { primary: [111301, 111302, 113000], secondary: [3721100, 4623108, 6470101] },
    "aquicultura": { primary: [321301, 321399], secondary: [1020101, 4634601, 6470101] },
    "peixe": { primary: [321301, 321399, 1020101], secondary: [4634601, 6470101] },
  };

  function getCnaeConfigTerra(
    tipo: string,
    aptidao: string | null,
    areaHa: number | null,
    temAgua: boolean,
    geoScore: number | null
  ): { primary: number[]; secondary: number[]; keywords: string[] } {
    const base = CNAE_MAP["TERRA"];
    if (!aptidao) return base;

    const termos = aptidao
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[,;\/\s]+/)
      .map(t => t.trim())
      .filter(t => t.length > 2);

    const primarySet = new Set<number>(base.primary);
    const secondarySet = new Set<number>(base.secondary);
    const keywords: string[] = [...base.keywords];

    for (const termo of termos) {
      for (const [key, config] of Object.entries(APTIDAO_CNAE_MAP)) {
        if (termo.includes(key) || key.includes(termo)) {
          config.primary.forEach(c => primarySet.add(c));
          config.secondary.forEach(c => secondarySet.add(c));
          keywords.push(key);
          break;
        }
      }
    }

    if (areaHa && areaHa >= 10000) {
      primarySet.add(6470101);
      primarySet.add(6499301);
      primarySet.add(6630400);
      keywords.push("fundo terra", "FIAGRO");
    }
    if (areaHa && areaHa >= 50000) {
      primarySet.add(4623108);
      primarySet.add(4683400);
      keywords.push("trading", "agronegócio");
    }
    if (temAgua) {
      APTIDAO_CNAE_MAP["irrigacao"].primary.forEach(c => primarySet.add(c));
      keywords.push("irrigação");
    }
    if (geoScore && geoScore >= 70) {
      primarySet.add(6470101);
      primarySet.add(6630400);
      keywords.push("fundo terra premium");
    }

    return {
      primary: Array.from(primarySet),
      secondary: Array.from(secondarySet),
      keywords: [...new Set(keywords)],
    };
  }

  app.get("/api/prospeccao/reversa", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const {
        tipo = "NEGOCIO",
        estado,
        substancia,
        preco,
        porteOverride,
        estadoOverride,
        ocultarCrm,
        aptidao,
        areaHa,
        geoScore,
        temAgua,
        assetId,
      } = req.query as Record<string, string>;

      const precoNum = preco ? parseFloat(preco) : null;
      const areaHaNum = areaHa ? parseFloat(areaHa) : null;
      const geoScoreNum = geoScore ? parseInt(geoScore) : null;
      const temAguaBool = temAgua === "true";

      let config;
      if ((tipo === "TERRA" || tipo === "AGRO") && aptidao) {
        config = getCnaeConfigTerra(tipo, aptidao, areaHaNum, temAguaBool, geoScoreNum);
      } else {
        config = getCnaeConfig(tipo, substancia);
      }

      const baseParams: Record<string, string> = {
        "status.id.in": "2",
        "head.eq":      "true",
      };

      let porteIds = getPorteIds(tipo, precoNum);
      if (porteOverride === "medio")  porteIds = [4, 5];
      if (porteOverride === "grande") porteIds = [5];
      if (porteOverride !== "all")    baseParams["company.size.id.in"] = porteIds.join(",");

      const equity = getEquityMin(tipo, precoNum);
      if (equity) baseParams["company.equity.gte"] = String(equity);

      if (shouldExcludeSimples(tipo, precoNum)) {
        baseParams["company.simples.optant.eq"] = "false";
        baseParams["company.simei.optant.eq"]   = "false";
      }

      const foundedBefore = getFoundedBefore(tipo);
      if (foundedBefore) baseParams["founded.lte"] = foundedBefore;

      const naturezas = getNaturezas(tipo);
      if (naturezas.length > 0) baseParams["company.nature.id.in"] = naturezas.join(",");

      const useStateFilter = estadoOverride
        ? estadoOverride !== "all"
        : shouldFilterState(tipo);
      const estadoFinal = estadoOverride && estadoOverride !== "all"
        ? estadoOverride
        : estado;
      if (useStateFilter && estadoFinal) baseParams["address.state.in"] = estadoFinal.toUpperCase();

      const savedCompanies = await db.select({ cnpj: companies.cnpj, id: companies.id }).from(companies);
      const savedCnpjMap2 = new Map(savedCompanies.filter((c: any) => c.cnpj).map((c: any) => [c.cnpj!, c.id]));

      const fetchCnpja = async (cnaeIds: number[], opts: { skipState?: boolean } = {}, limit = 35) => {
        const merged = { ...baseParams };
        if (opts.skipState) delete merged["address.state.in"];
        const params = new URLSearchParams(merged);
        params.set("limit", String(limit));
        if (cnaeIds.length > 0) params.set("mainActivity.id.in", cnaeIds.join(","));
        const r = await fetch(`https://api.cnpja.com/office?${params.toString()}`, {
          headers: cnpjaHeaders(),
        });
        if (!r.ok) return [];
        const data = await r.json() as any;
        return (data.records || []).map((rec: any) => ({
          taxId:         rec.taxId,
          legalName:     rec.company?.name || "",
          tradeName:     rec.alias || null,
          porte:         rec.company?.size?.text || null,
          cnaePrincipal: rec.mainActivity?.text || null,
          cnaeCode:      rec.mainActivity?.id || null,
          city:          rec.address?.city || null,
          state:         rec.address?.state || null,
          equity:        rec.company?.equity || null,
          founded:       rec.founded || null,
          alreadySaved:  savedCnpjMap2.has(rec.taxId),
          savedCompanyId: savedCnpjMap2.get(rec.taxId) || null,
          camada:        0,
        }));
      };

      const [primary, secondary] = await Promise.all([
        fetchCnpja(config.primary, {}, 40),
        fetchCnpja(config.secondary, { skipState: true }, 25),
      ]);

      const seen = new Set<string>();
      const allResults: any[] = [];
      for (const r of primary) {
        if (!seen.has(r.taxId)) { seen.add(r.taxId); allResults.push({ ...r, camada: 1 }); }
      }
      for (const r of secondary) {
        if (!seen.has(r.taxId)) { seen.add(r.taxId); allResults.push({ ...r, camada: 2 }); }
      }

      if (allResults.length < 5 && config.keywords.length > 0) {
        const kwParams = new URLSearchParams({
          "status.id.in": "2",
          "head.eq": "true",
          "limit": "20",
          "names.in": config.keywords.slice(0, 3).join(","),
        });
        const r = await fetch(`https://api.cnpja.com/office?${kwParams.toString()}`, {
          headers: cnpjaHeaders(),
        });
        if (r.ok) {
          const data = await r.json() as any;
          for (const rec of (data.records || [])) {
            if (!seen.has(rec.taxId)) {
              seen.add(rec.taxId);
              allResults.push({
                taxId:         rec.taxId,
                legalName:     rec.company?.name || "",
                tradeName:     rec.alias || null,
                porte:         rec.company?.size?.text || null,
                cnaePrincipal: rec.mainActivity?.text || null,
                cnaeCode:      rec.mainActivity?.id || null,
                city:          rec.address?.city || null,
                state:         rec.address?.state || null,
                equity:        rec.company?.equity || null,
                founded:       rec.founded || null,
                alreadySaved:  savedCnpjMap2.has(rec.taxId),
                savedCompanyId: savedCnpjMap2.get(rec.taxId) || null,
                camada:        3,
              });
            }
          }
        }
      }

      const SETORES_IRRELEVANTES_AGRO = [
        "supermercado", "mercado", "mercadinho", "mercearia", "minimercado",
        "restaurante", "lanchonete", "padaria", "pizzaria", "sorveteria", "bar ",
        "farmácia", "drogaria", "perfumaria", "cosmético",
        "confecção", "vestuário", "calçado", "roupa", "moda", "têxtil",
        "barbearia", "salão", "cabeleireiro", "estética", "beleza",
        "pet shop", "petshop", "animais domésticos",
        "posto de combustível", "gasolina", "combustíveis",
        "comércio varejista de artigos", "loja de variedades", "bazar",
        "borracharia", "oficina mecânica", "funilaria", "auto elétrica",
        "academia", "escola", "curso", "ensino",
        "clínica", "consultório", "odontológ", "médic",
        "imobiliária", "corretagem de imóveis",
        "contabilidade", "advocacia", "escritório",
        "gráfica", "papelaria", "livraria",
        "lavanderia", "tinturaria",
        "hotel", "pousada", "motel",
        "ótica", "joalheria", "relojoaria",
        "tabacaria", "conveniência",
        "eletrônic", "informática", "celular", "telefonia",
        "ferragem", "material de construção",
        "funerária",
      ];

      let filtered = allResults;
      if (tipo === "AGRO" || tipo === "TERRA") {
        filtered = allResults.filter(r => {
          if (!r.cnaePrincipal) return true;
          const cnaeText = r.cnaePrincipal.toLowerCase();
          return !SETORES_IRRELEVANTES_AGRO.some(s => cnaeText.includes(s));
        });
      }

      const finalResults = ocultarCrm === "true"
        ? filtered.filter(r => !r.alreadySaved)
        : filtered;

      const assetIdNum = assetId ? parseInt(assetId) : null;
      let sorted = finalResults;

      if (assetIdNum) {
        try {
          const { calculateIntelligentScore, updateCompanyBuyerProfile } = await import("../lib/intelligent-prospecting");
          const [assetRow] = await db.select().from(assets).where(eq(assets.id, assetIdNum));

          if (assetRow) {
            const orgId = getOrgId(req);
            const resultsWithScores = await Promise.all(
              finalResults.map(async (r: any) => {
                const companyId = r.savedCompanyId;
                if (!companyId) {
                  return {
                    ...r,
                    intelligentScore: 50,
                    intelligentConfidence: "low",
                    intelligentBreakdown: null,
                    intelligentReason: "Empresa não está no CRM (sem histórico)",
                  };
                }

                let profile = await db.select().from(companyBuyerProfiles)
                  .where(eq(companyBuyerProfiles.companyId, companyId));

                if (profile.length === 0) {
                  await updateCompanyBuyerProfile(db, companyId, orgId);
                  profile = await db.select().from(companyBuyerProfiles)
                    .where(eq(companyBuyerProfiles.companyId, companyId));
                }

                if (profile.length === 0) {
                  return {
                    ...r,
                    intelligentScore: 50,
                    intelligentConfidence: "low",
                    intelligentBreakdown: null,
                    intelligentReason: "Perfil não disponível",
                  };
                }

                const score = await calculateIntelligentScore(assetRow, companyId, profile[0] as any, db, orgId);
                return {
                  ...r,
                  intelligentScore: score.totalScore,
                  intelligentConfidence: score.confidence,
                  intelligentBreakdown: score.breakdown,
                  intelligentReason: score.humanReason,
                };
              })
            );
            sorted = resultsWithScores.sort((a, b) => (b.intelligentScore || 0) - (a.intelligentScore || 0));
          }
        } catch (scoreErr) {
          console.warn("Intelligent scoring error (non-fatal):", scoreErr);
        }
      }

      res.json({
        count:          sorted.length,
        primaryCount:   sorted.filter(r => r.camada === 1).length,
        secondaryCount: sorted.filter(r => r.camada === 2).length,
        fallbackCount:  sorted.filter(r => r.camada === 3).length,
        results:        sorted,
        meta: {
          aptidaoDetectada: aptidao || null,
          areaHa: areaHaNum || null,
          temAgua: temAguaBool,
          geoScore: geoScoreNum || null,
          cnaesUsados: config.primary.length + config.secondary.length,
        },
      });
    } catch (err) {
      console.error("Prospeccao reversa error:", err);
      res.status(500).json({ message: "Falha na prospecção reversa" });
    }
  });

  app.get("/api/prospeccao/creditos", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const apiKey = process.env.CNPJA_API_KEY;
      if (!apiKey) return res.json({ configured: false, transient: 0, perpetual: 0 });
      const response = await fetch("https://api.cnpja.com/credit", { headers: cnpjaHeaders() });
      if (!response.ok) return res.status(response.status).json({ message: "Erro ao consultar créditos" });
      const data = await response.json();
      res.json({ configured: true, transient: data.transient ?? 0, perpetual: data.perpetual ?? 0 });
    } catch (err) {
      console.error("Credit check error:", err);
      res.status(500).json({ message: "Falha ao consultar créditos" });
    }
  });

  app.post("/api/cnpj/:cnpj/import-as-asset", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const orgId = getOrgId(req);
    const cnpj = req.params.cnpj.replace(/\D/g, "");

    try {
      const cnpjaKey = process.env.CNPJA_API_KEY;
      const cnpjaRes = await fetch(`https://api.cnpja.com/office/${cnpj}`, {
        headers: { Authorization: cnpjaKey || "" }
      });
      const cnpjaData = cnpjaRes.ok ? await cnpjaRes.json() as any : null;

      let [company] = await db.select().from(companies).where(eq(companies.cnpj, cnpj)).limit(1);
      if (!company) {
        company = await storage.createCompany({
          orgId,
          legalName: cnpjaData?.company?.name || cnpj,
          tradeName: cnpjaData?.alias || null,
          cnpj,
          cnaePrincipal: cnpjaData?.mainActivity?.text || null,
          porte: cnpjaData?.company?.size?.text || null,
          phones: cnpjaData?.phones?.map((p: any) => p.number) || [],
          emails: cnpjaData?.emails?.map((e: any) => e.address) || [],
          address: {
            street: cnpjaData?.address?.street,
            city: cnpjaData?.address?.city,
            state: cnpjaData?.address?.state,
          },
          enrichedAt: new Date(),
        });
      }

      const asset = await storage.createAsset({
        orgId,
        type: "NEGOCIO",
        title: cnpjaData?.alias || cnpjaData?.company?.name || `Empresa ${cnpj}`,
        description: cnpjaData?.mainActivity?.text || null,
        estado: cnpjaData?.address?.state || null,
        municipio: cnpjaData?.address?.city || null,
        linkedCompanyId: company.id,
        statusAtivo: "ativo",
        docsStatus: "pendente",
        camposEspecificos: {
          cnpj,
          origemAtivo: "prospeccao_cnpj",
          cnaePrincipal: cnpjaData?.mainActivity?.text || null,
        },
      });

      setImmediate(() => {
        runMatchingForAsset(asset.id, orgId, storage, db).catch(err =>
          console.error(`[Auto-match] Falha para ativo ${asset.id}:`, err.message)
        );
      });

      res.json({ asset, company, message: "Ativo NEGOCIO criado com sucesso" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
