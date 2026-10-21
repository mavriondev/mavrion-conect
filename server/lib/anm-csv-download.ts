// Download de CSVs grandes de dadosabertos.anm.gov.br para disco.
// O WAF da ANM derruba streams fetch longos SILENCIOSAMENTE no meio (o
// processo Node termina sem erro) — ver .agents/memory/anm-dados-abertos.md.
// Um download completo com curl -C - --retry para disco é rápido e confiável;
// os importadores devem sempre ler do arquivo local, nunca do stream fetch.
import { spawn } from "child_process";
import { mkdtempSync, statSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Headers de navegador exigidos pelo WAF da ANM (403 para UA padrão de bots)
export const ANM_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
} as const;

export interface AnmCsvDownload {
  filePath: string;
  sizeBytes: number;
  cleanup: () => void;
}

export async function downloadAnmCsvToDisk(url: string, label: string): Promise<AnmCsvDownload> {
  const dir = mkdtempSync(join(tmpdir(), `anm-${label}-`));
  const filePath = join(dir, `${label}.csv`);
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  };

  const args = [
    "-fsSL",
    "-C", "-",
    "--retry", "5",
    "--retry-delay", "5",
    "--retry-all-errors",
    "--max-time", "1800",
    "-o", filePath,
  ];
  for (const [k, v] of Object.entries(ANM_BROWSER_HEADERS)) {
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);

  console.log(`[ANM download] Baixando ${url} para ${filePath}...`);
  const startedAt = Date.now();

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("curl", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += String(d); });
    proc.on("error", (err) => reject(new Error(`curl não pôde ser executado: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl saiu com código ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  }).catch((err) => {
    cleanup();
    throw err;
  });

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(filePath).size;
  } catch {
    cleanup();
    throw new Error(`[ANM download] Arquivo não foi criado: ${filePath}`);
  }
  if (sizeBytes < 1024) {
    cleanup();
    throw new Error(`[ANM download] Arquivo suspeito de ${sizeBytes} bytes — provável bloqueio do WAF`);
  }

  console.log(`[ANM download] ${label}: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return { filePath, sizeBytes, cleanup };
}
