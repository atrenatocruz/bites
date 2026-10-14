# Apple Health (Activity and Calorie Deficit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Apple Shortcut sends daily Health energy and workouts to the Bites API, and the app shows burned vs eaten, the real calorie deficit, workouts, and setup in Settings.

**Architecture:** A new `worker/src/activity.ts` module adds key management (Firebase-auth), a Bearer-key sync endpoint for the Shortcut, and a read endpoint, storing month buckets in the existing `RATE_KV`. The web app gets `lib/activity.ts` (API client, pure deficit maths, a `useActivity` hook with a localStorage cache), an `ActivityCard` in the Diary, workout dots in the week strip and month calendar, two Trends stats, and a `HealthSection` in Settings. The Shortcut itself is built by the owner on an iPhone from a recipe in `docs/apple-health-shortcut.md`.

**Tech Stack:** Cloudflare Workers + KV, TypeScript, React 19 + Vite PWA, Tailwind, react-i18next, date-fns, Vitest + Testing Library, npm workspaces (`shared`, `worker`, `web`).

**Spec:** `docs/superpowers/specs/2026-10-14-apple-health-design.md`

## Global Constraints

- Deficit = `(restingKcal + activeKcal) − eatenKcal`; never shown for a day without Health data. Resting missing → profile BMR, marked "estimated". Today → "so far".
- The existing ring and target do not change meaning.
- New routes live under `/api/activity` (`/api/health` is the uptime check and must keep working).
- KV keys: `actkey:<sha256(key)>` → uid, `actkeyof:<uid>` → hash, `activity:<uid>:<YYYY-MM>` → `{ days }` (TTL 400 days), `activity:<uid>:last` → `{ syncedAt, tz }` (TTL 400 days). Only the key hash is stored.
- Sync limits: ≤ 8 days per request, each day within the last 10 days and ≤ 1 day ahead; energy `null` or 0–20 000; ≤ 20 workouts/day; minutes 0–1 440; workout kcal `null` or 0–10 000; type ≤ 40 chars; body ≤ 64 KB; 30 syncs per key per hour; GET range ≤ 800 days.
- Apple Health UI only on iOS (`detectPlatform() === "ios"`); elsewhere Settings says it is iPhone-only.
- All user-facing strings in `web/src/locales/en.json` and `web/src/locales/pt-PT.json` (pt-PT, "tu" form like the rest of the app). Energy via `formatEnergy`/`energyUnit`.
- Connect button hidden while `VITE_HEALTH_SHORTCUT_URL` is empty.
- Every deploy needs the user's explicit OK. Web build always needs `VITE_API_URL=https://bites-api.wellbites.workers.dev`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push straight to `main` only when the user says so.

## Review Focus

1. **Numbers arriving as strings with a decimal comma** (a pt-PT iPhone sends `"412,5"`): stored as 413, not rejected. Test in Task 2.
2. **Re-sending the same days** (nightly automation plus manual Sync): a day is overwritten, never doubled, and other days in the same month survive. Test in Task 2.
3. **Clipboard after `await` on iOS**: the key copy must be started inside the tap (`ClipboardItem` with a promise); if it fails the key is shown on screen. Test in Task 7.
4. **A day with Health data but no meals logged**: the card shows "Ate 0" honestly, but Trends' average deficit ignores that day. Test in Task 6.
5. **Old or replaced key**: after Connect is pressed again, the previous key gets 401 and the Shortcut shows the reconnect message. Test in Task 1.

---

### Task 1: Shared types and worker key management

**Files:**
- Modify: `shared/src/types.ts` (append)
- Create: `worker/src/activity.ts`
- Create: `worker/test/memkv.ts`
- Create: `worker/test/activity.test.ts`

**Interfaces:**
- Produces (shared): `HealthWorkout`, `HealthDay`, `ActivityResponse` types.
- Produces (worker): `handleCreateKey(req, env, deps)`, `handleDeleteKey(req, env, deps)`, `removeKey(kv, uid)`, `newKey()`, `ActivityDeps = PlanDeps` (from `./redeem`: `{ verifyRequest, now }`), and `json(body, status)`.
- Produces (test): `memKv()` returning `{ store: Map<string,string>, kv: KVNamespace }`.

- [ ] **Step 1: Add the shared types**

Append to `shared/src/types.ts`:

```ts
/** One workout as sent by the Apple Health Shortcut. */
export interface HealthWorkout { type: string; start: string; minutes: number; kcal: number | null }
/** One day of Apple Health data. Energy is in kcal; null when Health had no samples. */
export interface HealthDay { restingKcal: number | null; activeKcal: number | null; workouts: HealthWorkout[] }
/** GET /api/activity response. */
export interface ActivityResponse {
  days: Record<string, HealthDay>;
  lastSync: { syncedAt: number; tz: string } | null;
  hasKey: boolean;
}
```

- [ ] **Step 2: Write the in-memory KV used by the tests**

Create `worker/test/memkv.ts`:

```ts
/** A Map-backed stand-in for the parts of KVNamespace the activity code uses. */
export function memKv() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
    list: async ({ prefix = "" }: { prefix?: string; cursor?: string } = {}) => ({
      keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    }),
  };
  return { store, kv: kv as unknown as KVNamespace };
}
```

- [ ] **Step 3: Write the failing tests**

Create `worker/test/activity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handleCreateKey, handleDeleteKey } from "../src/activity";
import { sha256Hex } from "../src/redeem";
import type { Env } from "../src/env";
import { memKv } from "./memkv";

const NOW = new Date("2026-10-14T20:00:00Z");
const setup = (uid: string | null = "u1") => {
  const { store, kv } = memKv();
  const env = { ANTHROPIC_API_KEY: "k", RATE_KV: kv } as Env;
  const deps = { verifyRequest: async () => uid, now: () => NOW };
  return { store, env, deps };
};
const req = (path: string, init: RequestInit = {}) => new Request(`https://api.test${path}`, init);

