import { db } from "./db";
import { rawIngests } from "@shared/schema";
import { eq } from "drizzle-orm";

const TTL_SECONDS = {
  anm: 60 * 60 * 6,
  sicar: 60 * 60 * 12,
  cnpja: 60 * 60 * 24,
  geo: 60 * 60 * 24,
};

type CacheNS = keyof typeof TTL_SECONDS;

export async function getCached<T>(namespace: CacheNS, key: string): Promise<T | null> {
  const cacheKey = `${namespace}:${key}`;
  const [row] = await db.select().from(rawIngests).where(eq(rawIngests.externalId, cacheKey));
  if (!row) return null;

  const expiresAt = new Date(row.hashDedupe);
  if (new Date() > expiresAt) {
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
