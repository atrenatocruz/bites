export async function checkAndCount(kv: Pick<KVNamespace, "get" | "put">, uid: string, day: string, limit: number) {
  const key = `rl:${uid}:${day}`;
  const n = Number((await kv.get(key)) ?? 0);
  if (n >= limit) return false;
  await kv.put(key, String(n + 1), { expirationTtl: 60 * 60 * 36 });
  return true;
}
