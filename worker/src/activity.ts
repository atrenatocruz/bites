import { dayKey, type HealthDay, type HealthWorkout } from "@bites/shared";
import { checkAndCount } from "./ratelimit";
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

export const MONTH_TTL = 60 * 60 * 24 * 400;
const MAX_BODY = 64 * 1024;
const MAX_DAYS = 8;
const MAX_WORKOUTS = 20;
const SYNCS_PER_HOUR = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BAD_KEY = { error: "invalid_key", message: "Bites key not recognised. Reconnect Apple Health in Bites Settings." };

/** Shortcuts may send numbers as text, and a pt-PT phone uses a decimal comma. */
function toNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** null = no value, undefined = invalid. */
function energy(v: unknown, max: number): number | null | undefined {
  const n = toNumber(v);
  if (n === null || n === undefined) return n;
  return n >= 0 && n <= max ? Math.round(n) : undefined;
}

function parseWorkout(w: unknown): HealthWorkout | undefined {
  if (!w || typeof w !== "object") return undefined;
  const o = w as Record<string, unknown>;
  const minutes = toNumber(o.minutes);
  const kcal = energy(o.kcal, 10_000);
  if (typeof o.start !== "string" || o.start.length > 40 || Number.isNaN(Date.parse(o.start))) return undefined;
  if (typeof minutes !== "number" || minutes < 0 || minutes > 1440 || kcal === undefined) return undefined;
  const type = (typeof o.type === "string" ? o.type.trim().slice(0, 40) : "") || "Workout";
  return { type, start: o.start, minutes: Math.round(minutes), kcal };
}

function validTz(tz: unknown): string {
  if (typeof tz !== "string" || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function parseSync(body: unknown, now: Date): { tz: string; days: [string, HealthDay][] } | null {
  if (!body || typeof body !== "object") return null;
  const { tz, days } = body as { tz?: unknown; days?: unknown };
  if (!Array.isArray(days) || days.length === 0 || days.length > MAX_DAYS) return null;
  const oldest = dayKey(new Date(now.getTime() - 10 * 86_400_000));
  const newest = dayKey(new Date(now.getTime() + 86_400_000));
  const out: [string, HealthDay][] = [];
  for (const d of days) {
    if (!d || typeof d !== "object") return null;
    const o = d as Record<string, unknown>;
    if (typeof o.day !== "string" || !DAY_RE.test(o.day) || o.day < oldest || o.day > newest) return null;
    const restingKcal = energy(o.restingKcal, 20_000);
    const activeKcal = energy(o.activeKcal, 20_000);
    if (restingKcal === undefined || activeKcal === undefined) return null;
    const list = o.workouts ?? [];
    if (!Array.isArray(list) || list.length > MAX_WORKOUTS) return null;
    const workouts = list.map(parseWorkout);
    if (workouts.some((w) => w === undefined)) return null;
    out.push([o.day, { restingKcal, activeKcal, workouts: workouts as HealthWorkout[] }]);
  }
  return { tz: validTz(tz), days: out };
}

/** Called by the Apple Shortcut with the person's key. Each sent day overwrites that day. */
export async function handleSync(req: Request, env: Env, deps: ActivityDeps): Promise<Response> {
  const key = req.headers.get("authorization")?.replace(/^Bearer /, "").trim() ?? "";
  if (!key || key.length > 100) return json(BAD_KEY, 401);
  const uid = await env.RATE_KV.get(`actkey:${await sha256Hex(key)}`);
  if (!uid) return json(BAD_KEY, 401);

  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
  const now = deps.now();
  if (!(await checkAndCount(env.RATE_KV, uid, `act-${now.toISOString().slice(0, 13)}`, SYNCS_PER_HOUR))) return json({ error: "rate_limited" }, 429);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const parsed = parseSync(body, now);
  if (!parsed) return json({ error: "bad_request" }, 400);

  const byMonth = new Map<string, [string, HealthDay][]>();
  for (const entry of parsed.days) byMonth.set(entry[0].slice(0, 7), [...(byMonth.get(entry[0].slice(0, 7)) ?? []), entry]);
  for (const [month, entries] of byMonth) {
    const k = `activity:${uid}:${month}`;
    const current = JSON.parse((await env.RATE_KV.get(k)) ?? '{"days":{}}') as { days: Record<string, HealthDay> };
    for (const [d, value] of entries) current.days[d] = value;
    await env.RATE_KV.put(k, JSON.stringify(current), { expirationTtl: MONTH_TTL });
  }
  await env.RATE_KV.put(`activity:${uid}:last`, JSON.stringify({ syncedAt: now.getTime(), tz: parsed.tz }), { expirationTtl: MONTH_TTL });
  return json({ ok: true, days: parsed.days.length });
}
