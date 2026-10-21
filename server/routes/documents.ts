import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  getOrCreateAtivoFolder,
  getOrCreateEmpresaFolder,
  uploadArquivo,
  listarArquivos,
  deletarArquivo,
  baixarArquivo,
  resolverEntidadeArquivo,
  parseEntidadeDeCaminho,
  type EntidadeArquivo,
} from "../lib/google-drive";
import {
  extractDocumentTextAsync,
  listarTextosAtivo,
} from "../lib/document-extract";
import { storage } from "../storage";
import { db } from "../db";
import { assetDocumentTexts } from "@shared/schema";
import { and, eq } from "drizzle-orm";

// Multi-tenant: só permite operar em documentos de um ativo se o ativo existir
// e pertencer à organização do usuário autenticado.
async function getAssetAutorizado(req: any, assetId: number) {
  if (!Number.isFinite(assetId) || assetId <= 0) return null;
  const asset = await storage.getAsset(assetId);
  if (!asset) return null;
  const user = req.user as any;
  if (asset.orgId != null) {
    if (user?.orgId != null && asset.orgId !== user.orgId) return null;
    if (user?.orgId == null && user?.role !== "admin") return null;
  }
  return asset;
}

// Autoriza acesso a um arquivo com base na entidade dona resolvida pelo servidor
// (registro persistido ou estrutura de pastas do armazenamento), nunca por rótulos do cliente.
async function entidadeAutorizada(req: any, ent: EntidadeArquivo | null): Promise<boolean> {
  if (!ent || !Number.isFinite(ent.id) || ent.id <= 0) return false;
  const user = req.user as any;
  const orgOk = (orgId: number | null | undefined) => {
    if (orgId == null) return true;
    if (user?.orgId != null) return orgId === user.orgId;
    return user?.role === "admin";
  };
  if (ent.tipo === "ativo") return !!(await getAssetAutorizado(req, ent.id));
  if (ent.tipo === "empresa") {
    const c = await storage.getCompany(ent.id);
    return !!c && orgOk((c as any).orgId);
  }

  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg", "image/png", "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de arquivo não permitido. Use PDF, imagem, Word ou Excel."));
    }
  },
});

