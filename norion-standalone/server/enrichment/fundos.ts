export interface FundoInfo {
  cnpj: string;
  nome: string;
  tipo: string;
  categoria?: string;
  patrimonio?: number;
  situacao?: string;
  administrador?: string;
  gestor?: string;
  dataConstituicao?: string;
  dataEncerramento?: string | null;
  codigoFundo?: string;
  source: "cvm" | "anbima";
}

export async function consultarFundoCVM(cnpj: string): Promise<FundoInfo | null> {
  try {
    const cnpjClean = cnpj.replace(/\D/g, "");
    const response = await fetch(
      `https://dados.cvm.gov.br/api/fundo/v1/${cnpjClean}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || !data.length) return null;
    const f = data[0];
    return {
      cnpj: cnpjClean,
      nome: f.DENOM_SOCIAL || f.NOME_FUNDO || "",
      tipo: f.TP_FUNDO || f.CLASSE || "",
      situacao: f.SIT || f.SITUACAO || "",
      administrador: f.ADMIN || "",
      gestor: f.GESTOR || "",
      dataConstituicao: f.DT_CONST || "",
      source: "cvm",
    };
  } catch { return null; }
}

export interface AnbimaCredentials {
  clientId: string;
  clientSecret: string;
}

export function isAnbimaConfigured(creds: AnbimaCredentials | null): boolean {
  return !!(creds && creds.clientId && creds.clientSecret);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAnbimaAccessToken(creds: AnbimaCredentials): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  try {
    const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const response = await fetch("https://api.anbima.com.br/oauth/access-token", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    });
    if (!response.ok) {
      console.error(`ANBIMA token error: ${response.status} ${response.statusText}`);
      cachedToken = null;
      return null;
    }
    const data = await response.json();
    const token = data.access_token;
    const expiresIn = data.expires_in || 3600;
    cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  } catch (err) {
    console.error("ANBIMA token fetch failed:", err);
    cachedToken = null;
    return null;
  }
}

export function clearAnbimaTokenCache() {
  cachedToken = null;
}

const ANBIMA_API = "https://api.anbima.com.br";
const ANBIMA_SANDBOX = "https://api-sandbox.anbima.com.br";

export async function listarFundosEstruturadosANBIMA(tipo?: string, creds?: AnbimaCredentials | null): Promise<FundoInfo[]> {
  if (!creds || !creds.clientId || !creds.clientSecret) return [];
  const accessToken = await getAnbimaAccessToken(creds);
  if (!accessToken) return [];
  try {
    const params = new URLSearchParams();
    params.set("size", "200");
    const headers = {
      "access_token": accessToken,
      "client_id": creds.clientId,
      "Accept": "application/json",
    };

    let response = await fetch(`${ANBIMA_API}/feed/fundos/v2/fundos?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
      headers,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      if (response.status === 403 || errText.includes("Access denied")) {
        console.log("ANBIMA production denied, falling back to sandbox...");
        response = await fetch(`${ANBIMA_SANDBOX}/feed/fundos/v2/fundos?${params.toString()}`, {
          signal: AbortSignal.timeout(15_000),
          headers,
        });
        if (!response.ok) {
          console.error(`ANBIMA sandbox error: ${response.status}`);
          return [];
        }
      } else {
        console.error(`ANBIMA fundos error: ${response.status} - ${errText}`);
        return [];
      }
    }
    const data = await response.json();
    const content = data?.content || data?.fundos || data || [];
    if (!Array.isArray(content)) return [];

    const fundos: FundoInfo[] = [];
    for (const f of content) {
      const cnpj = f.identificador_fundo || "";
      const nome = f.nome_comercial_fundo || f.razao_social_fundo || "";
      const tipoFundo = f.tipo_fundo || "";
      const dataEnc = f.data_encerramento_fundo || null;

      const classes = f.classes || [];
      const primeiraClasse = classes[0] || {};
      const categoria = primeiraClasse.nivel1_categoria || "";

      fundos.push({
        cnpj,
        nome: nome.trim(),
        tipo: tipoFundo,
        categoria,
        situacao: dataEnc ? "Encerrado" : "Ativo",
        dataConstituicao: f.data_vigencia || "",
        dataEncerramento: dataEnc,
        codigoFundo: f.codigo_fundo || "",
        administrador: "",
        gestor: "",
        source: "anbima",
      });
    }
    return fundos;
  } catch (err) {
    console.error("ANBIMA fundos fetch failed:", err);
    return [];
  }
}
