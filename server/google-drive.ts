import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

async function findOrCreateFolder(folderName: string, parentId?: string): Promise<string> {
  let q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const searchRes = await connectors.proxy("google-drive", `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    method: "GET",
  });
  const searchData = JSON.parse(searchRes.body);
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const metadata: any = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) metadata.parents = [parentId];

  const createRes = await connectors.proxy("google-drive", "/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const createData = JSON.parse(createRes.body);
  return createData.id;
}

export async function uploadToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  folderPath: string[]
): Promise<{ fileId: string; fileUrl: string }> {
  let parentId: string | undefined;
  for (const folder of folderPath) {
    parentId = await findOrCreateFolder(folder, parentId);
  }

  const boundary = "----MavrionBoundary" + Date.now();
  const metadata: any = { name: fileName };
  if (parentId) metadata.parents = [parentId];

  const metadataStr = JSON.stringify(metadata);
  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${fileBuffer.toString("base64")}\r\n`,
    `--${boundary}--`,
  ];
  const body = bodyParts.join("");

  const uploadRes = await connectors.proxy(
    "google-drive",
    "/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );

  const data = JSON.parse(uploadRes.body);
  return {
    fileId: data.id,
    fileUrl: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
  };
}

export async function testDriveConnection(): Promise<boolean> {
  try {
    const res = await connectors.proxy("google-drive", "/drive/v3/about?fields=user", {
      method: "GET",
    });
    const data = JSON.parse(res.body);
    return !!data.user;
  } catch {
    return false;
  }
}
