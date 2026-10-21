import type { Express } from "express";

export function registerCvmRoutes(app: Express) {
  app.get("/api/cvm/fundos", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const q = (req.query.q as string || "").trim();
      if (q.length < 3) return res.json({ fundos: [] });

      const isCnpj = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(q) || /^\d{14}$/.test(q);
      const cnpjClean = q.replace(/\D/g, "");

      let url: string;
      if (isCnpj) {
        url = `https://dados.cvm.gov.br/api/v1/fis/fdo/dados_cadastrais/?cnpj_fundo=${cnpjClean}&formato=json`;
      } else {
        url = `https://dados.cvm.gov.br/api/v1/fis/fdo/dados_cadastrais/?denom_social=${encodeURIComponent(q)}&formato=json`;
      }

      const resp = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        return res.json({ fundos: [], error: `CVM retornou ${resp.status}` });
      }

      const data = await resp.json();
      const registros = data?.dados || data?.results || [];

      const fundos = registros.slice(0, 50).map((r: any) => ({
        cnpj: r.CNPJ_FUNDO || r.cnpj_fundo || "",
        denomSocial: r.DENOM_SOCIAL || r.denom_social || "",
        tipo: r.TP_FUNDO || r.tp_fundo || "",
        situacao: r.SIT || r.sit || "",
        admin: r.ADMIN || r.admin || "",
        gestor: r.GESTOR || r.gestor || "",
        patrimLiq: r.VL_PATRIM_LIQ || r.vl_patrim_liq || null,
        dtIniAtiv: r.DT_INI_ATIV || r.dt_ini_ativ || "",
        dtSit: r.DT_SIT || r.dt_sit || "",
        classeFundo: r.CLASSE || r.classe || "",
      }));

      res.json({ fundos, total: data?.total || fundos.length });
    } catch (err: any) {
      console.error("CVM API error:", err.message);
      res.json({ fundos: [], error: err.message });
    }
  });
}
