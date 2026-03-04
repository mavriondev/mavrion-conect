import type { Express } from "express";
import multer from "multer";
import {
  getOrCreateAtivoFolder,
  getOrCreateEmpresaFolder,
  getOrCreateDealFolder,
  uploadArquivo,
  listarArquivos,
  deletarArquivo,
} from "../lib/google-drive";

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
      const folderId = await getOrCreateAtivoFolder(Number(id), tipo, titulo);
      const arquivos = await listarArquivos(folderId);
      res.json({ folderId, arquivos });
    } catch (err: any) {
      console.error("Erro ao listar docs ativo:", err.message);
      res.status(500).json({ message: "Erro ao acessar documentos do ativo" });
    }
  });

  app.post("/api/documents/ativo/:id", upload.single("arquivo"), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { id } = req.params;
      const { tipo, titulo } = req.body;
      if (!req.file) return res.status(400).json({ message: "Arquivo obrigatório" });
      if (!tipo || !titulo) return res.status(400).json({ message: "tipo e titulo obrigatórios" });

      const folderId = await getOrCreateAtivoFolder(Number(id), tipo, titulo);
      const resultado = await uploadArquivo({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId,
      });

      res.status(201).json(resultado);
    } catch (err: any) {
      console.error("Erro ao fazer upload ativo:", err.message);
      res.status(500).json({ message: err.message || "Erro ao fazer upload" });
    }
  });

  app.get("/api/documents/empresa/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { id } = req.params;
      const { nome } = req.query as { nome: string };
      if (!nome) return res.status(400).json({ message: "nome obrigatório" });
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

  app.get("/api/documents/deal/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { id } = req.params;
      const { titulo } = req.query as { titulo: string };
      if (!titulo) return res.status(400).json({ message: "titulo obrigatório" });
      const folderId = await getOrCreateDealFolder(Number(id), titulo);
      const arquivos = await listarArquivos(folderId);
      res.json({ folderId, arquivos });
    } catch (err: any) {
      console.error("Erro ao listar docs deal:", err.message);
      res.status(500).json({ message: "Erro ao acessar documentos do deal" });
    }
  });

  app.post("/api/documents/deal/:id", upload.single("arquivo"), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { id } = req.params;
      const { titulo } = req.body;
      if (!req.file) return res.status(400).json({ message: "Arquivo obrigatório" });
      if (!titulo) return res.status(400).json({ message: "titulo obrigatório" });

      const folderId = await getOrCreateDealFolder(Number(id), titulo);
      const resultado = await uploadArquivo({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId,
      });

      res.status(201).json(resultado);
    } catch (err: any) {
      console.error("Erro ao fazer upload deal:", err.message);
      res.status(500).json({ message: err.message || "Erro ao fazer upload" });
    }
  });

  app.delete("/api/documents/:fileId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      await deletarArquivo(req.params.fileId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Erro ao deletar arquivo:", err.message);
      res.status(500).json({ message: "Erro ao deletar arquivo" });
    }
  });
}
