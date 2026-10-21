// Os layouts variam por categoria; posições fixas não são um contrato da PGFN.
export function pgfnHeader(line: string): Map<string, number> {
  const fields = line.replace(/^\uFEFF/, "").split(";").map(s => s.trim().replace(/^"|"$/g, "").toUpperCase());
  const index = new Map(fields.map((name, i) => [name, i]));
  for (const required of ["CPF_CNPJ", "TIPO_PESSOA", "NOME_DEVEDOR", "UF_DEVEDOR", "VALOR_CONSOLIDADO"]) {
    if (!index.has(required)) throw new Error(`CSV PGFN sem coluna obrigatória: ${required}`);
  }
  return index;
}

export function pgfnRow(line: string, header: Map<string, number>) {
  const fields = line.split(";");
  const get = (key: string) => (fields[header.get(key)!] || "").trim().replace(/^"|"$/g, "");
  const cpfCnpj = get("CPF_CNPJ").replace(/[^0-9*]/g, "");
  const rawValue = get("VALOR_CONSOLIDADO");
  const valor = Number(rawValue);
  if (!cpfCnpj || !rawValue || !Number.isFinite(valor) || valor < 0) {
    throw new Error("CSV PGFN com documento ou valor inválido");
  }
  return { cpfCnpj, valor, tipoPessoa: get("TIPO_PESSOA") || null,
    nomeDevedor: get("NOME_DEVEDOR") || null, uf: get("UF_DEVEDOR").toUpperCase() || null };
}
