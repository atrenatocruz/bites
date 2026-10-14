const TTL = 60 * 60 * 36;

/** Gives one scan back, e.g. when the AI failed so the person got nothing for it. Never goes below zero. */
export async function refund(kv: Pick<KVNamespace, "get" | "put">, uid: string, day: string) {
  const key = `rl:${uid}:${day}`;
  const n = Number((await kv.get(key)) ?? 0);
  if (n > 0) await kv.put(key, String(n - 1), { expirationTtl: TTL });
}

export async function checkAndCount(kv: Pick<KVNamespace, "get" | "put">, uid: string, day: string, limit: number) {
  const key = `rl:${uid}:${day}`;
  const n = Number((await kv.get(key)) ?? 0);
  if (n >= limit) return false;
  await kv.put(key, String(n + 1), { expirationTtl: TTL });
  return true;
}
