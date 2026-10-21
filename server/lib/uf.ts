// Utilitários de UF — validação, extração de siglas e derivação a partir de
// códigos IBGE. O prefixo de 2 dígitos do código IBGE de município identifica
// a UF (ex.: 2927408 → 29 → BA) — tabela oficial e estável do IBGE.

export const UFS_VALIDAS = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

const IBGE_UF: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

/** Extrai siglas de UF válidas de um texto livre ("BA", "Bahia - BA", "SP/MG"). */
export function extrairUfs(v: any): string[] {
  return String(v ?? "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length === 2 && UFS_VALIDAS.has(t));
}

/** UF a partir de código IBGE: de município (7 dígitos) ou da própria UF (2 dígitos). */
export function ufDeCodigoIbge(v: any): string | null {
  const digitos = String(v ?? "").replace(/\D/g, "");
  if (digitos.length !== 2 && digitos.length !== 7) return null;
  return IBGE_UF[digitos.slice(0, 2)] ?? null;
}

/**
 * UF(s) do ativo para consultas em camadas estaduais (ex.: SICAR).
 * Ordem: cadastro (estado) → dados ANM já enriquecidos → fallback por dados
 * fundiários já consultados: parcelas SIGEF salvas (UF textual, código IBGE
 * de UF ou prefixo do código IBGE de município) e UFs da última consulta CAR.
 */
export function resolveAssetUfs(asset: any): string[] {
  const campos = (asset?.camposEspecificos as any) || {};
  const attrs = (asset?.attributesJson as any) || {};
  for (const fonte of [asset?.estado, campos.anmLiveData?.UF, campos.anmLiveData?.uf, attrs.anmUf]) {
    const ufs = extrairUfs(fonte);
    if (ufs.length > 0) return Array.from(new Set(ufs));
  }

  const derivadas = new Set<string>();
  for (const p of campos.sigefParcelas?.parcelas || []) {
    for (const u of extrairUfs(p?.uf)) derivadas.add(u);
    const viaUfIbge = ufDeCodigoIbge(p?.uf);
    if (viaUfIbge) derivadas.add(viaUfIbge);
    const viaMunicipio = ufDeCodigoIbge(p?.municipioIbge);
    if (viaMunicipio) derivadas.add(viaMunicipio);
  }
  for (const u of campos.carImoveis?.ufsConsultadas || []) {
    for (const x of extrairUfs(u)) derivadas.add(x);
  }
  return Array.from(derivadas);
}
