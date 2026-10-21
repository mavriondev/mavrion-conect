import { db } from "./db";
import { rawIngests } from "@shared/schema";
import { eq } from "drizzle-orm";

const TTL_SECONDS = {
  anm: 60 * 60 * 6,
  anm_enrich: 60 * 60 * 24,
  cnpja: 60 * 60 * 24,
  geo: 60 * 60 * 24,
  caf_municipio: 60 * 60 * 12,
  ibge_pam: 60 * 60 * 24,
  cotacao: 60 * 60 * 1,
  due_diligence: 60 * 60 * 24,
  dou: 60 * 60 * 24, // busca do Diário Oficial da União (Imprensa Nacional)
  querido_diario: 60 * 60 * 24, // busca em diários oficiais municipais (Querido Diário)
  sigef_geometrias: 60 * 60 * 24 * 30, // geometrias das parcelas por ativo — chave inclui o timestamp da consulta SIGEF, então refazer a consulta invalida naturalmente
  car_geometrias: 60 * 60 * 24 * 30, // geometrias dos imóveis CAR por ativo — mesma mecânica de invalidação por timestamp
  sncr_detentor: 60 * 60 * 24 * 180, // CSV do SNCR por município — base declaratória, muda devagar; captcha 1x por município
};

type CacheNS = keyof typeof TTL_SECONDS;

export async function getCached<T>(namespace: CacheNS, key: string): Promise<T | null> {
  const cacheKey = `${namespace}:${key}`;
  const [row] = await db.select().from(rawIngests).where(eq(rawIngests.externalId, cacheKey));
  if (!row) return null;

  const expiresAt = new Date(row.hashDedupe as string);
  if (isNaN(expiresAt.getTime()) || new Date() > expiresAt) {
    await db.delete(rawIngests).where(eq(rawIngests.externalId, cacheKey));
    return null;
  }

  return row.payloadJson as T;
}

export async function setCached<T>(namespace: CacheNS, key: string, data: T): Promise<void> {
  const cacheKey = `${namespace}:${key}`;
  const ttl = TTL_SECONDS[namespace];
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await db.delete(rawIngests).where(eq(rawIngests.externalId, cacheKey));
  await db.insert(rawIngests).values({
    externalId: cacheKey,
    payloadJson: data as any,
    hashDedupe: expiresAt,
    fetchedAt: new Date(),
  });
}
