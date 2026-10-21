import { google } from "googleapis";
import path from "path";
import fs from "fs";
import crypto from "crypto";

let driveClient: ReturnType<typeof google.drive> | null = null;
let replitConnectors: any = null;
let cachedRootFolderId: string | null = null;
let mode: "googleapis" | "replit" | "local" | null = null;

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");

async function initMode() {
  if (mode) return;

  if (process.env.STORAGE_MODE === "local") {
    mode = "local";
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log("[Documentos] Modo: Armazenamento local em", UPLOADS_DIR);
    return;
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
      driveClient = google.drive({ version: "v3", auth });
      mode = "googleapis";
      console.log("[Documentos] Modo: Google Drive (Service Account)");
      return;
    } catch (e: any) {
      console.warn("[Documentos] Google Drive indisponível:", e.message?.slice(0, 120));
      driveClient = null;
    }
  }

  try {
    const sdk = await import("@replit/connectors-sdk");
    replitConnectors = new sdk.ReplitConnectors();
    mode = "replit";
    console.log("[Documentos] Modo: Replit Connector (dev)");
    return;
  } catch { }

  mode = "local";
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log("[Documentos] Modo: Armazenamento local em", UPLOADS_DIR);
}

async function parseReplitBody(res: any): Promise<any> {
  let raw = res.body;
  if (raw && typeof raw === "object" && typeof raw.getReader === "function") {
    const reader = raw.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    raw = new TextDecoder().decode(Buffer.concat(chunks));
  } else if (raw && typeof raw === "object" && typeof raw.text === "function") {
    raw = await raw.text();
  }
  if (typeof raw !== "string") raw = String(raw);

  if (raw.trimStart().startsWith("<") || raw.trimStart().startsWith("<!")) {
    console.error("[Google Drive] Resposta HTML inesperada do connector:", raw.slice(0, 300));
    throw new Error("Google Drive retornou erro. O conector pode estar desconectado — reconecte a integração Google Drive nas configurações do Replit.");
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("[Google Drive] Resposta não-JSON do connector:", raw.slice(0, 300));
    throw new Error("Google Drive retornou resposta inválida. Verifique se a integração Google Drive está conectada.");
  }
}

function gerarPrefixo(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sanitizePath(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\.\./g, "").slice(0, 100);
}

function ensureLocalDir(dirPath: string): string {
  const full = path.join(UPLOADS_DIR, dirPath);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

async function findOrCreateRootFolder(folderName: string): Promise<string> {
  await initMode();

  if (mode === "local") {
    const dir = ensureLocalDir(sanitizePath(folderName));
    return `local:${sanitizePath(folderName)}`;
  }

  if (mode === "googleapis") {
    const drive = driveClient!;
    const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
    const res = await drive.files.list({ q, fields: "files(id,name)" });
    if (res.data.files && res.data.files.length > 0) return res.data.files[0].id!;
    const createRes = await drive.files.create({
      requestBody: { name: folderName, mimeType: "application/vnd.google-apps.folder" },
      fields: "id",
    });
    console.log(`[Google Drive] Pasta raiz "${folderName}" criada: ${createRes.data.id}`);
    return createRes.data.id!;
  }

  const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
  const searchRes = await replitConnectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { method: "GET" });
  const searchData = await parseReplitBody(searchRes);
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;
  const createRes = await replitConnectors.proxy("google-drive", "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
  });
  const createData = await parseReplitBody(createRes);
  console.log(`[Google Drive] Pasta raiz "${folderName}" criada: ${createData.id}`);
  return createData.id;
}

async function getRootFolderId(): Promise<string> {
  await initMode();
  if (mode === "local") return "local:";
  if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (cachedRootFolderId) return cachedRootFolderId;
  cachedRootFolderId = await findOrCreateRootFolder("Mavrion Connect");
  return cachedRootFolderId;
}

