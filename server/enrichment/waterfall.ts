import { spawn } from "child_process";
import path from "path";

export interface EnrichmentResult {
  phones: string[];
  emails: string[];
  website?: string;
  linkedin?: string;
  source: "bigdatacorp" | "datastone" | "scraper" | "none";
  employeeCount?: string;
  estimatedRevenue?: string;
  shareCapital?: number;
  tradingName?: string;
  partners?: Array<{ name: string; cpf?: string; cnpj?: string; ownership?: number; qualification?: string }>;
  raw?: any;
}

function hasSufficientData(r: Partial<EnrichmentResult>): boolean {
  return (r.phones?.length ?? 0) > 0 || (r.emails?.length ?? 0) > 0;
}

async function enrichViaBigDataCorp(cnpj: string): Promise<Partial<EnrichmentResult>> {
  const token = process.env.BIGDATACORP_TOKEN;
  if (!token) return {};
  try {
    const cnpjClean = cnpj.replace(/\D/g, "");
    const response = await fetch("https://plataforma.bigdatacorp.com.br/empresas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "AccessToken": token },
      body: JSON.stringify({ Datasets: "phones,emails,basic_data", q: `doc{${cnpjClean}}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { console.warn(`[BDC] HTTP ${response.status}`); return {}; }
    const data = await response.json();
    const phones = (data?.phones?.Phones || []).map((p: any) => p.Number || p.PhoneNumber || p.number || "").filter(Boolean).slice(0, 5);
    const emails = (data?.emails?.Emails || []).map((e: any) => e.Email || e.email || "").filter(Boolean).slice(0, 5);
    const website = data?.basic_data?.SiteList?.[0] || data?.basic_data?.Website || undefined;
    return { phones, emails, website, source: "bigdatacorp", raw: data };
  } catch (err: any) { console.warn("[BDC] Erro:", err.message); return {}; }
}

async function enrichViaDataStone(cnpj: string): Promise<Partial<EnrichmentResult>> {
  const token = process.env.DATASTONE_TOKEN;
  if (!token) return {};
  try {
    const cnpjClean = cnpj.replace(/\D/g, "");
    const response = await fetch(
      `https://api.datastone.com.br/v1/companies/?cnpj=${cnpjClean}`,
      { method: "GET", headers: { "Authorization": `Token ${token}`, "Accept": "application/json" }, signal: AbortSignal.timeout(15_000) }
    );
    if (!response.ok) { console.warn(`[DataStone] HTTP ${response.status}`); return {}; }
    const raw = await response.json();
    const data = Array.isArray(raw) ? raw[0] : raw;
    if (!data) return {};
    const landLines = (data.land_lines || []).map((p: any) => {
      if (typeof p === "string") return p;
      return p?.ddd && p?.number ? `(${p.ddd}) ${p.number}` : (p?.number || "");
    }).filter(Boolean);
    const mobiles = (data.mobile_phones || []).map((p: any) => {
      if (typeof p === "string") return p;
      return p?.ddd && p?.number ? `(${p.ddd}) ${p.number}` : (p?.number || "");
    }).filter(Boolean);
    const emails = (data.emails || []).map((e: any) => typeof e === "string" ? e : e?.email || "").filter(Boolean);
    const partners = (data.partners || []).map((p: any) => ({
      name: p.name || "",
      cpf: p.cpf || undefined,
      cnpj: p.cnpj || undefined,
      ownership: p.ownership ?? undefined,
      qualification: p.qualification || undefined,
    }));
    return {
      phones: [...mobiles, ...landLines].slice(0, 5),
      emails: emails.slice(0, 5),
      website: data.website || undefined,
      source: "datastone",
      employeeCount: data.employee_count || undefined,
      estimatedRevenue: data.estimated_revenue || undefined,
      shareCapital: data.share_capital ? parseFloat(data.share_capital) : undefined,
      tradingName: data.trading_name || undefined,
      partners,
      raw: data,
    };
  } catch (err: any) { console.warn("[DataStone] Erro:", err.message); return {}; }
}

async function enrichViaScraper(name: string, cnpj: string, website?: string, knownPhones?: string[]): Promise<Partial<EnrichmentResult>> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), "server", "enrichment", "scraper.py");
    const args = ["--name", name, "--cnpj", cnpj];
    if (website) args.push("--website", website.replace(/^https?:\/\//, ""));
    if (knownPhones?.length) args.push("--phones", knownPhones.join(","));
    const proc = spawn("python3", [scriptPath, ...args], { env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d: Buffer) => stdout += d.toString());
    proc.stderr.on("data", (d: Buffer) => stderr += d.toString());
    proc.on("close", (code: number) => {
      if (code !== 0) { console.warn("[Scraper] saiu com código", code, stderr.slice(0, 200)); resolve({}); return; }
      try {
        const r = JSON.parse(stdout);
        const m = r.merged || {};
        resolve({ phones: m.phones || [], emails: m.emails || [], website: m.website, linkedin: m.linkedin, source: "scraper", raw: r });
      } catch { resolve({}); }
    });
    setTimeout(() => { proc.kill(); console.warn("[Scraper] timeout"); resolve({}); }, 90_000);
  });
}

export async function waterfallEnrich(params: {
  cnpj: string; name: string; website?: string; knownPhones?: string[];
}): Promise<EnrichmentResult> {
  const { cnpj, name, website, knownPhones } = params;

  if (cnpj && process.env.BIGDATACORP_TOKEN) {
    const bdc = await enrichViaBigDataCorp(cnpj);
    if (hasSufficientData(bdc)) {
      console.log(`[Waterfall] BigDataCorp encontrou dados para ${cnpj}`);
      return { phones: bdc.phones || [], emails: bdc.emails || [], website: bdc.website, source: "bigdatacorp", raw: bdc.raw };
    }
    console.log("[Waterfall] BDC sem dados — tentando DataStone...");
  }

  if (cnpj && process.env.DATASTONE_TOKEN) {
    const ds = await enrichViaDataStone(cnpj);
    const hasStructuredData = hasSufficientData(ds) || !!ds.employeeCount || !!ds.estimatedRevenue || ds.shareCapital !== undefined;
    if (hasStructuredData) {
      console.log(`[Waterfall] DataStone encontrou dados para ${cnpj}`);
      return {
        phones: ds.phones || [], emails: ds.emails || [], website: ds.website, source: "datastone",
        employeeCount: ds.employeeCount, estimatedRevenue: ds.estimatedRevenue,
        shareCapital: ds.shareCapital, tradingName: ds.tradingName, partners: ds.partners,
        raw: ds.raw,
      };
    }
    console.log("[Waterfall] DataStone sem dados — usando scraper...");
  }

  console.log("[Waterfall] Usando scraper como fallback...");
  const s = await enrichViaScraper(name, cnpj, website, knownPhones);
  return {
    phones: s.phones || [], emails: s.emails || [], website: s.website, linkedin: s.linkedin,
    source: (s.phones?.length || s.emails?.length) ? "scraper" : "none", raw: s.raw,
  };
}