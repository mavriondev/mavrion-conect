import type { Express } from "express";
import type { IStorage } from "../storage";
import { sendExport, type ExportColumn } from "../export";

export function registerExportRoutes(app: Express, storage: IStorage) {
  app.get("/api/export/deals", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const format = (req.query.format as string) || "xlsx";
      const pipelineType = req.query.pipelineType as string | undefined;

      const deals = await storage.getDeals(pipelineType);
      const stages = await storage.getPipelineStages();
      const stageMap = Object.fromEntries(stages.map((s: any) => [s.id, s.name]));

      const priorityLabels: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente" };

      const columns: ExportColumn[] = [
        { header: "Título", key: "title" },
        { header: "Empresa", key: "company", format: (v: any) => v?.legalName || "" },
        { header: "CNPJ", key: "company", format: (v: any) => v?.cnpj || "" },
        { header: "Pipeline", key: "pipelineType", format: (v: any) => v === "INVESTOR" ? "Investidor" : "Ativo" },
        { header: "Estágio", key: "stageId", format: (v: any) => stageMap[v] || String(v || "") },
        { header: "Valor Estimado (R$)", key: "amountEstimate", format: (v: any) => v ? Number(v).toFixed(2) : "" },
        { header: "Probabilidade (%)", key: "probability", format: (v: any) => v != null ? String(v) : "" },
        { header: "Prioridade", key: "priority", format: (v: any) => priorityLabels[v] || v || "" },
        { header: "Labels", key: "labels", format: (v: any) => Array.isArray(v) ? v.join(", ") : "" },
        { header: "Prazo", key: "dueDate", format: (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "" },
        { header: "Fonte", key: "source" },
        { header: "Criado em", key: "createdAt", format: (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "" },
      ];

      sendExport(res, deals as any[], columns, format, "deals");
    } catch (err: any) {
      console.error("Export deals error:", err);
      res.status(500).json({ message: "Erro ao exportar deals" });
    }
  });

  app.get("/api/export/companies", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const format = (req.query.format as string) || "xlsx";
      const companies = await storage.getCompanies();

      const columns: ExportColumn[] = [
        { header: "Razão Social", key: "legalName" },
        { header: "Nome Fantasia", key: "tradeName" },
        { header: "CNPJ", key: "cnpj" },
        { header: "CNAE Principal", key: "cnaePrincipal" },
        { header: "Porte", key: "porte" },
        { header: "UF", key: "address", format: (v: any) => v?.state || "" },
        { header: "Município", key: "address", format: (v: any) => v?.city || "" },
        { header: "Telefones", key: "phones", format: (v: any) => Array.isArray(v) ? v.join(", ") : "" },
        { header: "Emails", key: "emails", format: (v: any) => Array.isArray(v) ? v.join(", ") : "" },
        { header: "Website", key: "website" },
        { header: "Importado em", key: "createdAt", format: (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "" },
      ];

      sendExport(res, companies as any[], columns, format, "empresas");
    } catch (err: any) {
      console.error("Export companies error:", err);
      res.status(500).json({ message: "Erro ao exportar empresas" });
    }
  });

  app.get("/api/export/leads", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const format = (req.query.format as string) || "xlsx";
      const leads = await storage.getLeadsQueue();

      const statusLabels: Record<string, string> = {
        new: "Novo", queued: "Na fila", in_progress: "Em progresso",
        contacted: "Contactado", qualified: "Qualificado", disqualified: "Descartado",
      };

      const columns: ExportColumn[] = [
        { header: "Empresa", key: "company", format: (v: any) => v?.legalName || "" },
        { header: "CNPJ", key: "company", format: (v: any) => v?.cnpj || "" },
        { header: "Status", key: "status", format: (v: any) => statusLabels[v] || v || "" },
        { header: "Score", key: "score" },
        { header: "Fonte", key: "source" },
        { header: "UF", key: "company", format: (v: any) => (v?.address as any)?.state || "" },
        { header: "Município", key: "company", format: (v: any) => (v?.address as any)?.city || "" },
        { header: "Porte", key: "company", format: (v: any) => v?.porte || "" },
        { header: "CNAE", key: "company", format: (v: any) => v?.cnaePrincipal || "" },
        { header: "Telefones", key: "company", format: (v: any) => Array.isArray(v?.phones) ? v.phones.join(", ") : "" },
        { header: "Emails", key: "company", format: (v: any) => Array.isArray(v?.emails) ? v.emails.join(", ") : "" },
        { header: "Criado em", key: "createdAt", format: (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "" },
      ];

      sendExport(res, leads as any[], columns, format, "leads_sdr");
    } catch (err: any) {
      console.error("Export leads error:", err);
      res.status(500).json({ message: "Erro ao exportar leads" });
    }
  });

  app.get("/api/export/assets", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      const format = (req.query.format as string) || "xlsx";
      const assets = await storage.getAssets();

      const typeLabels: Record<string, string> = {
        TERRA: "Terras/Fazendas", MINA: "Mineração", NEGOCIO: "Negócio/M&A",
        FII_CRI: "FII/CRI", DESENVOLVIMENTO: "Desenvolvimento", AGRO: "Agronegócio",
      };

      const columns: ExportColumn[] = [
        { header: "Título", key: "title" },
        { header: "Tipo", key: "type", format: (v: any) => typeLabels[v] || v || "" },
        { header: "Município", key: "municipio" },
        { header: "Estado", key: "estado" },
        { header: "Área (ha)", key: "areaHa", format: (v: any) => v != null ? String(v) : "" },
        { header: "Preço Pedido (R$)", key: "priceAsking", format: (v: any) => v ? Number(v).toFixed(2) : "" },
        { header: "Matrícula", key: "matricula" },
        { header: "Status Docs", key: "docsStatus" },
        { header: "Tags", key: "tags", format: (v: any) => Array.isArray(v) ? v.join(", ") : "" },
        { header: "Processo ANM", key: "anmProcesso" },
        { header: "Criado em", key: "createdAt", format: (v: any) => v ? new Date(v).toLocaleDateString("pt-BR") : "" },
      ];

      sendExport(res, assets as any[], columns, format, "ativos");
    } catch (err: any) {
      console.error("Export assets error:", err);
      res.status(500).json({ message: "Erro ao exportar ativos" });
    }
  });
}
