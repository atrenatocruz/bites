import { dayKey } from "@bites/shared";
import { checkAndCount } from "./ratelimit";
import { dailyLimit, getPlan, isUnlocked, type Plan } from "./plan";
import type { Env } from "./env";
import type { verifyRequest as VerifyRequest } from "./auth";

export interface PlanDeps { verifyRequest: typeof VerifyRequest; now: () => Date }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MAX_ATTEMPTS_PER_DAY = 10;

/** Codes are compared by SHA-256 so the repository never contains them in plain text. */
export const normalizeCode = (raw: string) => raw.trim().toLowerCase();

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handlePlan(req: Request, env: Env, deps: PlanDeps): Promise<Response> {
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  return json(await planInfo(env, uid));
}

async function planInfo(env: Env, uid: string) {
  const plan = await getPlan(env.RATE_KV, uid);
  return { plan, dailyLimit: dailyLimit(plan, env), unlocked: await isUnlocked(env.RATE_KV, uid, plan) };
}

/** Switch between the free and paid plan. Going paid needs Premium to be unlocked (by code); going free is always allowed. */
export async function handleSetPlan(req: Request, env: Env, deps: PlanDeps): Promise<Response> {
  let body: { plan?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!body || (body.plan !== "free" && body.plan !== "paid")) return json({ error: "bad_request" }, 400);
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);

  const wanted: Plan = body.plan;
  const current = await getPlan(env.RATE_KV, uid);
  if (wanted === "paid") {
    if (!(await isUnlocked(env.RATE_KV, uid, current))) return json({ error: "locked" }, 403);
    await env.RATE_KV.put(`plan:${uid}`, "paid");
  } else {
    // Remember that Premium was unlocked (covers plans set by hand) so the user can switch back.
    if (current === "paid") await env.RATE_KV.put(`unlocked:${uid}`, "1");
    await env.RATE_KV.delete(`plan:${uid}`);
  }
  return json(await planInfo(env, uid));
}

export async function handleRedeem(req: Request, env: Env, deps: PlanDeps): Promise<Response> {
  let body: { code?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!body || typeof body.code !== "string" || body.code.length === 0 || body.code.length > 64) return json({ error: "bad_request" }, 400);

  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  if (!(await checkAndCount(env.RATE_KV, uid, `redeem-${dayKey(deps.now())}`, MAX_ATTEMPTS_PER_DAY))) return json({ error: "rate_limited" }, 429);

  const hashes = (env.REDEEM_CODE_HASHES ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!hashes.includes(await sha256Hex(normalizeCode(body.code)))) return json({ error: "invalid_code" }, 400);

  await env.RATE_KV.put(`plan:${uid}`, "paid");
  await env.RATE_KV.put(`unlocked:${uid}`, "1");
  return json({ ok: true, ...(await planInfo(env, uid)) });
}
