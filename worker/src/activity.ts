import { sha256Hex, type PlanDeps } from "./redeem";
import type { Env } from "./env";

export type ActivityDeps = PlanDeps;

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 32 random bytes, base64url without padding (43 characters). */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function removeKey(kv: KVNamespace, uid: string): Promise<void> {
  const old = await kv.get(`actkeyof:${uid}`);
  if (old) await kv.delete(`actkey:${old}`);
  await kv.delete(`actkeyof:${uid}`);
}

/** Creates the person's Shortcut key, replacing any previous one. The key is returned once and only its hash is kept. */
export async function handleCreateKey(req: Request, env: Env, deps: ActivityDeps): Promise<Response> {
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  await removeKey(env.RATE_KV, uid);
  const key = newKey();
  const hash = await sha256Hex(key);
  await env.RATE_KV.put(`actkey:${hash}`, uid);
  await env.RATE_KV.put(`actkeyof:${uid}`, hash);
  return json({ key });
}

export async function handleDeleteKey(req: Request, env: Env, deps: ActivityDeps): Promise<Response> {
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  await removeKey(env.RATE_KV, uid);
  return json({ ok: true });
}