async function getOrCreateFolder(nome: string, parentId: string): Promise<string> {
  await initMode();
  const nomeSanitizado = sanitizePath(nome);

  if (mode === "local") {
    const parentPath = parentId.startsWith("local:") ? parentId.slice(6) : parentId;
    const folderPath = path.join(parentPath, nomeSanitizado);
    ensureLocalDir(folderPath);
    return `local:${folderPath}`;
  }

  if (mode === "googleapis") {
    const drive = driveClient!;
    const q = `name='${nomeSanitizado}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await drive.files.list({ q, fields: "files(id,name)" });
    if (res.data.files && res.data.files.length > 0) return res.data.files[0].id!;
    const createRes = await drive.files.create({
      requestBody: { name: nomeSanitizado, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
      fields: "id",
    });
    return createRes.data.id!;
  }

  const q = `name='${nomeSanitizado}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await replitConnectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, { method: "GET" });
  const searchData = await parseReplitBody(searchRes);
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;
  const createRes = await replitConnectors.proxy("google-drive", "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nomeSanitizado, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const createData = await parseReplitBody(createRes);
  return createData.id;
}

export async function getOrCreateAtivoFolder(ativoId: number, tipo: string, titulo: string): Promise<string> {
  const rootId = await getRootFolderId();
  const ativos = await getOrCreateFolder("Ativos", rootId);
  const nomePasta = `${tipo} — ${titulo.slice(0, 60)} — ID${ativoId}`;
  return getOrCreateFolder(nomePasta, ativos);
}

export async function getOrCreateEmpresaFolder(empresaId: number, nome: string): Promise<string> {
  const rootId = await getRootFolderId();
  const empresas = await getOrCreateFolder("Empresas", rootId);
  const nomePasta = `${nome.slice(0, 80)} — ID${empresaId}`;
  return getOrCreateFolder(nomePasta, empresas);
}

export async function uploadArquivo(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folderId: string;
}): Promise<{ id: string; name: string; webViewLink: string; webContentLink: string }> {
  await initMode();
  const prefixo = gerarPrefixo();
  const nomeArquivo = `${prefixo}_${params.originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  if (mode === "local") {
    const folderPath = params.folderId.startsWith("local:") ? params.folderId.slice(6) : params.folderId;
    const fullDir = path.join(UPLOADS_DIR, folderPath);
    fs.mkdirSync(fullDir, { recursive: true });
    const fileId = crypto.randomUUID();
    const ext = path.extname(nomeArquivo) || "";
    const storedName = `${fileId}${ext}`;
    const filePath = path.join(fullDir, storedName);
    fs.writeFileSync(filePath, params.buffer);
    const metaPath = path.join(fullDir, `${fileId}.meta.json`);
    const meta = {
      id: fileId,
      name: nomeArquivo,
      originalName: params.originalName,
      mimeType: params.mimeType,
      size: String(params.buffer.length),
      storedName,
      createdTime: new Date().toISOString(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const relativePath = path.join(folderPath, storedName);
    return {
      id: fileId,
      name: nomeArquivo,
      webViewLink: `/api/documents/file/${encodeURIComponent(relativePath)}`,
      webContentLink: `/api/documents/file/${encodeURIComponent(relativePath)}?download=1`,
    };
  }

  if (mode === "googleapis") {
    const drive = driveClient!;
    const { Readable } = await import("stream");
    const uploadRes = await drive.files.create({
      requestBody: { name: nomeArquivo, parents: [params.folderId] },
      media: { mimeType: params.mimeType, body: Readable.from(params.buffer) },
      fields: "id,name,webViewLink,webContentLink",
    });
    try {
      await drive.permissions.create({
        fileId: uploadRes.data.id!,
        requestBody: { role: "reader", type: "anyone" },
      });
    } catch { }
    return {
      id: uploadRes.data.id!,
      name: uploadRes.data.name || nomeArquivo,
      webViewLink: uploadRes.data.webViewLink || `https://drive.google.com/file/d/${uploadRes.data.id}/view`,
      webContentLink: uploadRes.data.webContentLink || `https://drive.google.com/uc?id=${uploadRes.data.id}&export=download`,
    };
  }

  const boundary = "----MavrionBoundary" + Date.now();
  const metadata = { name: nomeArquivo, parents: [params.folderId] };
  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${params.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${params.buffer.toString("base64")}\r\n`,
    `--${boundary}--`,
  ];
  const uploadRes = await replitConnectors.proxy(
    "google-drive",
    "/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink",
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: bodyParts.join("") }
  );
  const data = await parseReplitBody(uploadRes);
  try {
    await replitConnectors.proxy("google-drive", `/drive/v3/files/${data.id}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch { }
  return {
    id: data.id,
    name: data.name || nomeArquivo,
    webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
    webContentLink: data.webContentLink || `https://drive.google.com/uc?id=${data.id}&export=download`,
  };
}

