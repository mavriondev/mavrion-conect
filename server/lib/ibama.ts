/**
 * IBAMA — Embargos ambientais e autos de infração
 * Consulta base local PostgreSQL (dados importados de dadosabertos.ibama.gov.br)
 */

import { pool } from "../db";

export interface IbamaEmbargoResult {
  cpfCnpj: string;
  embargos: Array<{
    numAuto: string;
    dataInfracao: string;
    municipio: string;
    uf: string;
    area: number;
    situacao: string;
    tipInfracao: string;
  }>;
  totalEmbargos: number;
  temEmbargo: boolean;
  fonte: string;
  consultadoEm: string;
}

export async function consultarEmbargoIbama(
  cpfCnpj: string
): Promise<IbamaEmbargoResult | null> {
  const doc = cpfCnpj.replace(/\D/g, "");
  if (!doc || doc.length < 11) return null;

  try {
    const result = await pool.query(
      `SELECT num_auto_infracao, dat_infracao, municipio, uf, val_auto, situacao, tipo_infracao, descricao, termos_embargo
       FROM ibama_auto_infracao
       WHERE replace(replace(replace(cpf_cnpj, '.', ''), '-', ''), '/', '') = $1
       ORDER BY dat_infracao DESC
       LIMIT 50`,
      [doc]
    );

    const registros = result.rows;
    const embargos = registros.filter((r: any) => r.termos_embargo && r.termos_embargo.trim() !== "");

    return {
      cpfCnpj: doc,
      embargos: registros.map((r: any) => ({
        numAuto: r.num_auto_infracao || "",
        dataInfracao: r.dat_infracao || "",
        municipio: r.municipio || "",
        uf: r.uf || "",
        area: 0,
        situacao: r.situacao || "",
        tipInfracao: r.tipo_infracao || "",
      })),
      totalEmbargos: embargos.length,
      temEmbargo: embargos.length > 0,
      fonte: "IBAMA — Base Local (Dados Abertos)",
      consultadoEm: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[IBAMA] Erro consulta CPF/CNPJ:", (err as Error).message);
    return null;
  }
}

export async function consultarEmbargoIbamaCoordenadas(
  lat: number,
  lon: number
): Promise<{ temEmbargo: boolean; embargos: any[]; totalInfracoes: number; fonte: string } | null> {
  try {
    const delta = 0.05;
    const result = await pool.query(
      `SELECT num_auto_infracao, dat_infracao, municipio, uf, tipo_infracao, descricao, situacao, termos_embargo, val_auto, latitude, longitude
       FROM ibama_auto_infracao
       WHERE latitude BETWEEN $1 AND $2
         AND longitude BETWEEN $3 AND $4
       ORDER BY dat_infracao DESC
       LIMIT 100`,
      [lat - delta, lat + delta, lon - delta, lon + delta]
    );

    let rows = result.rows;

    if (rows.length === 0) {
      const coordResult = await pool.query(
        `SELECT c.latitude, c.longitude, a.num_auto_infracao, a.dat_infracao, a.municipio, a.uf,
                a.tipo_infracao, a.descricao, a.situacao, a.termos_embargo, a.val_auto
         FROM ibama_coordenadas c
         JOIN ibama_auto_infracao a ON c.seq_auto_infracao = a.seq_auto_infracao
         WHERE c.latitude BETWEEN $1 AND $2
           AND c.longitude BETWEEN $3 AND $4
         ORDER BY a.dat_infracao DESC
         LIMIT 100`,
        [lat - delta, lat + delta, lon - delta, lon + delta]
      );
      rows = coordResult.rows;
    }

    const embargos = rows.filter((r: any) => r.termos_embargo && r.termos_embargo.trim() !== "");

    return {
      temEmbargo: embargos.length > 0,
      totalInfracoes: rows.length,
      embargos: rows.map((r: any) => ({
        numAuto: r.num_auto_infracao || "",
        dataInfracao: r.dat_infracao || "",
        municipio: r.municipio || "",
        uf: r.uf || "",
        tipoInfracao: r.tipo_infracao || "",
        descricao: (r.descricao || "").substring(0, 200),
        situacao: r.situacao || "",
        temEmbargo: !!(r.termos_embargo && r.termos_embargo.trim() !== ""),
      })),
      fonte: "IBAMA — Base Local (Dados Abertos)",
    };
  } catch (err) {
    console.error("[IBAMA] Erro consulta coordenadas:", (err as Error).message);
    return null;
  }
}

export async function consultarEmbargoIbamaMunicipio(
  municipio: string,
  uf: string
): Promise<{ temEmbargo: boolean; totalInfracoes: number; totalEmbargos: number; infracoes: any[]; fonte: string } | null> {
  try {
    const result = await pool.query(
      `SELECT num_auto_infracao, dat_infracao, municipio, uf, tipo_infracao, descricao, situacao, termos_embargo, val_auto
       FROM ibama_auto_infracao
       WHERE upper(municipio) = upper($1)
         AND upper(uf) = upper($2)
       ORDER BY dat_infracao DESC
       LIMIT 200`,
      [municipio.trim(), uf.trim()]
    );

    const rows = result.rows;
    const embargos = rows.filter((r: any) => r.termos_embargo && r.termos_embargo.trim() !== "");

    return {
      temEmbargo: embargos.length > 0,
      totalInfracoes: rows.length,
      totalEmbargos: embargos.length,
      infracoes: rows.slice(0, 50).map((r: any) => ({
        numAuto: r.num_auto_infracao || "",
        dataInfracao: r.dat_infracao || "",
        tipoInfracao: r.tipo_infracao || "",
        descricao: (r.descricao || "").substring(0, 200),
        situacao: r.situacao || "",
        temEmbargo: !!(r.termos_embargo && r.termos_embargo.trim() !== ""),
      })),
      fonte: "IBAMA — Base Local (Dados Abertos)",
    };
  } catch (err) {
    console.error("[IBAMA] Erro consulta município:", (err as Error).message);
    return null;
  }
}