export function registerDocumentRoutes(app: Express) {

  app.get("/api/documents/ativo/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { id } = req.params;
      const { tipo, titulo } = req.query as { tipo: string; titulo: string };
      if (!tipo || !titulo) return res.status(400).json({ message: "tipo e titulo obrigatórios" });
      const asset = await getAssetAutorizado(req, Number(id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });
      const folderId = await getOrCreateAtivoFolder(Number(id), tipo, titulo);
      const arquivos = await listarArquivos(folderId);
      res.json({ folderId, arquivos });
    } catch (err: any) {
      console.error("Erro ao listar docs ativo:", err.message);
      res.status(500).json({ message: "Erro ao acessar documentos do ativo" });
    }
  });

  app.post(
    "/api/documents/ativo/:id",
    upload.fields([
      { name: "arquivo", maxCount: 1 },
      { name: "arquivos", maxCount: 20 },
    ]),
    async (req, res) => {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
      try {
        const { id } = req.params;
        const { tipo, titulo } = req.body;
        const fileGroups = (req.files || {}) as Record<string, Express.Multer.File[]>;
        const files = [...(fileGroups.arquivo || []), ...(fileGroups.arquivos || [])];
        if (files.length === 0) return res.status(400).json({ message: "Arquivo obrigatório" });
        if (!tipo || !titulo) return res.status(400).json({ message: "tipo e titulo obrigatórios" });

        const user = req.user as any;
        const assetId = Number(id);
        const asset = await getAssetAutorizado(req, assetId);
        if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });
        const folderId = await getOrCreateAtivoFolder(assetId, tipo, titulo);

        const resultados: Array<{
          originalName: string; success: boolean;
          id?: string; name?: string; webViewLink?: string; error?: string;
        }> = [];

        for (const file of files) {
          try {
            const resultado = await uploadArquivo({
              buffer: file.buffer,
              originalName: file.originalname,
              mimeType: file.mimetype,
              folderId,
            });
            resultados.push({ originalName: file.originalname, success: true, ...resultado });

            // Extração de texto pela IA em segundo plano (best-effort, nunca bloqueia o upload)
            extractDocumentTextAsync({
              orgId: user.orgId,
              assetId,
              fileId: resultado.id,
              fileName: resultado.name,
              mimeType: file.mimetype,
              buffer: file.buffer,
            });
          } catch (e: any) {
            resultados.push({ originalName: file.originalname, success: false, error: e.message || "Erro no upload" });
          }
        }

        const anySuccess = resultados.some(r => r.success);
        res.status(anySuccess ? 201 : 500).json({ resultados, ...(resultados[0]?.success ? resultados[0] : {}) });
      } catch (err: any) {
        console.error("Erro ao fazer upload ativo:", err.message);
        res.status(500).json({ message: err.message || "Erro ao fazer upload" });
      }
    }
  );

  app.get("/api/documents/ativo/:id/textos", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const user = req.user as any;
      const asset = await getAssetAutorizado(req, Number(req.params.id));
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });
      const textos = await listarTextosAtivo(Number(req.params.id), user.orgId);
      res.json({ textos });
    } catch (err: any) {
      console.error("Erro ao listar textos ativo:", err.message);
      res.status(500).json({ message: "Erro ao listar leituras de documentos" });
    }
  });

  app.post("/api/documents/ativo/:id/extrair/:fileId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const user = req.user as any;
      const assetId = Number(req.params.id);
      const { fileId } = req.params;
      if (!fileId || fileId.length < 5) return res.status(400).json({ message: "ID inválido" });

      const asset = await getAssetAutorizado(req, assetId);
      if (!asset) return res.status(404).json({ message: "Ativo não encontrado" });

      // O arquivo precisa pertencer a este ativo: ou já tem registro de extração
      // vinculado a ele, ou está na pasta de documentos do ativo (tipo/titulo no body).
      const [registro] = await db.select({ id: assetDocumentTexts.id })
        .from(assetDocumentTexts)
        .where(and(eq(assetDocumentTexts.fileId, fileId), eq(assetDocumentTexts.assetId, assetId)))
        .limit(1);
      if (!registro) {
        const { tipo, titulo } = (req.body || {}) as { tipo?: string; titulo?: string };
        if (!tipo || !titulo) return res.status(403).json({ message: "Arquivo não pertence a este ativo" });
        const folderId = await getOrCreateAtivoFolder(assetId, tipo, titulo);
        const arquivosDaPasta = await listarArquivos(folderId);
        if (!arquivosDaPasta.some((a: any) => a.id === fileId)) {
          return res.status(403).json({ message: "Arquivo não pertence a este ativo" });
        }
      }

      const arquivo = await baixarArquivo(fileId);
      if (!arquivo) return res.status(404).json({ message: "Arquivo não encontrado no armazenamento" });

      extractDocumentTextAsync({
        orgId: user.orgId,
        assetId,
        fileId,
        fileName: arquivo.name,
        mimeType: arquivo.mimeType,
        buffer: arquivo.buffer,
      });

      res.status(202).json({ status: "processando", fileName: arquivo.name });
    } catch (err: any) {
      console.error("Erro ao reprocessar arquivo:", err.message);
      res.status(500).json({ message: err.message || "Erro ao reprocessar arquivo" });
    }
  });

  app.get("/api/documents/empresa/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { id } = req.params;
      const { nome } = req.query as { nome: string };
      if (!nome) return res.status(400).json({ message: "nome obrigatório" });
      if (!(await entidadeAutorizada(req, { tipo: "empresa", id: Number(id) }))) {
        return res.status(404).json({ message: "Empresa não encontrada" });
      }
      const folderId = await getOrCreateEmpresaFolder(Number(id), nome);
      const arquivos = await listarArquivos(folderId);
      res.json({ folderId, arquivos });
    } catch (err: any) {
      console.error("Erro ao listar docs empresa:", err.message);
      res.status(500).json({ message: "Erro ao acessar documentos da empresa" });
    }
  });

  app.post("/api/documents/empresa/:id", upload.single("arquivo"), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { id } = req.params;
      const { nome } = req.body;
      if (!req.file) return res.status(400).json({ message: "Arquivo obrigatório" });
      if (!nome) return res.status(400).json({ message: "nome obrigatório" });
      if (!(await entidadeAutorizada(req, { tipo: "empresa", id: Number(id) }))) {
        return res.status(404).json({ message: "Empresa não encontrada" });
      }

      const folderId = await getOrCreateEmpresaFolder(Number(id), nome);
      const resultado = await uploadArquivo({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId,
      });

      res.status(201).json(resultado);
    } catch (err: any) {
      console.error("Erro ao fazer upload empresa:", err.message);
      res.status(500).json({ message: err.message || "Erro ao fazer upload" });
    }
  });

  app.delete("/api/documents/:fileId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { fileId } = req.params;
      if (!fileId || fileId.length < 5) return res.status(400).json({ message: "ID inválido" });
      // Posse: registro de extração persistido (arquivos de ativo) ou, na falta dele,
      // a entidade dona resolvida pela estrutura de pastas do armazenamento.
      const [registro] = await db.select({ assetId: assetDocumentTexts.assetId })
        .from(assetDocumentTexts)
        .where(eq(assetDocumentTexts.fileId, fileId))
        .limit(1);
      if (registro?.assetId != null) {
        const asset = await getAssetAutorizado(req, registro.assetId);
        if (!asset) return res.status(403).json({ message: "Sem permissão para excluir este arquivo" });
      } else {
        const ent = await resolverEntidadeArquivo(fileId);
        if (!(await entidadeAutorizada(req, ent))) {
          return res.status(403).json({ message: "Sem permissão para excluir este arquivo" });
        }
      }
      await deletarArquivo(fileId);
      try {
        await db.delete(assetDocumentTexts).where(eq(assetDocumentTexts.fileId, fileId));
      } catch { }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Erro ao deletar arquivo:", err.message);
      res.status(500).json({ message: "Erro ao deletar arquivo" });
    }
  });

  app.get("/api/documents/file/:filePath", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const relativePath = decodeURIComponent(req.params.filePath || "");
      if (!relativePath || relativePath.includes("..")) {
        return res.status(400).json({ message: "Caminho inválido" });
      }
      const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
      const filePath = path.join(uploadsDir, relativePath);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(uploadsDir))) {
        return res.status(403).json({ message: "Acesso negado" });
      }
      // Multi-tenant: o dono é resolvido pela estrutura de pastas gerada pelo servidor
      const ent = parseEntidadeDeCaminho(relativePath);
      if (!(await entidadeAutorizada(req, ent))) {
        return res.status(403).json({ message: "Acesso negado" });
      }
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ message: "Arquivo não encontrado" });
      }
      const ext = path.extname(resolved).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".txt": "text/plain",
      };
      const contentType = mimeMap[ext] || "application/octet-stream";
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${path.basename(resolved)}"`);
      } else {
        res.setHeader("Content-Disposition", "inline");
      }
      res.setHeader("Content-Type", contentType);
      const stat = fs.statSync(resolved);
      res.setHeader("Content-Length", stat.size);
      fs.createReadStream(resolved).pipe(res);
    } catch (err: any) {
      console.error("Erro ao servir arquivo:", err.message);
      res.status(500).json({ message: "Erro ao acessar arquivo" });
    }
  });
}
