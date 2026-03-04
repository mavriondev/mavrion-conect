import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

let cachedRootFolderId: string | null = null;

async function parseBody(res: any): Promise<any> {
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
  if (typeof raw !== "string") {
    raw = String(raw);
  }
  return JSON.parse(raw);
}

function gerarPrefixo(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function findOrCreateRootFolder(folderName: string): Promise<string> {
  const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
  const searchRes = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    method: "GET",
  });
  const searchData = await parseBody(searchRes);
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const createRes = await connectors.proxy("google-drive", "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const createData = await parseBody(createRes);
  console.log(`[Google Drive] Pasta raiz "${folderName}" criada: ${createData.id}`);
  return createData.id;
}

async function getRootFolderId(): Promise<string> {
  if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
    return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  }
  if (cachedRootFolderId) return cachedRootFolderId;
  cachedRootFolderId = await findOrCreateRootFolder("Mavrion Conect");
  return cachedRootFolderId;
}

async function getOrCreateFolder(nome: string, parentId: string): Promise<string> {
  const nomeSanitizado = nome.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 100);

  const q = `name='${nomeSanitizado}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    method: "GET",
  });
  const searchData = await parseBody(searchRes);
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const createRes = await connectors.proxy("google-drive", "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: nomeSanitizado,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const createData = await parseBody(createRes);
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

export async function getOrCreateDealFolder(dealId: number, titulo: string): Promise<string> {
  const rootId = await getRootFolderId();
  const deals = await getOrCreateFolder("Deals", rootId);
  const nomePasta = `Deal-${dealId} — ${titulo.slice(0, 60)}`;
  return getOrCreateFolder(nomePasta, deals);
}

export async function uploadArquivo(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folderId: string;
}): Promise<{ id: string; name: string; webViewLink: string; webContentLink: string }> {
  const prefixo = gerarPrefixo();
  const nomeArquivo = `${prefixo}_${params.originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const boundary = "----MavrionBoundary" + Date.now();
  const metadata = { name: nomeArquivo, parents: [params.folderId] };
  const metadataStr = JSON.stringify(metadata);

  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n`,
    `--${boundary}\r\nContent-Type: ${params.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${params.buffer.toString("base64")}\r\n`,
    `--${boundary}--`,
  ];
  const body = bodyParts.join("");

  const uploadRes = await connectors.proxy(
    "google-drive",
    "/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );

  const data = await parseBody(uploadRes);

  try {
    await connectors.proxy("google-drive", `/drive/v3/files/${data.id}/permissions`, {
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
  id: string;
  name: string;
  mimeType: string;
  size: string;
  webViewLink: string;
  createdTime: string;
}>> {
  const q = `'${folderId}' in parents and trashed=false`;
  const response = await connectors.proxy(
    "google-drive",
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,webViewLink,createdTime)&orderBy=createdTime desc`,
    { method: "GET" }
  );
  const data = await parseBody(response);
  return (data.files || []) as any[];
}

export async function deletarArquivo(fileId: string): Promise<void> {
  await connectors.proxy("google-drive", `/drive/v3/files/${fileId}`, {
    method: "DELETE",
  });
}
