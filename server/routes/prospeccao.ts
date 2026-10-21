import type { Express } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and, inArray, sql } from "drizzle-orm";
import { companies, ibgeMunicipios } from "@shared/schema";
import { storage } from "../storage";
import { getOrgId } from "../lib/tenant";
import * as XLSX from "xlsx";
import { inflateRawSync } from "zlib";
import OpenAI from "openai";
import { getCompanyProspectionState } from "../lib/company-prospecting";

function extractFromZip(zipBuffer: Buffer): Buffer {
  const entries: Array<{ name: string; offset: number; compSize: number; uncompSize: number; method: number }> = [];
  let pos = 0;
  while (pos + 30 <= zipBuffer.length) {
    if (zipBuffer.readUInt32LE(pos) !== 0x04034b50) break;
    const method = zipBuffer.readUInt16LE(pos + 8);
    const compSize = zipBuffer.readUInt32LE(pos + 18);
    const uncompSize = zipBuffer.readUInt32LE(pos + 22);
    const nameLen = zipBuffer.readUInt16LE(pos + 26);
    const extraLen = zipBuffer.readUInt16LE(pos + 28);
    const name = zipBuffer.toString("utf-8", pos + 30, pos + 30 + nameLen);
    const dataOffset = pos + 30 + nameLen + extraLen;
    entries.push({ name, offset: dataOffset, compSize, uncompSize, method });
    pos = dataOffset + compSize;
  }
  const xlsEntry = entries.find(e => /\.(xlsx|xls|csv)$/i.test(e.name) && !e.name.includes("__MACOSX"));
  if (!xlsEntry) throw new Error("Nenhum arquivo XLSX/CSV encontrado dentro do ZIP");
  const raw = zipBuffer.subarray(xlsEntry.offset, xlsEntry.offset + xlsEntry.compSize);
  if (xlsEntry.method === 0) return Buffer.from(raw);
  return Buffer.from(inflateRawSync(raw));
}

function parseDatastoneXlsx(rawBuffer: Buffer): any[] {
  let buffer = rawBuffer;
  const isZipMagic = rawBuffer.length > 4 && rawBuffer.readUInt32LE(0) === 0x04034b50;
  if (isZipMagic) {
    try {
      const wb = XLSX.read(rawBuffer, { type: "buffer" });
      if (wb?.SheetNames?.length > 0) {
        buffer = rawBuffer;
      }
    } catch {
      try {
        buffer = extractFromZip(rawBuffer);
        console.log(`[Datastone] Extracted inner file from ZIP: ${buffer.length} bytes`);
      } catch (zipErr: any) {
        console.error("[Datastone] ZIP extraction failed:", zipErr.message);
      }
    }
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (e1) {
    try {
      workbook = XLSX.read(buffer, { type: "buffer", raw: true });
    } catch (e2) {
      const text = buffer.toString("utf-8");
      if (text.includes(",") || text.includes(";")) {
        const sep = text.includes(";") ? ";" : ",";
        workbook = XLSX.read(text, { type: "string", FS: sep });
      } else {
        throw new Error(`Formato de arquivo não suportado (${buffer.length} bytes, início: ${buffer.slice(0, 4).toString("hex")})`);
      }
    }
  }
  const sheetName = workbook.SheetNames.find(n => !n.toLowerCase().includes("socio")) || workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rows.length < 2) return [];

  const headers = rows[0].map((h: any) => String(h || "").toLowerCase().trim());
  const colIdx = (name: string) => headers.indexOf(name);

  return rows.slice(1).map(row => {
    const get = (name: string) => {
      const idx = colIdx(name);
      return idx >= 0 ? String(row[idx] || "").trim() : "";
    };
    const cnpj = get("cnpj").replace(/\D/g, "");
    if (!cnpj) return null;

    const phones: string[] = [];
    for (const prefix of ["tel", "cel"]) {
      for (let i = 1; i <= 3; i++) {
        const ddd = get(`ddd_${prefix}${i}`);
        const num = get(`${prefix}${i}`);
        if (ddd && num && num !== "N") phones.push(`(${ddd}) ${num}`);
      }
    }

    const emails: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const email = get(`email_${i}`);
      if (email && email.includes("@")) emails.push(email);
    }

    return {
      taxId: cnpj,
      legalName: get("company_name") || get("trading_name") || "",
      tradeName: get("trading_name") || null,
      status: "Ativa",
      statusId: 2,
      porte: get("business_size") || null,
      cnaePrincipal: get("cnae_description") || null,
      cnaeCode: get("cnae_code") || null,
      city: get("city") || null,
      state: get("district") || null,
      founded: get("creation_date") || null,
      faturamento: get("estimated_revenue") || null,
      funcionarios: get("employee_count") || null,
      phones,
      emails,
      source: "datastone",
    };
  }).filter(Boolean);
}

