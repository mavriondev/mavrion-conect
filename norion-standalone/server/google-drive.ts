import { google } from "googleapis";

let driveClient: ReturnType<typeof google.drive> | null = null;

function getDriveClient() {
  if (driveClient) return driveClient;

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY não configurada.");
  }

  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

async function findOrCreateFolder(folderName: string, parentId?: string): Promise<string> {
  const drive = getDriveClient();
  let q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const res = await drive.files.list({ q, fields: "files(id,name)" });
  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id!;
  }

  const metadata: any = { name: folderName, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) metadata.parents = [parentId];

  const createRes = await drive.files.create({ requestBody: metadata, fields: "id" });
  return createRes.data.id!;
}

export async function uploadToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  folderPath: string[]
): Promise<{ fileId: string; fileUrl: string }> {
  const drive = getDriveClient();
  let parentId: string | undefined;
  for (const folder of folderPath) {
    parentId = await findOrCreateFolder(folder, parentId);
  }

  const { Readable } = await import("stream");
  const requestBody: any = { name: fileName };
  if (parentId) requestBody.parents = [parentId];

  const uploadRes = await drive.files.create({
    requestBody,
    media: { mimeType, body: Readable.from(fileBuffer) },
    fields: "id,webViewLink",
  });

  return {
    fileId: uploadRes.data.id!,
    fileUrl: uploadRes.data.webViewLink || `https://drive.google.com/file/d/${uploadRes.data.id}/view`,
  };
}

export async function testDriveConnection(): Promise<boolean> {
  try {
    const drive = getDriveClient();
    const res = await drive.about.get({ fields: "user" });
    return !!res.data.user;
  } catch {
    return false;
  }
}
