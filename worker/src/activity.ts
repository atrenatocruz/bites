import { dayKey, type ActivityResponse, type HealthDay, type HealthWorkout } from "@bites/shared";
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
// The Shortcut shows `message` to the person, so every failure carries one.
const BAD_REQUEST = { error: "bad_request", message: "Bites couldn't read this Health data. Get the latest Shortcut from Bites Settings." };
const TOO_LARGE = { error: "too_large", message: "Too much data in one sync. Get the latest Shortcut from Bites Settings." };
const RATE_LIMITED = { error: "rate_limited", message: "Too many syncs this hour. Try again later." };
const UNAVAILABLE = { error: "unavailable", message: "Bites couldn't save right now. Try again in a minute." };

/** A real calendar day in YYYY-MM-DD form ("2026-02-30" and "9999-99-99" are not). */
function validDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Shortcuts may send numbers as text in the phone's format: "412,5" (decimal comma), "1,712" or "1.712" (grouping),
 * "1,712.4" / "1.712,6" (both), or with (non-breaking) spaces between groups.
 */
function toNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let t = v.replace(/[\s\u00a0\u202f']/g, "");
  if (t === "") return null;
  const grouped = /^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.exec(t);
  if (grouped) t = t.split(grouped[1]!).join("");
  else {
    const last = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
    if (last >= 0) t = `${t.slice(0, last).replace(/[.,]/g, "")}.${t.slice(last + 1)}`;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
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

/** Health sums to 0 when it has no samples, so 0 resting energy means "not measured" (no Apple Watch). */
const isEmpty = (d: HealthDay) => d.restingKcal === null && !d.activeKcal && d.workouts.length === 0;

/**
 * Shortcuts turns a list into text when the Dictionary row type is Text: one JSON object per line.
 * Accept that and a JSON array sent as text, so a Shortcut built either way works.
 */
function asList(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t === "") return [];
  try {
    if (t.startsWith("[")) return JSON.parse(t);
    return t.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
  } catch {
    return v;
  }
}

/** `days` holds only days with data; `received` counts every day sent. */
export function parseSync(body: unknown, now: Date): { tz: string; days: [string, HealthDay][]; received: number } | null {
  if (!body || typeof body !== "object") return null;
  const { tz } = body as { tz?: unknown };
  const days = asList((body as { days?: unknown }).days);
  if (!Array.isArray(days) || days.length === 0 || days.length > MAX_DAYS) return null;
  const oldest = dayKey(new Date(now.getTime() - 10 * 86_400_000));
  const newest = dayKey(new Date(now.getTime() + 86_400_000));
  const out: [string, HealthDay][] = [];
  for (const d of days) {
    if (!d || typeof d !== "object") return null;
    const o = d as Record<string, unknown>;
    if (typeof o.day !== "string" || !validDay(o.day) || o.day < oldest || o.day > newest) return null;
    const restingKcal = energy(o.restingKcal, 20_000);
    const activeKcal = energy(o.activeKcal, 20_000);
    if (restingKcal === undefined || activeKcal === undefined) return null;
    const list = asList(o.workouts) ?? [];
    if (!Array.isArray(list) || list.length > MAX_WORKOUTS) return null;
    const workouts = list.map(parseWorkout);
    if (workouts.some((w) => w === undefined)) return null;
    const value: HealthDay = { restingKcal: restingKcal ? restingKcal : null, activeKcal, workouts: workouts as HealthWorkout[] };
    if (!isEmpty(value)) out.push([o.day, value]);
  }
  return { tz: validTz(tz), days: out, received: days.length };
}

/** Called by the Apple Shortcut with the person's key. Each sent day overwrites that day. */
export async function handleSync(req: Request, env: Env, deps: ActivityDeps): Promise<Response> {
  const key = req.headers.get("authorization")?.replace(/^Bearer /, "").trim() ?? "";
  if (!key || key.length > 100) return json(BAD_KEY, 401);
  const uid = await env.RATE_KV.get(`actkey:${await sha256Hex(key)}`);
  if (!uid) return json(BAD_KEY, 401);

  const text = await req.text();
  if (text.length > MAX_BODY) return json(TOO_LARGE, 413);
  const now = deps.now();
  if (!(await checkAndCount(env.RATE_KV, uid, `act-${now.toISOString().slice(0, 13)}`, SYNCS_PER_HOUR))) return json(RATE_LIMITED, 429);

  // Keep the last rejected body for a day: the only way to see what a hand-built Shortcut actually sends.
  const rejected = async () => {
    await env.RATE_KV.put(`actdebug:${uid}`, text, { expirationTtl: 86_400 }).catch(() => {});
    return json(BAD_REQUEST, 400);
  };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return rejected();
  }
  const parsed = parseSync(body, now);
  if (!parsed) return rejected();

  const byMonth = new Map<string, [string, HealthDay][]>();
  for (const entry of parsed.days) byMonth.set(entry[0].slice(0, 7), [...(byMonth.get(entry[0].slice(0, 7)) ?? []), entry]);
  try {
    for (const [month, entries] of byMonth) {
      const k = `activity:${uid}:${month}`;
      const current = JSON.parse((await env.RATE_KV.get(k)) ?? '{"days":{}}') as { days: Record<string, HealthDay> };
      for (const [d, value] of entries) current.days[d] = value;
      await env.RATE_KV.put(k, JSON.stringify(current), { expirationTtl: MONTH_TTL });
    }
    await env.RATE_KV.put(`activity:${uid}:last`, JSON.stringify({ syncedAt: now.getTime(), tz: parsed.tz }), { expirationTtl: MONTH_TTL });
  } catch (e) {
    // e.g. KV refusing two writes to the same month within a second when syncs overlap.
    console.error("activity sync write failed", e);
    return json(UNAVAILABLE, 503);
  }
  return json({ ok: true, days: parsed.received });
}

const MAX_RANGE_DAYS = 800;

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export async function handleGetActivity(req: Request, env: Env, deps: ActivityDeps): Promise<Response> {
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const params = new URL(req.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!validDay(from) || !validDay(to) || from > to) return json({ error: "bad_request" }, 400);
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) return json({ error: "bad_request" }, 400);

  const buckets = await Promise.all(monthsBetween(from, to).map((m) => env.RATE_KV.get(`activity:${uid}:${m}`)));
  const days: ActivityResponse["days"] = {};
  for (const raw of buckets) {
    if (!raw) continue;
    for (const [d, value] of Object.entries((JSON.parse(raw) as { days: ActivityResponse["days"] }).days)) if (d >= from && d <= to) days[d] = value;
  }
  const last = await env.RATE_KV.get(`activity:${uid}:last`);
  const hasKey = (await env.RATE_KV.get(`actkeyof:${uid}`)) !== null;
  const body: ActivityResponse = { days, lastSync: last ? JSON.parse(last) : null, hasKey };
  return json(body);
}

/** Used by "Delete all data": removes the key and every stored day. */
export async function handleDeleteActivity(req: Request, env: Env, deps: ActivityDeps): Promise<Response> {
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  await removeKey(env.RATE_KV, uid);
  await env.RATE_KV.delete(`actdebug:${uid}`);
  let cursor: string | undefined;
  do {
    const page = await env.RATE_KV.list({ prefix: `activity:${uid}:`, cursor });
    await Promise.all(page.keys.map((k) => env.RATE_KV.delete(k.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ ok: true });
}
