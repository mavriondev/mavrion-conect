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
