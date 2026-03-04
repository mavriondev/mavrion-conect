import type { Express } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { companies } from "@shared/schema";

const cnpjaHeaders = () => ({
  "Authorization": process.env.CNPJA_API_KEY || "",
});

export function registerProspeccaoRoutes(app: Express, db: NodePgDatabase<any>) {
  app.get("/api/prospeccao/search", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const q = req.query as Record<string, string>;
      const {
        names, state, cnae, cnae_side, size, status: statusParam,
        nature, simples, mei, head, has_phone, has_email,
        founded_from, founded_to, equity_min, equity_max, ddd,
        limit = "50",
      } = q;

      const params = new URLSearchParams();
      params.set("limit", String(Math.min(Number(limit), 100)));

      if (names) params.set("names.in", names);
      if (state) params.set("address.state.in", state.split(",").map(s => s.trim()).join(","));

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

      const savedCompanies = await db.select({ cnpj: companies.cnpj }).from(companies);
      const savedCnpjs = new Set(savedCompanies.map(c => c.cnpj).filter(Boolean));

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
        alreadySaved: savedCnpjs.has(r.taxId),
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
    "TERRA":             { primary: [6810201, 6810202, 119900], secondary: [6470101, 6499301, 111399], keywords: ["fazenda", "terra", "rural", "fundo terra"] },
    "AGRO":              { primary: [111301, 111302, 111303, 115600], secondary: [111399, 1011201, 4623108, 6470101], keywords: ["agro", "grãos", "soja", "cooperativa", "trading"] },
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
      } = req.query as Record<string, string>;

      const precoNum = preco ? parseFloat(preco) : null;
      const config = getCnaeConfig(tipo, substancia);

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

      const savedCompanies = await db.select({ cnpj: companies.cnpj }).from(companies);
      const savedCnpjs = new Set(savedCompanies.map((c: any) => c.cnpj).filter(Boolean));

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
          alreadySaved:  savedCnpjs.has(rec.taxId),
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
                alreadySaved:  savedCnpjs.has(rec.taxId),
                camada:        3,
              });
            }
          }
        }
      }

      const finalResults = ocultarCrm === "true"
        ? allResults.filter(r => !r.alreadySaved)
        : allResults;

      res.json({
        count:          finalResults.length,
        primaryCount:   finalResults.filter(r => r.camada === 1).length,
        secondaryCount: finalResults.filter(r => r.camada === 2).length,
        fallbackCount:  finalResults.filter(r => r.camada === 3).length,
        results:        finalResults,
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
}
