import { Redis } from "@upstash/redis";

type CacheRecord = {
  value: unknown;
  expiresAt: number;
};

const memoryCache = new Map<string, CacheRecord>();

let redis: Redis | null | undefined;

function getRedis() {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (client) {
    return (await client.get<T>(key)) ?? null;
  }

  const record = memoryCache.get(key);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return record.value as T;
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number) {
  const client = getRedis();
  if (client) {
    await client.set(key, value, { ex: ttlSeconds });
    return;
  }

  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

export async function incrementCachedCounter(key: string, ttlSeconds: number) {
  const client = getRedis();
  if (client) {
    const count = await client.incr(key);
    await client.expire(key, ttlSeconds);
    return count;
  }

  const current = await getCached<number>(key);
  const next = (current ?? 0) + 1;
  await setCached(key, next, ttlSeconds);
  return next;
}