const cnpjaHeaders = () => ({
  "Authorization": process.env.CNPJA_API_KEY || "",
});

function normalizeStr(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

let _dbRef: NodePgDatabase<any> | null = null;
function setDbRef(db: NodePgDatabase<any>) { _dbRef = db; }

async function getMunicipiosByUf(ufs: string[]): Promise<{ nome: string; codigoIbge: number; uf: string }[]> {
  if (!_dbRef || ufs.length === 0) return [];
  const rows = await _dbRef
    .select({ nome: ibgeMunicipios.nome, codigoIbge: ibgeMunicipios.codigoIbge, uf: ibgeMunicipios.uf })
    .from(ibgeMunicipios)
    .where(inArray(ibgeMunicipios.uf, ufs.map(u => u.toUpperCase())));
  return rows.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

async function cidadesParaCodigosIbge(cidades: string[], uf?: string): Promise<number[]> {
  if (!_dbRef) return [];
  const ufs = uf ? uf.split(",").map(u => u.trim().toUpperCase()).filter(Boolean) : [];
  const normalizedCities = cidades.map(c => c.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const conditions: any[] = [inArray(sql`lower(unaccent(${ibgeMunicipios.nome}))`, normalizedCities)];
  if (ufs.length > 0) conditions.push(inArray(ibgeMunicipios.uf, ufs));
  const rows = await _dbRef
    .select({ codigoIbge: ibgeMunicipios.codigoIbge })
    .from(ibgeMunicipios)
    .where(and(...conditions));
  return rows.map(r => r.codigoIbge);
}

const FATURAMENTO_RANGES: Record<string, { lower?: string; upper?: string; label: string }> = {
  "ate_81k": { upper: "81000", label: "Até R$ 81 mil" },
  "81k_360k": { lower: "81000", upper: "360000", label: "R$ 81 mil a R$ 360 mil" },
  "360k_4m8": { lower: "360000", upper: "4800000", label: "R$ 360 mil a R$ 4,8 mi" },
  "4m8_10m": { lower: "4800000", upper: "10000000", label: "R$ 4,8 mi a R$ 10 mi" },
  "10m_50m": { lower: "10000000", upper: "50000000", label: "R$ 10 mi a R$ 50 mi" },
  "50m_300m": { lower: "50000000", upper: "300000000", label: "R$ 50 mi a R$ 300 mi" },
  "acima_300m": { lower: "300000000", label: "Acima de R$ 300 mi" },
};

export function registerProspeccaoRoutes(app: Express, db: NodePgDatabase<any>) {
  setDbRef(db);

  app.get("/api/prospeccao/cidades", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const estados = (req.query.estados as string || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      if (estados.length === 0) return res.json([]);
      const cidades = await getMunicipiosByUf(estados);
      res.json(cidades.map(c => ({ nome: c.nome, uf: c.uf })));
    } catch (err) {
      console.error("Erro ao buscar cidades:", err);
      res.status(500).json({ message: "Falha ao buscar cidades" });
    }
  });

  function buildDatastoneApiBody(params: any): any {
    const { faturamento, estados, cidades, cnaes, nome, porte, naturezas, simples, mei, sede, funcionarios, capital, contato } = params;
    const body: any = {};
    if (nome) body.name = nome;
    if (estados?.length) body.states = estados;
    if (cidades?.length) body.cities = cidades.map((c: string) => c.includes(" - ") ? c.split(" - ")[0].trim() : c);
    if (cnaes?.length) body.cnae_codes = cnaes;
    if (porte?.length) body.company_type = porte;
    if (naturezas?.length) body.nature_codes = naturezas;
    if (simples === "true") body.simple_type = "SIM";
    else if (simples === "false") body.simple_type = "NAO";
    if (mei === "true") body.mei_type = "SIM";
    else if (mei === "false") body.mei_type = "NAO";
    if (funcionarios?.length) {
      body.estimated_employees = funcionarios.map((key: string) => {
        const map: Record<string, {lower?: number; upper?: number}> = {
          "1_5": { lower: 1, upper: 5 },
          "6_10": { lower: 6, upper: 10 },
          "11_20": { lower: 11, upper: 20 },
          "21_50": { lower: 21, upper: 50 },
          "51_100": { lower: 51, upper: 100 },
          "101_500": { lower: 101, upper: 500 },
          "501_plus": { lower: 501 },
        };
        return map[key] || null;
      }).filter(Boolean);
    }
    if (capital?.length) {
      body.capitals = capital.map((key: string) => {
        const map: Record<string, {lower?: number; upper?: number}> = {
          "ate_10k": { upper: 10000 },
          "10k_50k": { lower: 10000, upper: 50000 },
          "50k_100k": { lower: 50000, upper: 100000 },
          "100k_500k": { lower: 100000, upper: 500000 },
          "500k_1m": { lower: 500000, upper: 1000000 },
          "1m_5m": { lower: 1000000, upper: 5000000 },
          "acima_5m": { lower: 5000000 },
        };
        return map[key] || null;
      }).filter(Boolean);
    }
    if (contato?.length) body.contact_channels = contato;
    if (faturamento?.length) {
      body.revenues = faturamento.map((key: string) => {
        const range = FATURAMENTO_RANGES[key];
        if (!range) return null;
        const r: any = {};
        if (range.lower) r.lower = range.lower;
        if (range.upper) r.upper = range.upper;
        return r;
      }).filter(Boolean);
    }
    return body;
  }

  app.post("/api/prospeccao/datastone-count", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const token = process.env.DATASTONE_TOKEN;
      if (!token) return res.status(400).json({ message: "Token Datastone não configurado" });

      const body: any = { ...buildDatastoneApiBody(req.body), export: false };

      const response = await fetch("https://api.datastone.com.br/v1/company/prospect/", {
        method: "POST",
        headers: { "Authorization": `Token ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        const errStr = JSON.stringify(err);
        if (errStr.includes("locale filter")) {
          return res.status(400).json({ message: "Selecione pelo menos um estado para pesquisar no Datastone." });
        }
        return res.status(response.status).json({ message: err?.error?.description || err?.detail || "Erro na contagem" });
      }

      const data = await response.json() as any;
      res.json({ count: Array.isArray(data.count) ? data.count[0] : data.count || 0 });
    } catch (err) {
      console.error("Datastone count error:", err);
      res.status(500).json({ message: "Falha na contagem Datastone" });
    }
  });

  app.post("/api/prospeccao/datastone-search", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const token = process.env.DATASTONE_TOKEN;
      if (!token) return res.status(400).json({ message: "Token Datastone não configurado" });
      const { quantidade = 25 } = req.body;

      const body: any = {
        ...buildDatastoneApiBody(req.body),
        export: true,
        name: `mavrion_${Date.now()}`,
        plan: "3",
        quantity: Math.min(Number(quantidade) || 25, 200),
      };

      const createResp = await fetch("https://api.datastone.com.br/v1/company/prospect/", {
        method: "POST",
        headers: { "Authorization": `Token ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!createResp.ok) {
        const err = await createResp.json().catch(() => ({})) as any;
        console.error("[Datastone search] Erro:", JSON.stringify(err));
        const errStr = JSON.stringify(err);
        if (errStr.includes("locale filter")) {
          return res.status(400).json({ message: "Selecione pelo menos um estado para pesquisar no Datastone." });
        }
        return res.status(createResp.status).json({ message: err?.error?.description || err?.export?.[0] || err?.detail || errStr || "Erro ao criar prospecção" });
      }

      const createData = await createResp.json() as any;
      const jobId = createData.id;
      if (!jobId) return res.status(500).json({ message: "Erro: job_id não retornado" });

      let fileUrl: string | null = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(r => setTimeout(r, 2000));
        const resultResp = await fetch(`https://api.datastone.com.br/v1/prospection/${jobId}/result/`, {
          headers: { "Authorization": `Token ${token}` },
        });
        if (resultResp.ok) {
          const resultData = await resultResp.json() as any;
          if (resultData.file) { fileUrl = resultData.file; break; }
          if (resultData.status === "error") return res.status(500).json({ message: "Erro no processamento da prospecção" });
        }
      }

      if (!fileUrl) return res.status(504).json({ message: "Tempo esgotado aguardando resultado da prospecção" });

      const xlsxResp = await fetch(fileUrl);
      if (!xlsxResp.ok) return res.status(500).json({ message: "Erro ao baixar arquivo de resultados" });
      const buffer = Buffer.from(await xlsxResp.arrayBuffer());
      console.log(`[Datastone] File downloaded: ${buffer.length} bytes, magic: ${buffer.slice(0, 4).toString("hex")}, url: ${fileUrl}`);

      const results = parseDatastoneXlsx(buffer);

      const { savedCnpjMap, discardedCnpjs } = await getCompanyProspectionState(db, getOrgId(req));

      const enriched = results.filter(r => !discardedCnpjs.has(r.taxId)).map(r => ({
        ...r,
        alreadySaved: savedCnpjMap.has(r.taxId),
        savedCompanyId: savedCnpjMap.get(r.taxId) || null,
      }));

      res.json({ count: enriched.length, results: enriched, source: "datastone" });
    } catch (err: any) {
      console.error("Datastone search error:", err);
      res.status(500).json({ message: err?.message || "Falha na busca Datastone" });
    }
  });

  app.post("/api/prospeccao/unified-search", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const {
        faturamento, funcionarios, estados, cidades, cnaes, cnaeSide,
        nome, naturezas, simples, mei, sede, capital, contato,
        foundedFrom, foundedTo, equityMin, equityMax, socioName,
        quantidade = 50,
      } = req.body;

      const usesDatastone = (faturamento?.length > 0) || (funcionarios?.length > 0);

      const { savedCnpjMap, discardedCnpjs } = await getCompanyProspectionState(db, getOrgId(req));

      if (usesDatastone) {
        const token = process.env.DATASTONE_TOKEN;
        if (!token) return res.status(400).json({ message: "Token Datastone não configurado" });

        const dsBody: any = {
          ...buildDatastoneApiBody({
            faturamento, estados, cidades, cnaes, nome, naturezas, simples, mei, sede, funcionarios, capital, contato,
          }),
          export: true,
          name: `mavrion_${Date.now()}`,
          plan: "3",
          quantity: Math.min(Number(quantidade) || 20, 20),
        };

        const createResp = await fetch("https://api.datastone.com.br/v1/company/prospect/", {
          method: "POST",
          headers: { "Authorization": `Token ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(dsBody),
        });

        if (!createResp.ok) {
          const err = await createResp.json().catch(() => ({})) as any;
          const errStr = JSON.stringify(err);
          if (errStr.includes("locale filter")) {
            return res.status(400).json({ message: "Selecione pelo menos um estado para pesquisar no Datastone." });
          }
          return res.status(createResp.status).json({ message: err?.error?.description || err?.export?.[0] || err?.detail || "Erro ao criar prospecção" });
        }

        const createData = await createResp.json() as any;
        const jobId = createData.id;
        if (!jobId) return res.status(500).json({ message: "Erro: job_id não retornado" });

        let fileUrl: string | null = null;
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          const resultResp = await fetch(`https://api.datastone.com.br/v1/prospection/${jobId}/result/`, {
            headers: { "Authorization": `Token ${token}` },
          });
          if (resultResp.ok) {
            const resultData = await resultResp.json() as any;
            if (resultData.file) { fileUrl = resultData.file; break; }
            if (resultData.status === "error") return res.status(500).json({ message: "Erro no processamento da prospecção" });
          }
        }

        if (!fileUrl) return res.status(504).json({ message: "Tempo esgotado aguardando resultado da prospecção" });

        const xlsxResp = await fetch(fileUrl);
        if (!xlsxResp.ok) return res.status(500).json({ message: "Erro ao baixar arquivo de resultados" });
        const buffer = Buffer.from(await xlsxResp.arrayBuffer());
        const dsResults = parseDatastoneXlsx(buffer);

        const cnpjaKey = process.env.CNPJA_API_KEY;
        const enrichedResults = await Promise.all(
          dsResults.map(async (r: any) => {
            let phones = r.phones || [];
            let emails = r.emails || [];
            let address: string | null = null;

            if (cnpjaKey && r.taxId) {
              try {
                const cnpjaRes = await fetch(`https://api.cnpja.com/office/${r.taxId}?strategy=CACHE_IF_FRESH&maxAge=30`, {
                  headers: { Authorization: cnpjaKey },
                });
                if (cnpjaRes.ok) {
                  const cnpjaData = await cnpjaRes.json() as any;
                  const cnpjaPhones = (cnpjaData.phones || []).map((p: any) => {
                    const area = p.area ? `(${p.area}) ` : "";
                    return `${area}${p.number}`;
                  }).filter(Boolean);
                  const cnpjaEmails = (cnpjaData.emails || []).map((e: any) => e.address).filter(Boolean);

                  if (cnpjaPhones.length > 0) phones = [...new Set([...phones, ...cnpjaPhones])];
                  if (cnpjaEmails.length > 0) emails = [...new Set([...emails, ...cnpjaEmails])];

                  if (cnpjaData.address) {
                    const a = cnpjaData.address;
                    address = [a.street, a.number, a.district, a.city, a.state].filter(Boolean).join(", ");
                  }
                }
              } catch (e) {
                console.error(`[Unified] CNPJA enrich error for ${r.taxId}:`, e);
              }
            }

            return {
              ...r,
              phones,
              emails,
              address,
              alreadySaved: savedCnpjMap.has(r.taxId),
              savedCompanyId: savedCnpjMap.get(r.taxId) || null,
              source: "datastone+cnpja",
            };
          })
        );

        return res.json({
          count: enrichedResults.filter(r => !discardedCnpjs.has(r.taxId)).length,
          results: enrichedResults.filter(r => !discardedCnpjs.has(r.taxId)),
          source: "Datastone + CNPJA",
          engine: "datastone",
        });
      } else {
        const params = new URLSearchParams();
        params.set("limit", String(Math.min(Number(quantidade) || 50, 100)));

        if (nome) params.set("names.in", nome);
        if (estados?.length) params.set("address.state.in", estados.join(","));
        if (cidades?.length) {
          const cityNames = cidades.map((c: string) => c.includes(" - ") ? c.split(" - ")[0].trim() : c);
          const codigos = await cidadesParaCodigosIbge(cityNames, estados?.join(","));
          if (codigos.length > 0) {
            params.set("address.municipality.in", codigos.join(","));
          }
        }
        if (cnaes?.length) {
          const codes = cnaes.map((c: any) => parseInt(String(c), 10)).filter((n: number) => !isNaN(n));
          if (codes.length > 0) params.set("mainActivity.id.in", codes.join(","));
        }
        if (cnaeSide?.length) {
          const codes = cnaeSide.map((c: any) => parseInt(String(c), 10)).filter((n: number) => !isNaN(n));
          if (codes.length > 0) params.set("sideActivities.id.in", codes.join(","));
        }
        if (naturezas?.length) params.set("company.nature.id.in", naturezas.join(","));
        if (simples === "true") params.set("company.simples.optant.eq", "true");
        if (simples === "false") params.set("company.simples.optant.eq", "false");
        if (mei === "true") params.set("company.simei.optant.eq", "true");
        if (mei === "false") params.set("company.simei.optant.eq", "false");
        if (sede === "true") params.set("head.eq", "true");
        if (sede === "false") params.set("head.eq", "false");
        if (foundedFrom) params.set("founded.gte", foundedFrom);
        if (foundedTo) params.set("founded.lte", foundedTo);
        if (equityMin) params.set("company.equity.gte", equityMin);
        if (equityMax) params.set("company.equity.lte", equityMax);
        if (socioName) params.set("company.members.person.name.in", socioName);

        const apiUrl = `https://api.cnpja.com/office?${params.toString()}`;
        const response = await fetch(apiUrl, { headers: cnpjaHeaders() });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({})) as any;
          return res.status(response.status).json({ message: errBody.message || "Erro na busca" });
        }

        const data = await response.json() as any;
        // A CNPJA removeu o parâmetro de busca `status`; filtrar a situação
        // cadastral na resposta mantém apenas estabelecimentos ativos.
        const records: any[] = (data.records || [])
          .filter((r: any) => Number(r.status?.id) === 2);

        const mappedResults = records.map((r: any) => ({
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
          capitalSocial: r.company?.equity || null,
          phones: (r.phones || []).map((p: any) => {
            const area = p.area ? `(${p.area}) ` : "";
            return `${area}${p.number}`;
          }).filter(Boolean),
          emails: (r.emails || []).map((e: any) => e.address).filter(Boolean),
          faturamento: null as string | null,
          faturamentoEstimado: false,
          funcionarios: null as string | null,
          alreadySaved: savedCnpjMap.has(r.taxId),
          savedCompanyId: savedCnpjMap.get(r.taxId) || null,
          source: "cnpja",
        }));

        let resultsWithEstimate = mappedResults;
        if (process.env.OPENAI_API_KEY && mappedResults.length > 0) {
          try {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const estimatePromises = mappedResults.map(async (r) => {
              try {
                const prompt = [
                  `Estime a faixa de faturamento anual desta empresa brasileira com base nos dados públicos abaixo.`,
                  `Responda APENAS com uma das opções: "Até R$ 81 mil", "R$ 81 mil – R$ 360 mil", "R$ 360 mil – R$ 4,8 mi", "R$ 4,8 mi – R$ 10 mi", "R$ 10 mi – R$ 50 mi", "R$ 50 mi – R$ 300 mi", "Acima de R$ 300 mi".`,
                  ``,
                  `Dados:`,
                  `- Razão Social: ${r.legalName}`,
                  `- Nome Fantasia: ${r.tradeName || "N/D"}`,
                  `- Porte: ${r.porte || "N/D"}`,
                  `- Capital Social: ${r.capitalSocial ? `R$ ${Number(r.capitalSocial).toLocaleString("pt-BR")}` : "N/D"}`,
                  `- CNAE Principal: ${r.cnaePrincipal || "N/D"}`,
                  `- Cidade/Estado: ${[r.city, r.state].filter(Boolean).join("/") || "N/D"}`,
                  `- Data de Fundação: ${r.founded || "N/D"}`,
                ].join("\n");

                const completion = await openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [{ role: "user", content: prompt }],
                  max_tokens: 50,
                  temperature: 0.3,
                });

                const estimate = completion.choices[0]?.message?.content?.trim() || null;
                return { ...r, faturamento: estimate, faturamentoEstimado: true };
              } catch {
                return r;
              }
            });

            resultsWithEstimate = await Promise.all(estimatePromises);
          } catch (e) {
            console.error("[Unified] GPT estimation batch error:", e);
          }
        }

        return res.json({
          count: resultsWithEstimate.filter(r => !discardedCnpjs.has(r.taxId)).length,
          results: resultsWithEstimate.filter(r => !discardedCnpjs.has(r.taxId)),
          source: "CNPJA",
          engine: "cnpja",
        });
      }
    } catch (err: any) {
      console.error("Unified search error:", err);
      res.status(500).json({ message: err?.message || "Falha na busca unificada" });
    }
  });

  app.get("/api/prospeccao/search", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const q = req.query as Record<string, string>;
      const {
        names, state, city, cnae, cnae_side, size, status: statusParam,
        nature, simples, mei, head, has_phone, has_email,
        founded_from, founded_to, equity_min, equity_max, ddd,
        cep, bairro, age_min, age_max, socio_name,
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
        } else if (cidadesArr.length > 0) {
          return res.status(400).json({
            message: `Cidade(s) não encontrada(s) na base IBGE: ${cidadesArr.join(", ")}. Verifique a grafia (sem acentos, maiúsculo).`,
            warning: "city_not_found",
            cities: cidadesArr,
          });
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
      if (cep) params.set("address.zip.in", cep.split(",").map(c => c.trim()).join(","));
      if (bairro) params.set("address.district.in", bairro.split(",").map(b => b.trim()).join(","));
      if (age_min) params.set("age.gte", age_min);
      if (age_max) params.set("age.lte", age_max);
      if (socio_name) params.set("company.members.person.name.in", socio_name);

      const apiUrl = `https://api.cnpja.com/office?${params.toString()}`;
      const response = await fetch(apiUrl, { headers: cnpjaHeaders() });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({})) as any;
        return res.status(response.status).json({ message: errBody.message || "Erro na busca" });
      }

      const data = await response.json() as any;
      const records: any[] = data.records || [];

      const { savedCnpjMap, discardedCnpjs } = await getCompanyProspectionState(db, getOrgId(req));

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

      res.json({ count: results.filter((r: any) => !discardedCnpjs.has(r.taxId)).length, next: data.next, results: results.filter((r: any) => !discardedCnpjs.has(r.taxId)) });
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
        } as any,
      });

      res.json({ asset, company, message: "Ativo NEGOCIO criado com sucesso" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