describe("activity keys", () => {
  it("creates a key and stores only its hash", async () => {
    const { store, env, deps } = setup();
    const res = await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps);
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = await sha256Hex(key);
    expect(store.get(`actkey:${hash}`)).toBe("u1");
    expect(store.get("actkeyof:u1")).toBe(hash);
    expect([...store.values()]).not.toContain(key);
  });

  it("replaces the previous key so the old one stops working", async () => {
    const { store, env, deps } = setup();
    const first = ((await (await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps)).json()) as { key: string }).key;
    const second = ((await (await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps)).json()) as { key: string }).key;
    expect(second).not.toBe(first);
    expect(store.has(`actkey:${await sha256Hex(first)}`)).toBe(false);
    expect(store.get(`actkey:${await sha256Hex(second)}`)).toBe("u1");
  });

  it("deletes the key", async () => {
    const { store, env, deps } = setup();
    await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps);
    const res = await handleDeleteKey(req("/api/activity/key", { method: "DELETE" }), env, deps);
    expect(res.status).toBe(200);
    expect([...store.keys()].filter((k) => k.startsWith("actkey"))).toEqual([]);
  });

  it("requires a signed-in user", async () => {
    const { env, deps } = setup(null);
    expect((await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps)).status).toBe(401);
    expect((await handleDeleteKey(req("/api/activity/key", { method: "DELETE" }), env, deps)).status).toBe(401);
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd worker && npx vitest run test/activity.test.ts`
Expected: FAIL, cannot resolve `../src/activity`.

- [ ] **Step 5: Implement key management**

Create `worker/src/activity.ts`:

```ts
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
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd worker && npx vitest run test/activity.test.ts && npx tsc --noEmit`
Expected: 4 passed, no type errors.

- [ ] **Step 7: Commit**

```bash
git add shared/src/types.ts worker/src/activity.ts worker/test/memkv.ts worker/test/activity.test.ts
git commit -m "feat(worker): Apple Health sync keys"
```

---

### Task 2: Worker sync endpoint for the Shortcut

**Files:**
- Modify: `worker/src/activity.ts`
- Modify: `worker/test/activity.test.ts`

**Interfaces:**
- Consumes: `json`, `ActivityDeps` (Task 1); `checkAndCount(kv, uid, day, limit)` from `./ratelimit` (key `rl:<uid>:<day>`, 36 h TTL); `sha256Hex` from `./redeem`; `dayKey(date)` from `@bites/shared` (local `YYYY-MM-DD`; the worker runs in UTC).
- Produces: `handleSync(req, env, deps)`, `parseSync(body, now): { tz: string; days: [string, HealthDay][] } | null`, `MONTH_TTL`.

- [ ] **Step 1: Write the failing tests**

Add to `worker/test/activity.test.ts` (extend the import from `../src/activity` with `handleSync`):

```ts
describe("sync", () => {
  const connect = async () => {
    const s = setup();
    const { key } = (await (await handleCreateKey(req("/api/activity/key", { method: "POST" }), s.env, s.deps)).json()) as { key: string };
    const sync = (body: unknown, auth = `Bearer ${key}`) =>
      handleSync(req("/api/activity/sync", { method: "POST", headers: { authorization: auth }, body: typeof body === "string" ? body : JSON.stringify(body) }), s.env, s.deps);
    return { ...s, key, sync };
  };
  const day = (d: string, over: Record<string, unknown> = {}) => ({ day: d, restingKcal: 1700, activeKcal: 450, workouts: [], ...over });
  const month = (store: Map<string, string>, m: string) => JSON.parse(store.get(`activity:u1:${m}`) ?? "null");

  it("stores days in month buckets and records the last sync", async () => {
    const { store, sync } = await connect();
    const run = { type: "Running", start: "2026-10-14T07:10:00+01:00", minutes: 42, kcal: 410 };
    const res = await sync({ tz: "Europe/Lisbon", days: [day("2026-09-30"), day("2026-10-14", { workouts: [run] })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, days: 2 });
    expect(month(store, "2026-09").days["2026-09-30"]).toEqual({ restingKcal: 1700, activeKcal: 450, workouts: [] });
    expect(month(store, "2026-10").days["2026-10-14"].workouts).toEqual([run]);
    expect(JSON.parse(store.get("activity:u1:last")!)).toEqual({ syncedAt: NOW.getTime(), tz: "Europe/Lisbon" });
  });

  it("overwrites a re-sent day and keeps the other days of the month", async () => {
    const { store, sync } = await connect();
    await sync({ days: [day("2026-10-12"), day("2026-10-13")] });
    await sync({ days: [day("2026-10-13", { activeKcal: 900 })] });
    const days = month(store, "2026-10").days;
    expect(days["2026-10-12"].activeKcal).toBe(450);
    expect(days["2026-10-13"].activeKcal).toBe(900);
  });

  it("accepts numbers sent as strings, including a decimal comma, and rounds them", async () => {
    const { store, sync } = await connect();
    await sync({ days: [day("2026-10-14", { restingKcal: "1712,6", activeKcal: "412.4", workouts: [{ type: " Corrida ", start: "2026-10-14T07:00:00Z", minutes: "30,5", kcal: "" }] })] });
    expect(month(store, "2026-10").days["2026-10-14"]).toEqual({
      restingKcal: 1713, activeKcal: 412, workouts: [{ type: "Corrida", start: "2026-10-14T07:00:00Z", minutes: 31, kcal: null }],
    });
  });

  it("stores missing energy as null and falls back to UTC for an unknown time zone", async () => {
    const { store, sync } = await connect();
    await sync({ tz: "Mars/Olympus", days: [{ day: "2026-10-14", activeKcal: 300 }] });
    expect(month(store, "2026-10").days["2026-10-14"]).toEqual({ restingKcal: null, activeKcal: 300, workouts: [] });
    expect(JSON.parse(store.get("activity:u1:last")!).tz).toBe("UTC");
  });

  it("rejects bad input", async () => {
    const { sync } = await connect();
    expect((await sync("not json")).status).toBe(400);
    expect((await sync({ days: [] })).status).toBe(400);
    expect((await sync({ days: Array.from({ length: 9 }, (_, i) => day(`2026-10-0${(i % 9) + 1}`)) })).status).toBe(400);
    expect((await sync({ days: [day("2026-10-03")] })).status).toBe(400); // older than 10 days
    expect((await sync({ days: [day("2026-10-16")] })).status).toBe(400); // more than 1 day ahead
    expect((await sync({ days: [day("2026-10-14", { activeKcal: 20_001 })] })).status).toBe(400);
    expect((await sync({ days: [day("2026-10-14", { activeKcal: -1 })] })).status).toBe(400);
    expect((await sync({ days: [day("2026-10-14", { workouts: [{ type: "Run", start: "nope", minutes: 10, kcal: 1 }] })] })).status).toBe(400);
    expect((await sync({ days: [day("2026-10-14", { workouts: Array.from({ length: 21 }, () => ({ type: "Run", start: "2026-10-14T07:00:00Z", minutes: 1, kcal: 1 })) })] })).status).toBe(400);
    expect((await sync("x".repeat(64 * 1024 + 1))).status).toBe(413);
  });

  it("rejects a missing, unknown or replaced key", async () => {
    const { sync, env, deps } = await connect();
    expect((await sync({ days: [day("2026-10-14")] }, "")).status).toBe(401);
    expect((await sync({ days: [day("2026-10-14")] }, "Bearer nope")).status).toBe(401);
    await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps);
    const res = await sync({ days: [day("2026-10-14")] });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_key", message: "Bites key not recognised. Reconnect Apple Health in Bites Settings." });
  });

  it("limits a key to 30 syncs an hour", async () => {
    const { sync } = await connect();
    for (let i = 0; i < 30; i++) expect((await sync({ days: [day("2026-10-14")] })).status).toBe(200);
    expect((await sync({ days: [day("2026-10-14")] })).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd worker && npx vitest run test/activity.test.ts`
Expected: FAIL, `handleSync` is not exported.

- [ ] **Step 3: Implement parsing and the endpoint**

Add to `worker/src/activity.ts` (merge the imports at the top):

```ts
import { dayKey, type HealthDay, type HealthWorkout } from "@bites/shared";
import { checkAndCount } from "./ratelimit";

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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd worker && npx vitest run test/activity.test.ts && npx tsc --noEmit`
Expected: all passed, no type errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/activity.ts worker/test/activity.test.ts
git commit -m "feat(worker): Apple Health sync endpoint for the Shortcut"
```

---

### Task 3: Worker read and delete-all endpoints, routing

**Files:**
- Modify: `worker/src/activity.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/test/activity.test.ts`

**Interfaces:**
- Consumes: Task 1–2 handlers, `ActivityResponse` from `@bites/shared`.
- Produces: `handleGetActivity(req, env, deps)`, `handleDeleteActivity(req, env, deps)`, `monthsBetween(from, to): string[]`. Routes: `POST|DELETE /api/activity/key`, `POST /api/activity/sync`, `GET|DELETE /api/activity`.

- [ ] **Step 1: Write the failing tests**

Add to `worker/test/activity.test.ts` (extend the import with `handleGetActivity, handleDeleteActivity, monthsBetween`):

```ts
describe("read and delete", () => {
  const seed = (store: Map<string, string>) => {
    store.set("activity:u1:2026-09", JSON.stringify({ days: { "2026-09-29": { restingKcal: 1, activeKcal: 2, workouts: [] }, "2026-09-30": { restingKcal: 3, activeKcal: 4, workouts: [] } } }));
    store.set("activity:u1:2026-10", JSON.stringify({ days: { "2026-10-01": { restingKcal: 5, activeKcal: 6, workouts: [] } } }));
    store.set("activity:u1:last", JSON.stringify({ syncedAt: 123, tz: "UTC" }));
    store.set("activity:u2:2026-10", JSON.stringify({ days: { "2026-10-01": { restingKcal: 9, activeKcal: 9, workouts: [] } } }));
  };

  it("lists months between two days", () => {
    expect(monthsBetween("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("returns the days in range, the last sync and whether a key exists", async () => {
    const { store, env, deps } = setup();
    seed(store);
    store.set("actkeyof:u1", "h");
    const res = await handleGetActivity(req("/api/activity?from=2026-09-30&to=2026-10-31"), env, deps);
    expect(await res.json()).toEqual({
      days: { "2026-09-30": { restingKcal: 3, activeKcal: 4, workouts: [] }, "2026-10-01": { restingKcal: 5, activeKcal: 6, workouts: [] } },
      lastSync: { syncedAt: 123, tz: "UTC" },
      hasKey: true,
    });
  });

  it("answers empty for someone who never connected", async () => {
    const { env, deps } = setup();
    expect(await (await handleGetActivity(req("/api/activity?from=2026-10-01&to=2026-10-31"), env, deps)).json()).toEqual({ days: {}, lastSync: null, hasKey: false });
  });

  it("validates the range and requires login", async () => {
    const { env, deps } = setup();
    expect((await handleGetActivity(req("/api/activity?from=2026-10-31&to=2026-10-01"), env, deps)).status).toBe(400);
    expect((await handleGetActivity(req("/api/activity?from=2024-01-01&to=2026-10-31"), env, deps)).status).toBe(400);
    expect((await handleGetActivity(req("/api/activity?from=x&to=2026-10-31"), env, deps)).status).toBe(400);
    const anon = setup(null);
    expect((await handleGetActivity(req("/api/activity?from=2026-10-01&to=2026-10-31"), anon.env, anon.deps)).status).toBe(401);
  });

  it("deletes the key and all of that person's activity, and nobody else's", async () => {
    const { store, env, deps } = setup();
    seed(store);
    await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps);
    const res = await handleDeleteActivity(req("/api/activity", { method: "DELETE" }), env, deps);
    expect(res.status).toBe(200);
    expect([...store.keys()].sort()).toEqual(["activity:u2:2026-10"]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd worker && npx vitest run test/activity.test.ts`
Expected: FAIL, the new handlers are not exported.

- [ ] **Step 3: Implement the handlers**

Add to `worker/src/activity.ts` (add `ActivityResponse` to the `@bites/shared` import):

```ts
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
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return json({ error: "bad_request" }, 400);
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
  let cursor: string | undefined;
  do {
    const page = await env.RATE_KV.list({ prefix: `activity:${uid}:`, cursor });
    await Promise.all(page.keys.map((k) => env.RATE_KV.delete(k.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ ok: true });
}
```

- [ ] **Step 4: Route them**

In `worker/src/index.ts`:

1. Add the import:
```ts
import { handleCreateKey, handleDeleteActivity, handleDeleteKey, handleGetActivity, handleSync } from "./activity";
```
2. In `corsHeaders`, change the methods line to:
```ts
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
```
3. In `route`, before the final `not_found` line:
```ts
  if (req.method === "POST" && pathname === "/api/activity/sync") return handleSync(req, env, planDeps);
  if (req.method === "POST" && pathname === "/api/activity/key") return handleCreateKey(req, env, planDeps);
  if (req.method === "DELETE" && pathname === "/api/activity/key") return handleDeleteKey(req, env, planDeps);
  if (req.method === "GET" && pathname === "/api/activity") return handleGetActivity(req, env, planDeps);
  if (req.method === "DELETE" && pathname === "/api/activity") return handleDeleteActivity(req, env, planDeps);
```

- [ ] **Step 5: Run all worker tests**

Run: `cd worker && npx vitest run && npx tsc --noEmit`
Expected: all passed (existing suites included), no type errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/activity.ts worker/src/index.ts worker/test/activity.test.ts
git commit -m "feat(worker): read and delete Apple Health activity, route /api/activity"
```

---

### Task 4: Web activity library (API client, deficit maths, hook)

**Files:**
- Modify: `web/src/lib/api.ts` (export `authedJson`)
- Create: `web/src/lib/activity.ts`
- Create: `web/test/activity.test.ts`

**Interfaces:**
- Consumes: `authedJson<T>(path, init, token)` from `./api` (now exported); `bmr(sex, weightKg, heightCm, age)` from `@bites/shared`; `detectPlatform()` from `./install`; `shiftKey`, `parseKey` from `./stats`; `HealthDay`, `ActivityResponse`, `DaySummary`, `Profile` from `@bites/shared`.
- Produces:
  - `SHORTCUT_NAME = "Bites Health"`, `shortcutUrl(): string` (reads `import.meta.env.VITE_HEALTH_SHORTCUT_URL`, `""` when unset), `runShortcutUrl(): string`, `healthAvailable(): boolean`.
  - `createKey(token): Promise<string | null>`, `deleteKey(token): Promise<boolean>`, `deleteAllActivity(token): Promise<boolean>`, `fetchActivity(from, to, token): Promise<ActivityResponse | null>`.
  - `interface Deficit { burned: number; eaten: number; deficit: number; estimated: boolean }`
  - `deficitFor(day: HealthDay | undefined, eatenKcal: number, profile: BodyProfile | null, year: number): Deficit | null` where `type BodyProfile = Pick<Profile, "sex" | "weightKg" | "heightCm" | "birthYear">`.
  - `periodActivity(days: Record<string, HealthDay>, summaries: DaySummary[], from: string, to: string, profile: BodyProfile | null): { avgDeficit: number | null; workouts: number }`.
  - `isStale(lastSync: ActivityResponse["lastSync"], now: number): boolean` (older than 24 h).
  - `useActivity(from: string, to: string, getToken: () => Promise<string | null>): ActivityResponse | null` — cached in localStorage under `bites.activity`, refetched on mount, on range change, and when the page becomes visible; does nothing when `healthAvailable()` is false.

- [ ] **Step 1: Export `authedJson`**

In `web/src/lib/api.ts`, change `async function authedJson<T>(` to `export async function authedJson<T>(`.

- [ ] **Step 2: Write the failing tests**

Create `web/test/activity.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DaySummary, HealthDay } from "@bites/shared";
import { bmr } from "@bites/shared";
import { createKey, deficitFor, fetchActivity, isStale, periodActivity, runShortcutUrl, useActivity } from "../src/lib/activity";

const body = { sex: "male", weightKg: 80, heightCm: 180, birthYear: 1996 } as const;
const hd = (restingKcal: number | null, activeKcal: number | null, workouts: HealthDay["workouts"] = []): HealthDay => ({ restingKcal, activeKcal, workouts });
const sum = (dayKey: string, kcal: number): DaySummary => ({ dayKey, kcal, protein: 0, carbs: 0, fat: 0, count: 1 });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("deficitFor", () => {
  it("is burned minus eaten", () => {
    expect(deficitFor(hd(1700, 950), 2100, body, 2026)).toEqual({ burned: 2650, eaten: 2100, deficit: 550, estimated: false });
  });
  it("goes negative on a surplus", () => {
    expect(deficitFor(hd(1700, 200), 2100, body, 2026)?.deficit).toBe(-200);
  });
  it("falls back to BMR when resting energy is missing", () => {
    const expected = Math.round(bmr("male", 80, 180, 30)) + 300;
    expect(deficitFor(hd(null, 300), 0, body, 2026)).toEqual({ burned: expected, eaten: 0, deficit: expected, estimated: true });
  });
  it("treats missing active energy as zero", () => {
    expect(deficitFor(hd(1700, null), 1000, body, 2026)?.burned).toBe(1700);
  });
  it("is null without Health data, or without a profile when BMR is needed", () => {
    expect(deficitFor(undefined, 1000, body, 2026)).toBeNull();
    expect(deficitFor(hd(null, null), 1000, body, 2026)).toBeNull();
    expect(deficitFor(hd(null, 300), 1000, null, 2026)).toBeNull();
  });
});

describe("periodActivity", () => {
  const days = {
    "2026-10-12": hd(1700, 800, [{ type: "Run", start: "2026-10-12T07:00:00Z", minutes: 30, kcal: 300 }]),
    "2026-10-13": hd(1700, 300),
    "2026-10-14": hd(1700, 500, [{ type: "Walk", start: "2026-10-14T07:00:00Z", minutes: 30, kcal: 100 }, { type: "Yoga", start: "2026-10-14T19:00:00Z", minutes: 20, kcal: 60 }]),
    "2026-10-20": hd(1700, 500, [{ type: "Run", start: "2026-10-20T07:00:00Z", minutes: 30, kcal: 300 }]),
  };
  it("averages the deficit only over days with Health data and meals, and counts workouts", () => {
    // 10-13 has no meals logged, so it is left out of the average; 10-20 is out of range.
    const out = periodActivity(days, [sum("2026-10-12", 2000), sum("2026-10-14", 2400)], "2026-10-12", "2026-10-18", body);
    expect(out).toEqual({ avgDeficit: Math.round((500 + -200) / 2), workouts: 3 });
  });
  it("has no average when no day has both", () => {
    expect(periodActivity(days, [], "2026-10-12", "2026-10-18", body).avgDeficit).toBeNull();
  });
});

describe("isStale", () => {
  it("is stale after 24 hours or when never synced", () => {
    const now = Date.parse("2026-10-14T20:00:00Z");
    expect(isStale(null, now)).toBe(true);
    expect(isStale({ syncedAt: now - 23 * 3_600_000, tz: "UTC" }, now)).toBe(false);
    expect(isStale({ syncedAt: now - 25 * 3_600_000, tz: "UTC" }, now)).toBe(true);
  });
});

describe("API client", () => {
  it("creates a key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await createKey("tok")).toBe("abc");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/activity\/key$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("returns null when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await createKey("tok")).toBeNull();
    expect(await fetchActivity("2026-10-01", "2026-10-31", "tok")).toBeNull();
  });
  it("builds the run URL for the Shortcut", () => {
    expect(runShortcutUrl()).toBe("shortcuts://run-shortcut?name=Bites%20Health");
  });
});

describe("useActivity", () => {
  const response = { days: { "2026-10-14": hd(1700, 500) }, lastSync: { syncedAt: 1, tz: "UTC" }, hasKey: true };
  const ios = () => vi.stubGlobal("navigator", { ...navigator, userAgent: "iPhone", onLine: true });

  it("fetches, caches, and refetches when the page becomes visible", async () => {
    ios();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useActivity("2026-10-01", "2026-10-31", async () => "tok"));
    await waitFor(() => expect(result.current).toEqual(response));
    expect(JSON.parse(localStorage.getItem("bites.activity")!)).toEqual(response);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("starts from the cache when offline", async () => {
    ios();
    localStorage.setItem("bites.activity", JSON.stringify(response));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const { result } = renderHook(() => useActivity("2026-10-01", "2026-10-31", async () => "tok"));
    expect(result.current).toEqual(response);
  });

  it("does nothing off iOS", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "Android", onLine: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useActivity("2026-10-01", "2026-10-31", async () => "tok"));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd web && npx vitest run test/activity.test.ts`
Expected: FAIL, cannot resolve `../src/lib/activity`.

- [ ] **Step 4: Implement the library**

Create `web/src/lib/activity.ts`:

```ts
import { useEffect, useState } from "react";
import { bmr, type ActivityResponse, type DaySummary, type HealthDay, type Profile } from "@bites/shared";
import { authedJson } from "./api";
import { detectPlatform } from "./install";
import { shiftKey } from "./stats";

export const SHORTCUT_NAME = "Bites Health";
const CACHE_KEY = "bites.activity";
const STALE_MS = 24 * 60 * 60 * 1000;

export type BodyProfile = Pick<Profile, "sex" | "weightKg" | "heightCm" | "birthYear">;
export interface Deficit { burned: number; eaten: number; deficit: number; estimated: boolean }

/** The shared iCloud link to the Shortcut; empty until the owner has built and shared it. */
export const shortcutUrl = (): string => import.meta.env.VITE_HEALTH_SHORTCUT_URL ?? "";
export const runShortcutUrl = () => `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
/** Apple Health can only be reached through Shortcuts, which exist on iPhone and iPad. */
export const healthAvailable = () => detectPlatform() === "ios";

export async function createKey(token: string | null): Promise<string | null> {
  try {
    const r = await authedJson<{ key: string }>("/api/activity/key", { method: "POST" }, token);
    return r.ok && typeof r.body?.key === "string" ? r.body.key : null;
  } catch {
    return null;
  }
}

export async function deleteKey(token: string | null): Promise<boolean> {
  try {
    return (await authedJson("/api/activity/key", { method: "DELETE" }, token)).ok;
  } catch {
    return false;
  }
}

export async function deleteAllActivity(token: string | null): Promise<boolean> {
  try {
    return (await authedJson("/api/activity", { method: "DELETE" }, token)).ok;
  } catch {
    return false;
  }
}

export async function fetchActivity(from: string, to: string, token: string | null): Promise<ActivityResponse | null> {
  try {
    const r = await authedJson<ActivityResponse>(`/api/activity?from=${from}&to=${to}`, { method: "GET" }, token);
    return r.ok && r.body && typeof r.body.days === "object" ? r.body : null;
  } catch {
    return null;
  }
}

/** Burned (Health resting + active) minus eaten. Null when the day has no Health energy at all. */
export function deficitFor(day: HealthDay | undefined, eatenKcal: number, profile: BodyProfile | null, year: number): Deficit | null {
  if (!day || (day.restingKcal === null && day.activeKcal === null)) return null;
  let resting = day.restingKcal;
  let estimated = false;
  if (resting === null) {
    if (!profile) return null;
    resting = bmr(profile.sex, profile.weightKg, profile.heightCm, year - profile.birthYear);
    estimated = true;
  }
  const burned = Math.round(resting + (day.activeKcal ?? 0));
  const eaten = Math.round(eatenKcal);
  return { burned, eaten, deficit: burned - eaten, estimated };
}

/** Average deficit over days with both Health data and logged meals, and the number of workouts, for [from, to]. */
export function periodActivity(days: Record<string, HealthDay>, summaries: DaySummary[], from: string, to: string, profile: BodyProfile | null) {
  const eaten = new Map(summaries.map((s) => [s.dayKey, s.kcal]));
  let total = 0;
  let counted = 0;
  let workouts = 0;
  for (let key = from; key <= to; key = shiftKey(key, 1)) {
    const day = days[key];
    if (!day) continue;
    workouts += day.workouts.length;
    const kcal = eaten.get(key);
    if (kcal === undefined) continue;
    const d = deficitFor(day, kcal, profile, Number(key.slice(0, 4)));
    if (!d) continue;
    total += d.deficit;
    counted += 1;
  }
  return { avgDeficit: counted ? Math.round(total / counted) : null, workouts };
}

export const isStale = (lastSync: ActivityResponse["lastSync"], now: number) => !lastSync || now - lastSync.syncedAt > STALE_MS;

function readCache(): ActivityResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ActivityResponse) : null;
  } catch {
    return null;
  }
}

/** Health data for [from, to]. Starts from the last cached answer, refetches on range change and when the app comes back to the foreground (e.g. after running the Shortcut). */
export function useActivity(from: string, to: string, getToken: () => Promise<string | null>): ActivityResponse | null {
  const enabled = healthAvailable();
  const [data, setData] = useState<ActivityResponse | null>(() => (enabled ? readCache() : null));

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = async () => {
      const next = await fetchActivity(from, to, await getToken().catch(() => null));
      if (!live || !next) return;
      setData(next);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked: the in-memory copy still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
    // getToken is a stable repo method; refetching on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, from, to]);

  return data;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd web && npx vitest run test/activity.test.ts && npx tsc --noEmit`
Expected: all passed, no type errors. (If `import.meta.env.VITE_HEALTH_SHORTCUT_URL` is a type error, add `/// <reference types="vite/client" />` usage is already present for `VITE_API_URL`; otherwise declare it in `web/src/globals.d.ts` as `interface ImportMetaEnv { readonly VITE_HEALTH_SHORTCUT_URL?: string }`.)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/activity.ts web/test/activity.test.ts web/src/globals.d.ts
git commit -m "feat(web): Apple Health activity client, deficit maths and hook"
```

---

### Task 5: Diary Activity card and workout dots

**Files:**
- Create: `web/src/features/diary/ActivityCard.tsx`
- Modify: `web/src/features/diary/DiaryScreen.tsx`
- Modify: `web/src/features/diary/WeekStrip.tsx`
- Modify: `web/src/features/diary/MonthCalendar.tsx`
- Modify: `web/src/locales/en.json`, `web/src/locales/pt-PT.json`
- Create: `web/test/activityCard.test.tsx`

**Interfaces:**
- Consumes: `deficitFor`, `isStale`, `runShortcutUrl`, `useActivity`, `BodyProfile` (Task 4); `formatEnergy`, `energyUnit` from `lib/stats`.
- Produces: `ActivityCard` props `{ day: HealthDay | undefined; eatenKcal: number; isToday: boolean; lastSync: ActivityResponse["lastSync"]; profile: BodyProfile | null; year: number; units: "kcal" | "kj"; locale: Locale; now?: number }`. `WeekStrip` and `MonthCalendar` get an optional `workoutDays?: Set<string>` prop.

- [ ] **Step 1: Add the strings**

In `web/src/locales/en.json`, add a top-level `"activity"` object (after `"diary"`):

```json
  "activity": {
    "title": "Activity",
    "burned": "Burned",
    "ate": "Ate",
    "deficit": "Deficit",
    "surplus": "Surplus",
    "soFar": "so far",
    "estimated": "estimated",
    "noWorkouts": "No workouts",
    "noData": "No Health data for this day.",
    "synced": "Synced {{when}}",
    "neverSynced": "Not synced yet",
    "sync": "Sync",
    "workoutLine": "{{time}} · {{minutes}} min",
    "workoutDay": "{{date}}, workout"
  },
```

In `web/src/locales/pt-PT.json`, the same keys:

```json
  "activity": {
    "title": "Atividade",
    "burned": "Gasto",
    "ate": "Comido",
    "deficit": "Défice",
    "surplus": "Excedente",
    "soFar": "até agora",
    "estimated": "estimado",
    "noWorkouts": "Sem treinos",
    "noData": "Sem dados do Saúde para este dia.",
    "synced": "Sincronizado {{when}}",
    "neverSynced": "Ainda não sincronizado",
    "sync": "Sincronizar",
    "workoutLine": "{{time}} · {{minutes}} min",
    "workoutDay": "{{date}}, treino"
  },
```

- [ ] **Step 2: Write the failing test**

Create `web/test/activityCard.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { enUS } from "date-fns/locale";
import "../src/i18n";
import i18n from "../src/i18n";
import type { HealthDay } from "@bites/shared";
import ActivityCard from "../src/features/diary/ActivityCard";

const body = { sex: "male", weightKg: 80, heightCm: 180, birthYear: 1996 } as const;
const NOW = Date.parse("2026-10-14T21:00:00Z");
const day: HealthDay = { restingKcal: 1700, activeKcal: 950, workouts: [{ type: "Running", start: "2026-10-14T07:10:00", minutes: 42, kcal: 410 }] };
const renderCard = (over: Partial<Parameters<typeof ActivityCard>[0]> = {}) =>
  render(<ActivityCard day={day} eatenKcal={2100} isToday={false} lastSync={{ syncedAt: NOW - 3_600_000, tz: "UTC" }} profile={body} year={2026} units="kcal" locale={enUS} now={NOW} {...over} />);

describe("ActivityCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("shows burned, eaten and the deficit with the day's workouts", () => {
    renderCard();
    expect(screen.getByText("2650")).toBeTruthy();
    expect(screen.getByText("2100")).toBeTruthy();
    expect(screen.getByText("550")).toBeTruthy();
    expect(screen.getByText("Deficit")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("07:10 · 42 min")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sync" })).toBeNull();
  });

  it("shows a surplus and the today / estimated labels", () => {
    renderCard({ day: { restingKcal: null, activeKcal: 100, workouts: [] }, eatenKcal: 3000, isToday: true });
    expect(screen.getByText("Surplus")).toBeTruthy();
    expect(screen.getByText(/so far/)).toBeTruthy();
    expect(screen.getByText(/estimated/)).toBeTruthy();
    expect(screen.getByText("No workouts")).toBeTruthy();
  });

  it("says when the day has no Health data", () => {
    renderCard({ day: undefined });
    expect(screen.getByText("No Health data for this day.")).toBeTruthy();
  });

  it("offers Sync when the last sync is over a day old", () => {
    renderCard({ lastSync: { syncedAt: NOW - 30 * 3_600_000, tz: "UTC" } });
    expect(screen.getByRole("link", { name: "Sync" }).getAttribute("href")).toBe("shortcuts://run-shortcut?name=Bites%20Health");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd web && npx vitest run test/activityCard.test.tsx`
Expected: FAIL, cannot resolve `ActivityCard`.

- [ ] **Step 4: Implement the card**

Create `web/src/features/diary/ActivityCard.tsx`:

```tsx
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { useTranslation } from "react-i18next";
import type { ActivityResponse, HealthDay } from "@bites/shared";
import { deficitFor, isStale, runShortcutUrl, type BodyProfile } from "../../lib/activity";
import { energyUnit, formatEnergy } from "../../lib/stats";

interface ActivityCardProps {
  day: HealthDay | undefined;
  eatenKcal: number;
  isToday: boolean;
  lastSync: ActivityResponse["lastSync"];
  profile: BodyProfile | null;
  year: number;
  units: "kcal" | "kj";
  locale: Locale;
  now?: number;
}

/** Shortcuts reports workout types in the phone's language, so match both. */
function workoutIcon(type: string): string {
  const t = type.toLowerCase();
  if (/run|corr/.test(t)) return "🏃";
  if (/walk|caminh|hik/.test(t)) return "🚶";
  if (/cycl|bike|cicl|bicic/.test(t)) return "🚴";
  if (/swim|nata/.test(t)) return "🏊";
  if (/strength|força|forca|weight|muscul/.test(t)) return "🏋️";
  if (/yoga|pilates/.test(t)) return "🧘";
  return "💪";
}

function Figure({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span className="text-caption">{label}</span>
      <span className={`text-title tabular ${tone ?? ""}`}>{value}</span>
      <span className="text-caption">{unit}</span>
    </div>
  );
}

export default function ActivityCard({ day, eatenKcal, isToday, lastSync, profile, year, units, locale, now = Date.now() }: ActivityCardProps) {
  const { t } = useTranslation();
  const unit = energyUnit(units);
  const d = deficitFor(day, eatenKcal, profile, year);
  const notes = [isToday ? t("activity.soFar") : null, d?.estimated ? t("activity.estimated") : null].filter(Boolean).join(" · ");

  return (
    <section className="mt-3 rounded-card bg-elevated p-5">
      <h2 className="text-headline">{t("activity.title")}</h2>
      {d ? (
        <>
          <div className="mt-3 flex gap-2">
            <Figure label={t("activity.burned")} value={formatEnergy(d.burned, units)} unit={unit} />
            <Figure label={t("activity.ate")} value={formatEnergy(d.eaten, units)} unit={unit} />
            {d.deficit >= 0 ? (
              <Figure label={t("activity.deficit")} value={formatEnergy(d.deficit, units)} unit={unit} tone="text-accent-text" />
            ) : (
              <Figure label={t("activity.surplus")} value={`+${formatEnergy(-d.deficit, units)}`} unit={unit} tone="text-over" />
            )}
          </div>
          {notes && <p className="mt-2 text-center text-caption">{notes}</p>}
          {day && day.workouts.length > 0 ? (
            <ul className="mt-4 divide-y divide-sep">
              {day.workouts.map((w, i) => (
                <li key={`${w.start}-${i}`} className="flex items-center gap-3 py-2">
                  <span aria-hidden="true" className="text-title">{workoutIcon(w.type)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{w.type}</span>
                    <span className="block text-subhead tabular text-fg-2">{t("activity.workoutLine", { time: format(new Date(w.start), "HH:mm"), minutes: w.minutes })}</span>
                  </span>
                  {w.kcal !== null && <span className="text-subhead tabular text-fg-2">{`${formatEnergy(w.kcal, units)} ${unit}`}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-body text-fg-2">{t("activity.noWorkouts")}</p>
          )}
        </>
      ) : (
        <p className="mt-3 text-body text-fg-2">{t("activity.noData")}</p>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-caption">{lastSync ? t("activity.synced", { when: format(lastSync.syncedAt, "d MMM, HH:mm", { locale }) }) : t("activity.neverSynced")}</span>
        {isStale(lastSync, now) && (
          <a href={runShortcutUrl()} className="text-subhead font-semibold text-accent-text active:opacity-60">
            {t("activity.sync")}
          </a>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run the card test**

Run: `cd web && npx vitest run test/activityCard.test.tsx`
Expected: 4 passed. (`formatEnergy` prints plain integers with no thousands separator.)

- [ ] **Step 6: Workout dots in the week strip and month calendar**

In `web/src/features/diary/WeekStrip.tsx`:
1. Add `workoutDays?: Set<string>;` to `WeekStripProps` and to the destructured parameters.
2. Replace the day button's `aria-label` with:
```tsx
              aria-label={workoutDays?.has(key) ? t("activity.workoutDay", { date: format(date, "EEEE, d MMMM", { locale }) }) : format(date, "EEEE, d MMMM", { locale })}
```
3. Directly after the closing `</MiniRing>` inside the button, add:
```tsx
              <span aria-hidden="true" className={`size-1 rounded-full ${workoutDays?.has(key) ? "bg-accent" : "bg-transparent"}`} />
```

In `web/src/features/diary/MonthCalendar.tsx`:
1. Add `workoutDays?: Set<string>;` to `MonthCalendarProps` and to the destructured parameters.
2. Replace the day button's `aria-label` with:
```tsx
              aria-label={workoutDays?.has(key) ? t("activity.workoutDay", { date: format(parseKey(key), "EEEE, d MMMM", { locale }) }) : format(parseKey(key), "EEEE, d MMMM", { locale })}
```
3. Change the button `className` to `"flex flex-col items-center gap-0.5 rounded-full active:opacity-60 disabled:opacity-35"` and add after `</MiniRing>`:
```tsx
              <span aria-hidden="true" className={`size-1 rounded-full ${workoutDays?.has(key) ? "bg-accent" : "bg-transparent"}`} />
```

- [ ] **Step 7: Wire the Diary**

In `web/src/features/diary/DiaryScreen.tsx`:
1. Imports:
```ts
import { useActivity } from "../../lib/activity";
import ActivityCard from "./ActivityCard";
```
2. After the `toKey` line:
```ts
  const activity = useActivity(fromKey, toKey, () => repo.getIdToken());
  const connected = activity?.lastSync != null;
  const workoutDays = useMemo(
    () => new Set(Object.entries(activity?.days ?? {}).filter(([, d]) => d.workouts.length > 0).map(([k]) => k)),
    [activity],
  );
```
3. Pass `workoutDays={workoutDays}` to both `<MonthCalendar … />` and `<WeekStrip … />`.
4. Directly after the `<DayCard … />` wrapper `div`, add:
```tsx
      {connected && (
        <ActivityCard
          day={activity?.days[selectedDay]}
          eatenKcal={days.get(selectedDay)?.kcal ?? 0}
          isToday={selectedDay === todayKey}
          lastSync={activity?.lastSync ?? null}
          profile={profile}
          year={Number(selectedDay.slice(0, 4))}
          units={units}
          locale={locale}
        />
      )}
```

- [ ] **Step 8: Run the web suite**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all passed (including `locales.test.ts`, which checks both locale files have the same keys), no type errors.

- [ ] **Step 9: Commit**

```bash
git add web/src/features/diary web/src/locales web/test/activityCard.test.tsx
git commit -m "feat(web): Activity card with deficit and workouts, workout dots"
```

---

### Task 6: Trends stats

**Files:**
- Modify: `web/src/features/diary/Trends.tsx`
- Modify: `web/src/features/diary/DiaryScreen.tsx`
- Modify: `web/src/locales/en.json`, `web/src/locales/pt-PT.json`
- Modify: `web/test/diary.test.tsx`

**Interfaces:**
- Consumes: `periodActivity`, `BodyProfile` (Task 4); `activity` and `connected` from Task 5's DiaryScreen wiring.
- Produces: `Trends` gets optional props `activity?: Record<string, HealthDay>` and `profile?: BodyProfile | null`; when `activity` is given it renders a second row of two stats.

- [ ] **Step 1: Add the strings**

In `en.json` under `diary.trends` add: `"avgDeficit": "Avg deficit", "workouts": "Workouts", "perDay": "{{unit}} / day"`.
In `pt-PT.json` under `diary.trends` add: `"avgDeficit": "Défice médio", "workouts": "Treinos", "perDay": "{{unit}} / dia"`.

- [ ] **Step 2: Write the failing test**

Add to `web/test/diary.test.tsx` inside `describe("DiaryScreen", …)`:

```tsx
  it("shows the average deficit and workouts in Trends once Health is connected", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "iPhone", onLine: true });
    const today = dayKey(new Date());
    const yesterday = dayKey(at(1, 12));
    const activity = {
      days: {
        [today]: { restingKcal: 1700, activeKcal: 800, workouts: [{ type: "Running", start: new Date().toISOString(), minutes: 30, kcal: 300 }] },
        [yesterday]: { restingKcal: 1700, activeKcal: 300, workouts: [] }, // no meals logged: left out of the average
      },
      lastSync: { syncedAt: Date.now(), tz: "UTC" },
      hasKey: true,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(activity), { status: 200 })));
    await repo.addMeal(mk("Lunch", at(0, 12), 2000));
    render(<DiaryScreen />);
    expect(await screen.findByText("Avg deficit")).toBeTruthy();
    const stat = screen.getByText("Avg deficit").parentElement!;
    expect(within(stat).getByText("500")).toBeTruthy();
    const workouts = screen.getByText("Workouts").parentElement!;
    expect(within(workouts).getByText("1")).toBeTruthy();
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd web && npx vitest run test/diary.test.tsx`
Expected: FAIL, "Avg deficit" not found.

- [ ] **Step 4: Implement**

In `web/src/features/diary/Trends.tsx`:
1. Imports: add `HealthDay` to the `@bites/shared` type import, and `import { periodActivity, type BodyProfile } from "../../lib/activity";`.
2. Props: add `activity?: Record<string, HealthDay>;` and `profile?: BodyProfile | null;` to `TrendsProps` and the destructured parameters.
3. After `const hasData = …`:
```ts
  const health = useMemo(() => (activity ? periodActivity(activity, inRange, from, to, profile ?? null) : null), [activity, inRange, from, to, profile]);
```
4. After the existing stats row `</div>`, add:
```tsx
      {health && (
        <div className="mt-2 flex gap-2">
          <Stat
            title={t("diary.trends.avgDeficit")}
            value={health.avgDeficit === null ? "–" : health.avgDeficit < 0 ? `+${formatEnergy(-health.avgDeficit, units)}` : formatEnergy(health.avgDeficit, units)}
            caption={t("diary.trends.perDay", { unit })}
          />
          <Stat title={t("diary.trends.workouts")} value={String(health.workouts)} />
        </div>
      )}
```

In `web/src/features/diary/DiaryScreen.tsx`, change the `<Trends … />` element to pass `activity={connected ? activity?.days : undefined} profile={profile}`.

- [ ] **Step 5: Run the web suite**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all passed, no type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/diary web/src/locales web/test/diary.test.tsx
git commit -m "feat(web): average deficit and workouts in Trends"
```

---

### Task 7: Settings — Apple Health section, guide, delete-all

**Files:**
- Create: `web/src/features/settings/HealthSection.tsx`
- Create: `web/src/features/settings/HealthGuide.tsx`
- Modify: `web/src/features/settings/SettingsSheet.tsx`
- Modify: `web/src/locales/en.json`, `web/src/locales/pt-PT.json`
- Create: `web/test/healthSection.test.tsx`
- Modify: `web/test/settings.test.tsx`

**Interfaces:**
- Consumes: `createKey`, `deleteKey`, `deleteAllActivity`, `fetchActivity`, `healthAvailable`, `shortcutUrl`, `runShortcutUrl` (Task 4); `Sheet`, `PillButton`, `toast`; `useStore` (`repo.getIdToken()`); `dayKey` from `@bites/shared`.
- Produces: `HealthSection` (no props; renders its own titled group, styled like SettingsSheet's `Group`) and `HealthGuide` props `{ open: boolean; onClose: () => void }`.

- [ ] **Step 1: Add the strings**

In `en.json` under `settings` add:

```json
    "health": {
      "title": "Apple Health",
      "intro": "See your workouts and real calorie deficit, using what Apple Health measures.",
      "iphoneOnly": "Apple Health is only available on iPhone for now.",
      "connect": "Connect Apple Health",
      "copied": "Key copied ✓ Paste it when the Shortcut asks.",
      "copyFailed": "Copy this key, then paste it when the Shortcut asks:",
      "copy": "Copy",
      "addShortcut": "Add the Shortcut",
      "finish": "Then tap Sync now and allow access to Health.",
      "syncNow": "Sync now",
      "showKey": "Show my key again",
      "lastSync": "Last synced {{when}}",
      "nightly": "Set up nightly sync",
      "disconnect": "Disconnect",
      "disconnected": "Apple Health disconnected",
      "guideTitle": "Sync every night",
      "guide1": "Open the Shortcuts app and tap Automation.",
      "guide2": "Tap + and choose Time of Day.",
      "guide3": "Pick 23:00, Daily, and Run Immediately.",
      "guide4": "Tap Next and choose Bites Health. Done.",
      "guideTip": "Tip: add a second automation with \"When a workout ends\", if your iPhone offers it, so workouts show up straight away.",
      "done": "Done"
    },
```

In `pt-PT.json` under `settings` add:

```json
    "health": {
      "title": "Saúde da Apple",
      "intro": "Vê os teus treinos e o teu défice calórico real, com o que a app Saúde mede.",
      "iphoneOnly": "A app Saúde só está disponível no iPhone, por agora.",
      "connect": "Ligar à app Saúde",
      "copied": "Chave copiada ✓ Cola-a quando o Atalho pedir.",
      "copyFailed": "Copia esta chave e cola-a quando o Atalho pedir:",
      "copy": "Copiar",
      "addShortcut": "Adicionar o Atalho",
      "finish": "Depois toca em Sincronizar agora e permite o acesso à Saúde.",
      "syncNow": "Sincronizar agora",
      "showKey": "Mostrar a chave outra vez",
      "lastSync": "Última sincronização {{when}}",
      "nightly": "Sincronizar todas as noites",
      "disconnect": "Desligar",
      "disconnected": "App Saúde desligada",
      "guideTitle": "Sincronizar todas as noites",
      "guide1": "Abre a app Atalhos e toca em Automatização.",
      "guide2": "Toca em + e escolhe Hora do dia.",
      "guide3": "Escolhe 23:00, Diariamente e Executar imediatamente.",
      "guide4": "Toca em Seguinte e escolhe Bites Health. Pronto.",
      "guideTip": "Dica: se o teu iPhone tiver a opção \"Quando um treino termina\", adiciona uma segunda automatização para os treinos aparecerem logo.",
      "done": "Concluído"
    },
```

- [ ] **Step 2: Write the failing tests**

Create `web/test/healthSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import HealthSection from "../src/features/settings/HealthSection";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

let n = 0;
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ios = () => vi.stubGlobal("navigator", { ...navigator, userAgent: "iPhone", onLine: true, clipboard: undefined });

describe("HealthSection", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ repo: new LocalRepo(`bites-health-${++n}`) });
    vi.stubEnv("VITE_HEALTH_SHORTCUT_URL", "https://www.icloud.com/shortcuts/abc");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("says it is iPhone-only elsewhere", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "Android" });
    render(<HealthSection />);
    expect(screen.getByText("Apple Health is only available on iPhone for now.")).toBeTruthy();
  });

  it("connects: copies the key from the tap and shows the Shortcut link", async () => {
    ios();
    const write = vi.fn(async (items: { getType: (t: string) => Promise<Blob> }[]) => {
      expect(await (await items[0].getType("text/plain")).text()).toBe("KEY123");
    });
    vi.stubGlobal("navigator", { ...navigator, userAgent: "iPhone", onLine: true, clipboard: { write } });
    vi.stubGlobal("ClipboardItem", class { constructor(private data: Record<string, Promise<Blob>>) {} getType(t: string) { return this.data[t]; } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/key") ? answer({ key: "KEY123" }) : answer({ days: {}, lastSync: null, hasKey: false }))));
    render(<HealthSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Apple Health" }));
    expect(write).toHaveBeenCalledTimes(1); // started synchronously inside the tap
    expect(await screen.findByText("Key copied ✓ Paste it when the Shortcut asks.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add the Shortcut" }).getAttribute("href")).toBe("https://www.icloud.com/shortcuts/abc");
    expect(screen.getByRole("link", { name: "Sync now" }).getAttribute("href")).toBe("shortcuts://run-shortcut?name=Bites%20Health");
  });

  it("shows the key on screen when the clipboard is unavailable", async () => {
    ios();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/key") ? answer({ key: "KEY123" }) : answer({ days: {}, lastSync: null, hasKey: false }))));
    render(<HealthSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Apple Health" }));
    expect(await screen.findByText("KEY123")).toBeTruthy();
    expect(screen.getByText("Copy this key, then paste it when the Shortcut asks:")).toBeTruthy();
  });

  it("shows the connected state and disconnects", async () => {
    ios();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? answer({ ok: true }) : answer({ days: {}, lastSync: { syncedAt: Date.now(), tz: "UTC" }, hasKey: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<HealthSection />);
    expect(await screen.findByText(/Last synced/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Apple Health" })).toBeTruthy());
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/api/activity/key") && (i as RequestInit).method === "DELETE")).toBe(true);
  });

  it("hides Connect until the Shortcut link is configured", async () => {
    ios();
    vi.stubEnv("VITE_HEALTH_SHORTCUT_URL", "");
    vi.stubGlobal("fetch", vi.fn(async () => answer({ days: {}, lastSync: null, hasKey: false })));
    render(<HealthSection />);
    expect(await screen.findByText(/See your workouts/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Apple Health" })).toBeNull();
  });
});
```

Add to `web/test/settings.test.tsx` inside the `describe`:

```tsx
  it("also deletes Apple Health data when deleting all data", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Delete all data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/api/activity") && (i as RequestInit).method === "DELETE")).toBe(true));
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd web && npx vitest run test/healthSection.test.tsx test/settings.test.tsx`
Expected: FAIL, `HealthSection` not found; the delete-all test fails.

- [ ] **Step 4: Implement the guide**

Create `web/src/features/settings/HealthGuide.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import PillButton from "../../components/PillButton";
import Sheet from "../../components/Sheet";

export default function HealthGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 pt-2">
        <h2 className="text-title">{t("settings.health.guideTitle")}</h2>
        <ol className="mt-4 space-y-3">
          {(["guide1", "guide2", "guide3", "guide4"] as const).map((k, i) => (
            <li key={k} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-subhead font-semibold text-bg">{i + 1}</span>
              <span className="pt-0.5 text-body">{t(`settings.health.${k}`)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-subhead text-fg-2">{t("settings.health.guideTip")}</p>
        <PillButton className="mt-6 w-full" onClick={onClose}>
          {t("settings.health.done")}
        </PillButton>
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 5: Implement the section**

Create `web/src/features/settings/HealthSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { dayKey } from "@bites/shared";
import { toast } from "../../components/Toast";
import { createKey, deleteKey, fetchActivity, healthAvailable, runShortcutUrl, shortcutUrl } from "../../lib/activity";
import { useStore } from "../../store";
import HealthGuide from "./HealthGuide";

type Copy = { state: "idle" } | { state: "copied" } | { state: "manual"; key: string };

const rowClass = "flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2 text-left";
const linkClass = `${rowClass} text-body font-semibold text-accent-text active:opacity-60`;

/** Starts the clipboard write inside the tap: iOS refuses writes that begin after an await. */
function copyPending(key: Promise<string | null>): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return Promise.resolve(false);
    const blob = key.then((k) => {
      if (!k) throw new Error("no key");
      return new Blob([k], { type: "text/plain" });
    });
    return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export default function HealthSection() {
  const { t } = useTranslation();
  const repo = useStore((s) => s.repo);
  const [status, setStatus] = useState<{ hasKey: boolean; syncedAt: number | null } | null>(null);
  const [copy, setCopy] = useState<Copy>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const available = healthAvailable();
  const link = shortcutUrl();

  useEffect(() => {
    if (!available) return;
    let live = true;
    const today = dayKey(new Date());
    void repo
      .getIdToken()
      .catch(() => null)
      .then((token) => fetchActivity(today, today, token))
      .then((r) => live && r && setStatus({ hasKey: r.hasKey, syncedAt: r.lastSync?.syncedAt ?? null }));
    return () => {
      live = false;
    };
  }, [available, repo]);

  const connect = () => {
    setBusy(true);
    const key = repo
      .getIdToken()
      .catch(() => null)
      .then((token) => createKey(token));
    const copied = copyPending(key);
    void Promise.all([key, copied]).then(([k, ok]) => {
      setBusy(false);
      if (!k) {
        toast(t("errors.generic"));
        return;
      }
      setStatus((s) => ({ hasKey: true, syncedAt: s?.syncedAt ?? null }));
      setCopy(ok ? { state: "copied" } : { state: "manual", key: k });
    });
  };

  const disconnect = async () => {
    setBusy(true);
    const ok = await deleteKey(await repo.getIdToken().catch(() => null));
    setBusy(false);
    if (!ok) {
      toast(t("errors.generic"));
      return;
    }
    setStatus({ hasKey: false, syncedAt: null });
    setCopy({ state: "idle" });
    toast(t("settings.health.disconnected"));
  };

  const connected = status?.hasKey && status.syncedAt !== null;
  const pending = status?.hasKey && !connected;

  return (
    <section className="mt-7">
      <h3 className="px-1 pb-2 text-caption uppercase tracking-wide">{t("settings.health.title")}</h3>
      <div className="divide-y divide-sep overflow-hidden rounded-card bg-elevated">
        {!available ? (
          <p className="px-4 py-3 text-subhead text-fg-2">{t("settings.health.iphoneOnly")}</p>
        ) : (
          <>
            {!connected && <p className="px-4 py-3 text-subhead text-fg-2">{t("settings.health.intro")}</p>}
            {connected && (
              <p className="px-4 py-3 text-subhead">{t("settings.health.lastSync", { when: format(status!.syncedAt!, "d MMM, HH:mm") })}</p>
            )}
            {copy.state === "copied" && <p className="px-4 py-3 text-subhead">{t("settings.health.copied")}</p>}
            {copy.state === "manual" && (
              <div className="px-4 py-3">
                <p className="text-subhead">{t("settings.health.copyFailed")}</p>
                <p className="mt-2 select-all break-all rounded-xl bg-bg px-3 py-2 font-mono text-subhead">{copy.key}</p>
              </div>
            )}
            {copy.state !== "idle" && link && (
              <a href={link} target="_blank" rel="noreferrer" className={linkClass}>
                {t("settings.health.addShortcut")}
              </a>
            )}
            {(pending || copy.state !== "idle") && !connected && <p className="px-4 py-3 text-subhead text-fg-2">{t("settings.health.finish")}</p>}
            {(pending || connected || copy.state !== "idle") && (
              <a href={runShortcutUrl()} className={linkClass}>
                {t("settings.health.syncNow")}
              </a>
            )}
            {!status?.hasKey && copy.state === "idle" && link && (
              <button type="button" disabled={busy} className={`${linkClass} disabled:opacity-50`} onClick={connect}>
                {t("settings.health.connect")}
              </button>
            )}
            {pending && copy.state === "idle" && link && (
              <button type="button" disabled={busy} className={`${linkClass} disabled:opacity-50`} onClick={connect}>
                {t("settings.health.showKey")}
              </button>
            )}
            {connected && (
              <button type="button" className={linkClass} onClick={() => setGuideOpen(true)}>
                {t("settings.health.nightly")}
              </button>
            )}
            {status?.hasKey && (
              <button type="button" disabled={busy} className={`${rowClass} text-body text-danger active:opacity-60 disabled:opacity-50`} onClick={() => void disconnect()}>
                {t("settings.health.disconnect")}
              </button>
            )}
          </>
        )}
      </div>
      <HealthGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  );
}
```

Note on the "connected and disconnect" test: after Disconnect, `status.hasKey` is false and `copy` is idle, so Connect shows again (the test stubs `VITE_HEALTH_SHORTCUT_URL`).

- [ ] **Step 6: Wire into Settings**

In `web/src/features/settings/SettingsSheet.tsx`:
1. Imports:
```ts
import { deleteAllActivity } from "../../lib/activity";
import HealthSection from "./HealthSection";
```
2. Render `<HealthSection />` directly before the `{repo.kind !== "local" && (` account group.
3. In `deleteAll`, right after `await repo.clearAll();` inside the `try`, add:
```ts
      // Best effort: the Health data lives on the server and must not block local deletion.
      void repo.getIdToken().catch(() => null).then((token) => deleteAllActivity(token));
```

- [ ] **Step 7: Run the web suite**

Run: `cd web && npx vitest run && npx tsc --noEmit`
Expected: all passed, no type errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/settings web/src/locales web/test/healthSection.test.tsx web/test/settings.test.tsx
git commit -m "feat(web): Apple Health setup in Settings, nightly sync guide"
```

---

### Task 8: Shortcut recipe and docs

**Files:**
- Create: `docs/apple-health-shortcut.md`
- Modify: `README.md` (one short section)

**Interfaces:**
- Consumes: the sync API contract from Task 2 (`POST https://bites-api.wellbites.workers.dev/api/activity/sync`, `Authorization: Bearer <key>`, body `{ tz, days: [{ day, restingKcal, activeKcal, workouts: [{ type, start, minutes, kcal }] }] }`, error body `{ error, message }`).

- [ ] **Step 1: Write the recipe**

Create `docs/apple-health-shortcut.md`:

````markdown
# Building the "Bites Health" Shortcut

Built once by the owner on an iPhone, then shared as an iCloud link. Everyone else only adds it.

The Shortcut must be named exactly **Bites Health** (the app opens `shortcuts://run-shortcut?name=Bites%20Health`).

## Actions, in order

1. **Text** — leave empty. Rename the variable to `Key` (Set Variable `Key` to Text).
2. **Text** — empty. Set Variable `Days` (it will collect one dictionary per day; use **Add to Variable** below).
3. **Repeat** 7 times. Inside:
   1. **Calculate** `Repeat Index − 1` → `Back`.
   2. **Adjust Date**: Current Date, Subtract `Back` days → **Adjust Date**: Get Start of Day → Set Variable `DayStart`.
   3. **Adjust Date**: `DayStart`, Add 1 day → Set Variable `DayEnd`.
   4. **Format Date** `DayStart`, Custom `yyyy-MM-dd` → Set Variable `DayKey`.
   5. **Find Health Samples** where Type is **Active Energy**, Start Date is between `DayStart` and `DayEnd`, unit kcal → **Calculate Statistics**: Sum → Set Variable `Active`.
   6. Same with Type **Resting Energy** → Set Variable `Resting`.
   7. **Find Health Samples** where Type is **Workouts**, Start Date is between `DayStart` and `DayEnd`. **Repeat with Each**:
      - **Get Details of Health Sample**: Type → `WType`; Start Date → **Format Date** ISO 8601 → `WStart`; Duration → in minutes → `WMin`; Value (energy, kcal) → `WKcal`.
      - **Dictionary** `{ type: WType, start: WStart, minutes: WMin, kcal: WKcal }` → **Add to Variable** `Workouts`.
   8. **Dictionary** `{ day: DayKey, restingKcal: Resting, activeKcal: Active, workouts: Workouts }` (set `workouts` as an Array value from the variable) → **Add to Variable** `Days`.
   9. **Nothing** / clear `Workouts` for the next day (Set Variable `Workouts` to an empty Text).
4. **Dictionary** `{ days: Days }` → **Get Contents of URL**:
   - URL `https://bites-api.wellbites.workers.dev/api/activity/sync`
   - Method **POST**, Request Body **JSON** (the dictionary above)
   - Header `Authorization` = `Bearer ` + `Key`
5. **Get Dictionary Value** `message` from the result → **If** it has any value → **Show Notification** "Bites: " + message. **Otherwise** → **Show Notification** "Bites: synced ✓".

If **Workouts** is not offered as a Health sample type on your iOS version, skip step 3.7 and send `workouts` as an empty list. The app hides the workout list in that case.

## Sharing it

1. Shortcut settings (ⓘ) → **Privacy**: allow it to run without asking for the API domain.
2. Shortcut settings → **Setup** / **Import Questions** → add a question for the first Text action: "Paste your Bites key".
3. Share → **Copy iCloud Link**. Give the link to the developer: it becomes `VITE_HEALTH_SHORTCUT_URL` in the web build.

## Checking it

- Run it once from the Shortcuts app; iOS asks for Health access to Active Energy, Resting Energy and Workouts. Allow all.
- The notification should say "Bites: synced ✓". In Bites, the Diary shows the Activity card.
- Compare a past day's Burned number with the Health app (Activity → Active + Resting energy).
````

- [ ] **Step 2: Add a README pointer**

Append to `README.md`:

```markdown
## Apple Health

An Apple Shortcut ("Bites Health") sends the last 7 days of Health energy and workouts to `POST /api/activity/sync` with a personal key from Settings. How to build and share it: [docs/apple-health-shortcut.md](docs/apple-health-shortcut.md). The web build reads the shared iCloud link from `VITE_HEALTH_SHORTCUT_URL`; while it is empty, the Connect button is hidden.
```

- [ ] **Step 3: Commit**

```bash
git add docs/apple-health-shortcut.md README.md
git commit -m "docs: how to build and share the Bites Health Shortcut"
```

---

### Task 9: Full check and deploy (needs the user's OK at each deploy)

**Files:** none changed, except the memory file at the end.

- [ ] **Step 1: Full test and type check**

Run: `npm test && npm run typecheck` (repository root)
Expected: every workspace passes.

- [ ] **Step 2: Ask the user, then deploy the worker**

Ask: "Ready to deploy the API worker (adds /api/activity, nothing visible changes). OK?" Only after a yes:

Run: `cd worker && npx wrangler deploy`
Then check: `curl -s -X POST https://bites-api.wellbites.workers.dev/api/activity/sync -H "authorization: Bearer nope" -d "{}"`
Expected: `{"error":"invalid_key","message":"Bites key not recognised. Reconnect Apple Health in Bites Settings."}` and `GET /api/health` still `{"ok":true}`.

- [ ] **Step 3: Owner builds the Shortcut**

The owner needs a key to test the Shortcut before the public Connect button exists. Do not deploy a placeholder link (everyone would see a broken button). Instead, make a local preview build with a placeholder link and open it on the iPhone over the LAN:

```bash
cd web && VITE_API_URL=https://bites-api.wellbites.workers.dev VITE_HEALTH_SHORTCUT_URL=https://www.icloud.com/shortcuts/placeholder npx vite build --outDir dist-preview && npx vite preview --outDir dist-preview --host
```

The owner signs in, taps Connect to get a key (ignore the placeholder Add link), builds the Shortcut from `docs/apple-health-shortcut.md` with that key, checks a sync works, and shares the iCloud link. Stop the preview and delete `web/dist-preview` afterwards. Wait for the user to send the link.

- [ ] **Step 4: Ask the user, then deploy the web app with the link**

Ask: "Deploy the web app with the Shortcut link <link>? OK?" Only after a yes:

Run: `cd web && VITE_API_URL=https://bites-api.wellbites.workers.dev VITE_HEALTH_SHORTCUT_URL=<link> npm run build && npx wrangler deploy`
Verify after about a minute that the live bundle contains the link: fetch `https://bites.wellbites.workers.dev/`, find the `assets/index-*.js` name, and check the file contains `icloud.com/shortcuts`.

- [ ] **Step 5: Push and remember the new build variable**

Push to `main` only if the user said so. Update `C:\Users\Renato Cruz\.claude\projects\C--Users-Renato-Cruz-WebBox\memory\project_bites.md`: the web deploy command now also needs `VITE_HEALTH_SHORTCUT_URL=<link>`, or the Connect button disappears.