export async function listarArquivos(folderId: string): Promise<Array<{
  id: string; name: string; mimeType: string; size: string; webViewLink: string; createdTime: string;
}>> {
  await initMode();

  if (mode === "local") {
    const folderPath = folderId.startsWith("local:") ? folderId.slice(6) : folderId;
    const fullDir = path.join(UPLOADS_DIR, folderPath);
    if (!fs.existsSync(fullDir)) return [];
    const metaFiles = fs.readdirSync(fullDir).filter(f => f.endsWith(".meta.json"));
    const results = metaFiles.map(mf => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(fullDir, mf), "utf-8"));
        const relativePath = path.join(folderPath, meta.storedName);
        return {
          id: meta.id,
          name: meta.name,
          mimeType: meta.mimeType,
          size: meta.size,
          webViewLink: `/api/documents/file/${encodeURIComponent(relativePath)}`,
          createdTime: meta.createdTime,
        };
      } catch { return null; }
    }).filter(Boolean) as any[];
    results.sort((a: any, b: any) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
    return results;
  }

  const q = `'${folderId}' in parents and trashed=false`;
  if (mode === "googleapis") {
    const drive = driveClient!;
    const res = await drive.files.list({ q, fields: "files(id,name,mimeType,size,webViewLink,createdTime)", orderBy: "createdTime desc" });
    return (res.data.files || []) as any[];
  }

  const response = await replitConnectors.proxy(
    "google-drive",
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,webViewLink,createdTime)&orderBy=createdTime desc`,
    { method: "GET" }
  );
  const data = await parseReplitBody(response);
  return (data.files || []) as any[];
}

// ---------------------------------------------------------------------------
// Resolução de posse: a estrutura de pastas é gerada pelo próprio servidor
// (Ativos/<...> — ID{n}, Empresas/<...> — ID{n}), então
// o vínculo arquivo→entidade pode ser resolvido a partir dela — nunca a partir
// de rótulos fornecidos pelo cliente.

export type EntidadeArquivo = { tipo: "ativo" | "empresa"; id: number };

function interpretarNomePasta(nome: string | null | undefined, categoria: string): EntidadeArquivo | null {
  if (!nome) return null;
  const m = nome.match(/ID(\d+)\s*$/);
  if (!m) return null;
  if (categoria === "Ativos") return { tipo: "ativo", id: Number(m[1]) };
  if (categoria === "Empresas") return { tipo: "empresa", id: Number(m[1]) };
  return null; // categoria desconhecida: ambíguo — nega por segurança
}

// Para o modo local: resolve a entidade dona a partir do caminho relativo dentro de uploads/
export function parseEntidadeDeCaminho(relativePath: string): EntidadeArquivo | null {
  const segs = relativePath.split(/[/\\]/).filter(Boolean);
  if (segs.length < 3) return null; // esperado: <Categoria>/<Pasta da entidade>/<arquivo>
  return interpretarNomePasta(segs[1], segs[0]);
}

// Resolve a entidade dona de um arquivo pelo fileId, em qualquer modo de armazenamento.
export async function resolverEntidadeArquivo(fileId: string): Promise<EntidadeArquivo | null> {
  await initMode();

  if (mode === "local") {
    const find = (dir: string, rel: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const relPath = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          const found = find(fullPath, relPath);
          if (found) return found;
        } else if (entry.name === `${fileId}.meta.json`) {
          return relPath;
        }
      }
      return null;
    };
    const relMeta = find(UPLOADS_DIR, "");
    return relMeta ? parseEntidadeDeCaminho(relMeta) : null;
  }

  try {
    if (mode === "googleapis") {
      const drive = driveClient!;
      const meta = await drive.files.get({ fileId, fields: "parents" });
      const parentId = meta.data.parents?.[0];
      if (!parentId) return null;
      const parent = await drive.files.get({ fileId: parentId, fields: "name,parents" });
      let categoria = "";
      const avoId = parent.data.parents?.[0];
      if (avoId) {
        try { categoria = (await drive.files.get({ fileId: avoId, fields: "name" })).data.name || ""; } catch { }
      }
      return interpretarNomePasta(parent.data.name, categoria);
    }

    const metaRes = await replitConnectors.proxy("google-drive", `/drive/v3/files/${fileId}?fields=parents`, { method: "GET" });
    const meta = await parseReplitBody(metaRes);
    const parentId = meta.parents?.[0];
    if (!parentId) return null;
    const pRes = await replitConnectors.proxy("google-drive", `/drive/v3/files/${parentId}?fields=name,parents`, { method: "GET" });
    const p = await parseReplitBody(pRes);
    let categoria = "";
    const avoId = p.parents?.[0];
    if (avoId) {
      try {
        const aRes = await replitConnectors.proxy("google-drive", `/drive/v3/files/${avoId}?fields=name`, { method: "GET" });
        categoria = (await parseReplitBody(aRes)).name || "";
      } catch { }
    }
    return interpretarNomePasta(p.name, categoria);
  } catch {
    return null;
  }
}

export async function deletarArquivo(fileId: string): Promise<void> {
  await initMode();

  if (mode === "local") {
    const findAndDelete = (dir: string): boolean => {
      if (!fs.existsSync(dir)) return false;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (findAndDelete(fullPath)) return true;
        } else if (entry.name === `${fileId}.meta.json`) {
          const meta = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
          const filePath = path.join(dir, meta.storedName);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          fs.unlinkSync(fullPath);
          return true;
        }
      }
      return false;
    };
    findAndDelete(UPLOADS_DIR);
    return;
  }

  if (mode === "googleapis") {
    const drive = driveClient!;
    await drive.files.delete({ fileId });
    return;
  }

  await replitConnectors.proxy("google-drive", `/drive/v3/files/${fileId}`, { method: "DELETE" });
}

export async function baixarArquivo(fileId: string): Promise<{ buffer: Buffer; name: string; mimeType: string } | null> {
  await initMode();

  if (mode === "local") {
    const findFile = (dir: string): { buffer: Buffer; name: string; mimeType: string } | null => {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findFile(fullPath);
          if (found) return found;
        } else if (entry.name === `${fileId}.meta.json`) {
          try {
            const meta = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
            const filePath = path.join(dir, meta.storedName);
            if (!fs.existsSync(filePath)) return null;
            return {
              buffer: fs.readFileSync(filePath),
              name: meta.name,
              mimeType: meta.mimeType || "application/octet-stream",
            };
          } catch {
            return null;
          }
        }
      }
      return null;
    };
    return findFile(UPLOADS_DIR);
  }

  if (mode === "googleapis") {
    const drive = driveClient!;
    const metaRes = await drive.files.get({ fileId, fields: "id,name,mimeType" });
    const contentRes = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    return {
      buffer: Buffer.from(contentRes.data as ArrayBuffer),
      name: metaRes.data.name || fileId,
      mimeType: metaRes.data.mimeType || "application/octet-stream",
    };
  }

  const metaRes = await replitConnectors.proxy("google-drive", `/drive/v3/files/${fileId}?fields=id,name,mimeType`, { method: "GET" });
  const meta = await parseReplitBody(metaRes);
  const contentRes = await replitConnectors.proxy("google-drive", `/drive/v3/files/${fileId}?alt=media`, { method: "GET" });
  let raw = contentRes.body;
  let buffer: Buffer;
  if (raw && typeof raw === "object" && typeof raw.getReader === "function") {
    const reader = raw.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    buffer = Buffer.concat(chunks);
  } else if (raw && typeof raw === "object" && typeof raw.arrayBuffer === "function") {
    buffer = Buffer.from(await raw.arrayBuffer());
  } else if (Buffer.isBuffer(raw)) {
    buffer = raw;
  } else {
    buffer = Buffer.from(String(raw), "binary");
  }
  return {
    buffer,
    name: meta.name || fileId,
    mimeType: meta.mimeType || "application/octet-stream",
  };
}

export async function testDriveConnection(): Promise<boolean> {
  try {
    await initMode();
    if (mode === "local") return true;
    if (mode === "googleapis") {
      const drive = driveClient!;
      const res = await drive.about.get({ fields: "user" });
      return !!res.data.user;
    }
    const res = await replitConnectors.proxy("google-drive", "/drive/v3/about?fields=user", { method: "GET" });
    const data = await parseReplitBody(res);
    return !!data.user;
  } catch {
    return false;
  }
}

export async function uploadToDrive(
  fileBuffer: Buffer, fileName: string, mimeType: string, folderPath: string[]
): Promise<{ fileId: string; fileUrl: string }> {
  await initMode();
  let parentId: string | undefined;
  for (const folder of folderPath) {
    if (!parentId) {
      parentId = await findOrCreateRootFolder(folder);
    } else {
      parentId = await getOrCreateFolder(folder, parentId);
    }
  }

  if (mode === "local") {
    const result = await uploadArquivo({
      buffer: fileBuffer,
      originalName: fileName,
      mimeType,
      folderId: parentId || "local:",
    });
    return { fileId: result.id, fileUrl: result.webViewLink };
  }

  if (mode === "googleapis") {
    const drive = driveClient!;
    const { Readable } = await import("stream");
    const requestBody: any = { name: fileName };
    if (parentId) requestBody.parents = [parentId];
    const uploadRes = await drive.files.create({
      requestBody, media: { mimeType, body: Readable.from(fileBuffer) }, fields: "id,webViewLink",
    });
    return {
      fileId: uploadRes.data.id!,
      fileUrl: uploadRes.data.webViewLink || `https://drive.google.com/file/d/${uploadRes.data.id}/view`,
    };
  }

  const boundary = "----MavrionBoundary" + Date.now();
  const metadata: any = { name: fileName };
  if (parentId) metadata.parents = [parentId];
  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${fileBuffer.toString("base64")}\r\n`,
    `--${boundary}--`,
  ];
  const uploadRes = await replitConnectors.proxy(
    "google-drive", "/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: bodyParts.join("") }
  );
  const data = await parseReplitBody(uploadRes);
  return {
    fileId: data.id,
    fileUrl: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
  };
}

export function getStorageMode(): string {
  return mode || "not_initialized";
}
