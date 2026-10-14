# Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meal reminders (sent only when that meal is not logged yet) and an evening daily summary, delivered as web push notifications to the installed Bites PWA.

**Architecture:** The web app subscribes to push and reports a minimal daily status (logged meal types and today's kcal) to the Cloudflare Worker. A 15-minute cron in the worker decides which reminders are due in each person's time zone, skips logged meals and already-sent reminders, and sends Web Push with VAPID. A small script imported into the generated Workbox service worker shows notifications and opens the right tab on tap.

**Tech Stack:** TypeScript, React 19 + Vite + vite-plugin-pwa (Workbox `generateSW`), Zustand, i18next, Cloudflare Workers + KV + Cron Triggers, `web-push-neo` (Web Crypto Web Push), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-14-reminders-design.md`

## Global Constraints

- Reminder kinds: `breakfast`, `lunch`, `dinner`, `summary`. Defaults: breakfast 09:00, lunch 13:00, dinner 20:30, summary 21:30.
- Times are `HH:MM`, minutes in {00, 15, 30, 45}; the client rounds to the nearest quarter before saving.
- Onboarding step only when the app runs from the home screen and the browser supports `Notification`, `serviceWorker` and `PushManager`.
- Max 3 devices per person; the newest is kept.
- KV keys: `push:<uid>` (no TTL), `day:<uid>:<YYYY-MM-DD>` (48 h), `sent:<uid>:<YYYY-MM-DD>:<kind>` (48 h).
- A reminder is due from its local time until 60 minutes later; after that it is skipped.
- Snacks never cancel a meal reminder.
- Push payload: `{ title, body, tab: "scan" | "diary", tag }`; push TTL 3600 s; 404/410 removes the device.
- All user-facing strings in `en` and `pt-PT`.
- Worker routes are Firebase-authenticated with the existing `verifyRequest`.
- `VAPID_PRIVATE_KEY` is a Cloudflare secret and never printed or committed.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Onboarding runs before sign-in.** In Firebase mode the Google sign-in happens at the end of onboarding, so the reminders step has no token. Expected: the subscription and chosen times are stored locally and sent once a profile exists (Task 6 `flushPendingReminders`, test in Task 6 and Task 8).
2. **Browser CORS blocks PUT and DELETE.** The worker's CORS only allows `GET, POST, OPTIONS`. Expected: the new routes work from the site (Task 3 router test asserts the allow-methods header).
3. **Day boundaries and DST.** A 23:45 summary checked at 00:10 the next day, and a reminder on the DST change day. Expected: due exactly once, on the right local date (Task 2 tests).
4. **Signing out or deleting all data.** Expected: this device stops receiving reminders and the server's daily records are removed, so the next person using the phone gets nothing from the previous account (Task 7 tests).
5. **Push service hiccups.** A transient 5xx, or one person's device throwing. Expected: retried on the next run within the hour, and other people still receive theirs (Task 4 tests).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/src/reminders.ts` (create) | Reminder types, defaults, time validation and rounding, shared by worker and web |
| `shared/src/index.ts` (modify) | Re-export reminders |
| `worker/src/reminders/schedule.ts` (create) | Pure time-zone math: local date/time, zoned→UTC, which reminders are due |
| `worker/src/reminders/messages.ts` (create) | Notification text per kind, locale and units |
| `worker/src/reminders/store.ts` (create) | KV read/write for settings, daily status and sent marks |
| `worker/src/reminders/routes.ts` (create) | `GET/PUT/DELETE /api/reminders`, `PUT/DELETE /api/day` |
| `worker/src/reminders/send.ts` (create) | Web Push wrapper returning `ok` / `gone` / `retry` |
| `worker/src/reminders/run.ts` (create) | Cron job: iterate people, send due reminders |
| `worker/src/index.ts`, `env.ts`, `wrangler.toml`, `package.json` (modify) | Routes, CORS methods, `scheduled()`, cron trigger, VAPID vars, dependency |
| `web/public/push-sw.js` (create) | Service worker push and notification-click handlers |
| `web/vite.config.ts` (modify) | `workbox.importScripts: ["push-sw.js"]` |
| `web/src/lib/api.ts` (modify) | Export `authedJson` for reuse |
| `web/src/lib/reminders.ts` (create) | Support checks, subscribe/unsubscribe, settings API, pending flush, day sync |
| `web/src/components/Switch.tsx` (create) | Accessible switch control |
| `web/src/features/onboarding/RemindersScreen.tsx` (create) | Onboarding step |
| `web/src/features/onboarding/Onboarding.tsx` (modify) | Insert the `reminders` stage after `camera` |
| `web/src/features/settings/RemindersGroup.tsx` (create) | Settings section |
| `web/src/features/settings/SettingsSheet.tsx` (modify) | Render the group; clean up on delete-all and sign-out |
| `web/src/App.tsx` (modify) | `?tab=` handling, pending flush, time-zone refresh, debounced day sync |
| `web/src/locales/en.json`, `pt-PT.json` (modify) | Strings |

---

### Task 1: Shared reminder model

**Files:**
- Create: `shared/src/reminders.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/reminders.test.ts`

**Interfaces:**
- Produces: `type ReminderKind = "breakfast" | "lunch" | "dinner" | "summary"`, `REMINDER_KINDS: ReminderKind[]`, `type ReminderTimes = Record<ReminderKind, { on: boolean; time: string }>`, `DEFAULT_REMINDERS: ReminderTimes`, `interface PushDevice { endpoint: string; keys: { p256dh: string; auth: string }; addedAt: number }`, `interface ReminderSettings { tz: string; locale: "pt-PT" | "en"; reminders: ReminderTimes; devices: PushDevice[]; updatedAt: number }`, `interface DayStatus { logged: MealType[]; kcal: number; target: number; units: "kcal" | "kj"; updatedAt: number }`, `isValidTime(t: string): boolean`, `roundToQuarter(t: string): string`, `isValidReminderTimes(x: unknown): x is ReminderTimes`.

- [ ] **Step 1: Write the failing test** — `shared/test/reminders.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_REMINDERS, REMINDER_KINDS, isValidReminderTimes, isValidTime, roundToQuarter } from "../src";

describe("reminder model", () => {
  it("has the four kinds with the agreed defaults", () => {
    expect(REMINDER_KINDS).toEqual(["breakfast", "lunch", "dinner", "summary"]);
    expect(DEFAULT_REMINDERS).toEqual({
      breakfast: { on: true, time: "09:00" },
      lunch: { on: true, time: "13:00" },
      dinner: { on: true, time: "20:30" },
      summary: { on: true, time: "21:30" },
    });
  });
  it("accepts only quarter-hour HH:MM", () => {
    for (const ok of ["00:00", "09:15", "13:30", "23:45"]) expect(isValidTime(ok)).toBe(true);
    for (const bad of ["9:00", "24:00", "12:10", "12:60", "ab:cd", "", "12:00:00"]) expect(isValidTime(bad)).toBe(false);
  });
  it("rounds to the nearest quarter, wrapping past midnight", () => {
    expect(roundToQuarter("09:07")).toBe("09:00");
    expect(roundToQuarter("09:08")).toBe("09:15");
    expect(roundToQuarter("13:52")).toBe("13:45");
    expect(roundToQuarter("23:53")).toBe("00:00");
    expect(roundToQuarter("garbage")).toBe("09:00");
  });
  it("validates a full reminders object", () => {
    expect(isValidReminderTimes(DEFAULT_REMINDERS)).toBe(true);
    expect(isValidReminderTimes({ ...DEFAULT_REMINDERS, lunch: { on: true, time: "13:10" } })).toBe(false);
    expect(isValidReminderTimes({ ...DEFAULT_REMINDERS, lunch: { on: "yes", time: "13:00" } })).toBe(false);
    const { summary: _s, ...missing } = DEFAULT_REMINDERS;
    expect(isValidReminderTimes(missing)).toBe(false);
    expect(isValidReminderTimes(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w shared -- reminders`
Expected: FAIL, `DEFAULT_REMINDERS` is not exported.

- [ ] **Step 3: Write the implementation** — `shared/src/reminders.ts`

```ts
import type { MealType } from "./types";

export type ReminderKind = "breakfast" | "lunch" | "dinner" | "summary";
export const REMINDER_KINDS: ReminderKind[] = ["breakfast", "lunch", "dinner", "summary"];
export type ReminderTimes = Record<ReminderKind, { on: boolean; time: string }>;

export const DEFAULT_REMINDERS: ReminderTimes = {
  breakfast: { on: true, time: "09:00" },
  lunch: { on: true, time: "13:00" },
  dinner: { on: true, time: "20:30" },
  summary: { on: true, time: "21:30" },
};

export interface PushDevice { endpoint: string; keys: { p256dh: string; auth: string }; addedAt: number }
export interface ReminderSettings { tz: string; locale: "pt-PT" | "en"; reminders: ReminderTimes; devices: PushDevice[]; updatedAt: number }
export interface DayStatus { logged: MealType[]; kcal: number; target: number; units: "kcal" | "kj"; updatedAt: number }

const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;
export const isValidTime = (t: string) => TIME.test(t);

/** Nearest quarter hour, so a native time picker that ignores `step` still produces a valid value. */
export function roundToQuarter(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return "09:00";
  const total = (Math.round((Number(m[1]) * 60 + Number(m[2])) / 15) * 15) % (24 * 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(total / 60))}:${p(total % 60)}`;
}

export function isValidReminderTimes(x: unknown): x is ReminderTimes {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return REMINDER_KINDS.every((k) => {
    const r = o[k] as { on?: unknown; time?: unknown } | undefined;
    return !!r && typeof r.on === "boolean" && typeof r.time === "string" && isValidTime(r.time);
  });
}
```

Modify `shared/src/index.ts` to:

```ts
export * from "./types"; export * from "./nutrition"; export * from "./reminders";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w shared` then `npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add shared/src/reminders.ts shared/src/index.ts shared/test/reminders.test.ts
git commit -m "feat(shared): reminder model, defaults and time validation"
```

---

### Task 2: Worker schedule math and messages

**Files:**
- Create: `worker/src/reminders/schedule.ts`, `worker/src/reminders/messages.ts`
- Test: `worker/test/reminders-schedule.test.ts`

**Interfaces:**
- Consumes: `ReminderKind`, `ReminderSettings`, `DayStatus` (Task 1).
- Produces:
  - `localDate(at: Date, tz: string): string` → `"YYYY-MM-DD"`.
  - `zonedToUtc(date: string, time: string, tz: string): Date`.
  - `isValidTimeZone(tz: string): boolean`.
  - `interface DueReminder { kind: ReminderKind; date: string }`.
  - `dueReminders(settings: Pick<ReminderSettings, "tz" | "reminders">, now: Date, windowMinutes?: number): DueReminder[]` (default window 60).
  - `buildMessage(kind: ReminderKind, locale: "pt-PT" | "en", day: DayStatus | null): { title: string; body: string; tab: "scan" | "diary" }`.

- [ ] **Step 1: Write the failing tests** — `worker/test/reminders-schedule.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_REMINDERS, type ReminderTimes } from "@bites/shared";
import { dueReminders, isValidTimeZone, localDate, zonedToUtc } from "../src/reminders/schedule";
import { buildMessage } from "../src/reminders/messages";

const only = (kind: keyof ReminderTimes, time: string): ReminderTimes => ({
  breakfast: { on: false, time: "09:00" }, lunch: { on: false, time: "13:00" }, dinner: { on: false, time: "20:30" }, summary: { on: false, time: "21:30" },
  [kind]: { on: true, time },
});

describe("time zones", () => {
  it("gives the local calendar date", () => {
    expect(localDate(new Date("2026-10-14T23:30:00Z"), "Europe/Lisbon")).toBe("2026-10-15");
    expect(localDate(new Date("2026-10-14T23:30:00Z"), "America/New_York")).toBe("2026-10-14");
  });
  it("converts a local wall time to UTC, including across DST", () => {
    expect(zonedToUtc("2026-07-01", "13:00", "Europe/Lisbon").toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "13:00", "Europe/Lisbon").toISOString()).toBe("2026-12-01T13:00:00.000Z");
    expect(zonedToUtc("2026-10-25", "13:00", "Europe/Lisbon").toISOString()).toBe("2026-10-25T13:00:00.000Z");
  });
  it("validates time zone names", () => {
    expect(isValidTimeZone("Europe/Lisbon")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});

describe("dueReminders", () => {
  const lisbon = (reminders: ReminderTimes) => ({ tz: "Europe/Lisbon", reminders });

  it("is due from its time until an hour later, and not before", () => {
    const s = lisbon(only("lunch", "13:00"));
    expect(dueReminders(s, new Date("2026-12-01T12:59:00Z"))).toEqual([]);
    expect(dueReminders(s, new Date("2026-12-01T13:00:00Z"))).toEqual([{ kind: "lunch", date: "2026-12-01" }]);
    expect(dueReminders(s, new Date("2026-12-01T13:59:00Z"))).toEqual([{ kind: "lunch", date: "2026-12-01" }]);
    expect(dueReminders(s, new Date("2026-12-01T14:00:00Z"))).toEqual([]);
  });
  it("ignores reminders that are off", () => {
    expect(dueReminders(lisbon({ ...DEFAULT_REMINDERS, lunch: { on: false, time: "13:00" } }), new Date("2026-12-01T13:05:00Z")).map((d) => d.kind)).not.toContain("lunch");
  });
  it("keeps a late-evening reminder on its own date after midnight", () => {
    const s = lisbon(only("summary", "23:45"));
    expect(dueReminders(s, new Date("2026-12-02T00:10:00Z"))).toEqual([{ kind: "summary", date: "2026-12-01" }]);
  });
  it("uses the person's own time zone", () => {
    const s = { tz: "America/New_York", reminders: only("breakfast", "09:00") };
    expect(dueReminders(s, new Date("2026-12-01T14:05:00Z"))).toEqual([{ kind: "breakfast", date: "2026-12-01" }]);
    expect(dueReminders(s, new Date("2026-12-01T09:05:00Z"))).toEqual([]);
  });
  it("fires once on the DST change day at the new local time", () => {
    const s = lisbon(only("lunch", "13:00"));
    expect(dueReminders(s, new Date("2026-10-25T12:30:00Z"))).toEqual([]);
    expect(dueReminders(s, new Date("2026-10-25T13:10:00Z"))).toEqual([{ kind: "lunch", date: "2026-10-25" }]);
  });
});

describe("buildMessage", () => {
  const day = (kcal: number, target: number, units: "kcal" | "kj" = "kcal") => ({ logged: [], kcal, target, units, updatedAt: 0 });

  it("writes meal reminders that open the scanner", () => {
    expect(buildMessage("lunch", "pt-PT", null)).toEqual({ title: "🍽️ Hora do almoço", body: "Ainda não registaste o almoço. Tira uma foto!", tab: "scan" });
    expect(buildMessage("breakfast", "en", null)).toEqual({ title: "🍳 Breakfast time", body: "You haven't logged breakfast yet. Snap a photo!", tab: "scan" });
  });
  it("summarises the day against the target, in the person's units", () => {
    expect(buildMessage("summary", "pt-PT", day(1840, 2200)).body).toBe("Hoje: 1840 de 2200 kcal — dentro da meta.");
    expect(buildMessage("summary", "en", day(2500, 2200)).body).toBe("Today: 2500 of 2200 kcal — over your target.");
    expect(buildMessage("summary", "en", day(1000, 2000, "kj")).body).toBe("Today: 4184 of 8368 kJ — within your target.");
    expect(buildMessage("summary", "pt-PT", day(500, 2000)).tab).toBe("diary");
  });
  it("says so when nothing was logged", () => {
    expect(buildMessage("summary", "pt-PT", null).body).toBe("Hoje ainda não registaste nada.");
    expect(buildMessage("summary", "en", null).body).toBe("You haven't logged anything today.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w worker -- reminders-schedule`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `worker/src/reminders/schedule.ts`**

```ts
import { REMINDER_KINDS, type ReminderKind, type ReminderSettings } from "@bites/shared";

export interface DueReminder { kind: ReminderKind; date: string }

const parts = (at: Date, tz: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const get = (t: string) => Number(f.formatToParts(at).find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
};

export function localDate(at: Date, tz: string): string {
  const { y, m, d } = parts(at, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The UTC instant of a wall-clock time in a zone. Two passes settle the offset on DST change days. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess += wanted - shown;
  }
  return new Date(guess);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const previousDate = (date: string) => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/** Reminders whose local time is in (now − window, now]. Yesterday is checked too so 23:45 still fires after midnight. */
export function dueReminders(settings: Pick<ReminderSettings, "tz" | "reminders">, now: Date, windowMinutes = 60): DueReminder[] {
  const today = localDate(now, settings.tz);
  const from = now.getTime() - windowMinutes * 60_000;
  const due: DueReminder[] = [];
  for (const kind of REMINDER_KINDS) {
    const r = settings.reminders[kind];
    if (!r.on) continue;
    for (const date of [today, previousDate(today)]) {
      const at = zonedToUtc(date, r.time, settings.tz).getTime();
      if (at > from && at <= now.getTime()) due.push({ kind, date });
    }
  }
  return due;
}
```

- [ ] **Step 4: Write `worker/src/reminders/messages.ts`**

```ts
import type { DayStatus, ReminderKind } from "@bites/shared";

const KJ_PER_KCAL = 4.184;

const TEXT = {
  "pt-PT": {
    breakfast: { title: "🍳 Pequeno-almoço", body: "Ainda não registaste o pequeno-almoço. Tira uma foto!" },
    lunch: { title: "🍽️ Hora do almoço", body: "Ainda não registaste o almoço. Tira uma foto!" },
    dinner: { title: "🍽️ Hora do jantar", body: "Ainda não registaste o jantar. Tira uma foto!" },
    summaryTitle: "O teu dia",
    summary: (eaten: number, target: number, unit: string, over: boolean) => `Hoje: ${eaten} de ${target} ${unit} — ${over ? "acima da meta" : "dentro da meta"}.`,
    nothing: "Hoje ainda não registaste nada.",
  },
  en: {
    breakfast: { title: "🍳 Breakfast time", body: "You haven't logged breakfast yet. Snap a photo!" },
    lunch: { title: "🍽️ Lunch time", body: "You haven't logged lunch yet. Snap a photo!" },
    dinner: { title: "🍽️ Dinner time", body: "You haven't logged dinner yet. Snap a photo!" },
    summaryTitle: "Your day",
    summary: (eaten: number, target: number, unit: string, over: boolean) => `Today: ${eaten} of ${target} ${unit} — ${over ? "over your target" : "within your target"}.`,
    nothing: "You haven't logged anything today.",
  },
} as const;

export function buildMessage(kind: ReminderKind, locale: "pt-PT" | "en", day: DayStatus | null): { title: string; body: string; tab: "scan" | "diary" } {
  const t = TEXT[locale];
  if (kind !== "summary") return { ...t[kind], tab: "scan" };
  if (!day) return { title: t.summaryTitle, body: t.nothing, tab: "diary" };
  const k = day.units === "kj" ? KJ_PER_KCAL : 1;
  const unit = day.units === "kj" ? "kJ" : "kcal";
  return { title: t.summaryTitle, body: t.summary(Math.round(day.kcal * k), Math.round(day.target * k), unit, day.kcal > day.target), tab: "diary" };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w worker -- reminders-schedule` then `npm run typecheck -w worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/reminders/schedule.ts worker/src/reminders/messages.ts worker/test/reminders-schedule.test.ts
git commit -m "feat(worker): reminder schedule math and notification text"
```

---

### Task 3: Worker storage and routes

**Files:**
- Create: `worker/src/reminders/store.ts`, `worker/src/reminders/routes.ts`
- Modify: `worker/src/index.ts` (routes and CORS methods)
- Create (test helper): `worker/test/helpers/kv.ts`
- Test: `worker/test/reminders-routes.test.ts`, `worker/test/router.test.ts` (one added case)

**Interfaces:**
- Consumes: Task 1 types and validators, `isValidTimeZone` (Task 2), `verifyRequest` from `worker/src/auth.ts`.
- Produces:
  - `store.ts`: `type KV = Pick<KVNamespace, "get" | "put" | "delete" | "list">`, `getSettings(kv, uid): Promise<ReminderSettings | null>`, `putSettings(kv, uid, s): Promise<void>`, `deleteSettings(kv, uid)`, `getDay(kv, uid, date): Promise<DayStatus | null>`, `putDay(kv, uid, date, d)`, `deleteDays(kv, uid)` (removes `day:<uid>:*` and `sent:<uid>:*`), `wasSent(kv, uid, date, kind): Promise<boolean>`, `markSent(kv, uid, date, kind)`, `DAY_TTL = 172800`, `MAX_DEVICES = 3`.
  - `routes.ts`: `interface ReminderDeps { verifyRequest: typeof verifyRequest; now: () => Date }`, `handleGetReminders`, `handlePutReminders`, `handleDeleteReminders`, `handlePutDay`, `handleDeleteDay` — each `(req: Request, env: Env, deps: ReminderDeps) => Promise<Response>`.

- [ ] **Step 1: Write the in-memory KV helper** — `worker/test/helpers/kv.ts` (shared by Tasks 3 and 4; it is not a test file, so importing it runs no tests)

```ts
export function fakeKV() {
  const store = new Map<string, string>();
  const ttl = new Map<string, number | undefined>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string, o?: { expirationTtl?: number }) => { store.set(k, v); ttl.set(k, o?.expirationTtl); },
    delete: async (k: string) => { store.delete(k); },
    list: async ({ prefix = "" }: { prefix?: string } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: "" }),
  };
  return { kv: kv as unknown as KVNamespace, store, ttl };
}
```

- [ ] **Step 2: Write the failing tests** — `worker/test/reminders-routes.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_REMINDERS } from "@bites/shared";
import type { Env } from "../src/env";
import { handleDeleteDay, handleDeleteReminders, handleGetReminders, handlePutDay, handlePutReminders, type ReminderDeps } from "../src/reminders/routes";
import { fakeKV } from "./helpers/kv";

const device = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p", auth: "a" } });
const now = new Date("2026-10-14T12:00:00Z");
const deps = (uid: string | null = "u1"): ReminderDeps => ({ verifyRequest: async () => uid, now: () => now });
const req = (method: string, body?: unknown, url = "https://api.test/api/reminders") => new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const settingsBody = (extra: object = {}) => ({ tz: "Europe/Lisbon", locale: "pt-PT", reminders: DEFAULT_REMINDERS, ...extra });

describe("reminder routes", () => {
  it("saves settings with a device and reads them back without keys", async () => {
    const { kv } = fakeKV();
    const env = { RATE_KV: kv } as Env;
    expect((await handlePutReminders(req("PUT", settingsBody({ device: device(1) })), env, deps())).status).toBe(200);
    const res = await handleGetReminders(req("GET", undefined, "https://api.test/api/reminders?endpoint=https%3A%2F%2Fpush.example%2F1"), env, deps());
    const body = (await res.json()) as any;
    expect(body.settings).toMatchObject({ tz: "Europe/Lisbon", locale: "pt-PT", reminders: DEFAULT_REMINDERS });
    expect(body.settings.devices).toBeUndefined();
    expect(body.deviceRegistered).toBe(true);
  });

  it("returns null settings when nothing is saved", async () => {
    const env = { RATE_KV: fakeKV().kv } as Env;
    expect(await (await handleGetReminders(req("GET"), env, deps())).json()).toEqual({ settings: null, deviceRegistered: false });
  });

  it("keeps at most three devices, newest first, replacing by endpoint", async () => {
    const { kv, store } = fakeKV();
    const env = { RATE_KV: kv } as Env;
    for (const n of [1, 2, 3, 4, 2]) await handlePutReminders(req("PUT", settingsBody({ device: device(n) })), env, deps());
    const saved = JSON.parse(store.get("push:u1")!);
    expect(saved.devices.map((d: { endpoint: string }) => d.endpoint)).toEqual(["https://push.example/2", "https://push.example/4", "https://push.example/3"]);
  });

  it("rejects bad input", async () => {
    const env = { RATE_KV: fakeKV().kv } as Env;
    const bad = [
      settingsBody({ tz: "Mars/Base" }),
      settingsBody({ locale: "fr" }),
      settingsBody({ reminders: { ...DEFAULT_REMINDERS, lunch: { on: true, time: "13:10" } } }),
      settingsBody({ device: { endpoint: "http://insecure", keys: { p256dh: "p", auth: "a" } } }),
      settingsBody({ device: { endpoint: "https://ok", keys: {} } }),
    ];
    for (const b of bad) expect((await handlePutReminders(req("PUT", b), env, deps())).status).toBe(400);
    expect((await handlePutReminders(new Request("https://api.test/api/reminders", { method: "PUT", body: "{nope" }), env, deps())).status).toBe(400);
  });

  it("requires a login", async () => {
    const env = { RATE_KV: fakeKV().kv } as Env;
    expect((await handlePutReminders(req("PUT", settingsBody()), env, deps(null))).status).toBe(401);
    expect((await handleGetReminders(req("GET"), env, deps(null))).status).toBe(401);
    expect((await handlePutDay(req("PUT", {}), env, deps(null))).status).toBe(401);
  });

  it("deletes one device, and the whole record with the last one", async () => {
    const { kv, store } = fakeKV();
    const env = { RATE_KV: kv } as Env;
    await handlePutReminders(req("PUT", settingsBody({ device: device(1) })), env, deps());
    await handlePutReminders(req("PUT", settingsBody({ device: device(2) })), env, deps());
    await handleDeleteReminders(req("DELETE", { endpoint: "https://push.example/1" }), env, deps());
    expect(JSON.parse(store.get("push:u1")!).devices).toHaveLength(1);
    await handleDeleteReminders(req("DELETE", { endpoint: "https://push.example/2" }), env, deps());
    expect(store.has("push:u1")).toBe(false);
  });

  it("stores the daily status for 48 hours and refuses far-away dates", async () => {
    const { kv, store, ttl } = fakeKV();
    const env = { RATE_KV: kv } as Env;
    const day = { date: "2026-10-14", logged: ["lunch"], kcal: 900, target: 2200, units: "kcal" };
    expect((await handlePutDay(req("PUT", day, "https://api.test/api/day"), env, deps())).status).toBe(200);
    expect(JSON.parse(store.get("day:u1:2026-10-14")!)).toMatchObject({ logged: ["lunch"], kcal: 900, target: 2200, units: "kcal" });
    expect(ttl.get("day:u1:2026-10-14")).toBe(172800);
    for (const bad of [{ ...day, date: "2026-10-20" }, { ...day, logged: ["brunch"] }, { ...day, kcal: -1 }, { ...day, units: "cal" }]) {
      expect((await handlePutDay(req("PUT", bad, "https://api.test/api/day"), env, deps())).status).toBe(400);
    }
  });

  it("deletes all daily records and sent marks for the person only", async () => {
    const { kv, store } = fakeKV();
    store.set("day:u1:2026-10-14", "{}");
    store.set("sent:u1:2026-10-14:lunch", "1");
    store.set("day:u2:2026-10-14", "{}");
    await handleDeleteDay(req("DELETE", undefined, "https://api.test/api/day"), { RATE_KV: kv } as Env, deps());
    expect([...store.keys()]).toEqual(["day:u2:2026-10-14"]);
  });
});
```

Add to `worker/test/router.test.ts` inside the `describe("router")` block:

```ts
  it("allows PUT and DELETE from the site for the reminder routes", async () => {
    const res = await call("/api/reminders", { method: "OPTIONS", headers: { origin: "https://bites.example.com" } });
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, DELETE, OPTIONS");
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w worker -- reminders-routes router`
Expected: FAIL, module not found and allow-methods mismatch.

- [ ] **Step 4: Write `worker/src/reminders/store.ts`**

```ts
import type { DayStatus, ReminderKind, ReminderSettings } from "@bites/shared";

export type KV = Pick<KVNamespace, "get" | "put" | "delete" | "list">;
export const DAY_TTL = 60 * 60 * 48;
export const MAX_DEVICES = 3;

const json = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const getSettings = async (kv: KV, uid: string) => json<ReminderSettings>(await kv.get(`push:${uid}`));
export const putSettings = (kv: KV, uid: string, s: ReminderSettings) => kv.put(`push:${uid}`, JSON.stringify(s));
export const deleteSettings = (kv: KV, uid: string) => kv.delete(`push:${uid}`);

export const getDay = async (kv: KV, uid: string, date: string) => json<DayStatus>(await kv.get(`day:${uid}:${date}`));
export const putDay = (kv: KV, uid: string, date: string, d: DayStatus) => kv.put(`day:${uid}:${date}`, JSON.stringify(d), { expirationTtl: DAY_TTL });

export const wasSent = async (kv: KV, uid: string, date: string, kind: ReminderKind) => (await kv.get(`sent:${uid}:${date}:${kind}`)) !== null;
export const markSent = (kv: KV, uid: string, date: string, kind: ReminderKind) => kv.put(`sent:${uid}:${date}:${kind}`, "1", { expirationTtl: DAY_TTL });

/** Every key under a prefix, following list cursors. */
export async function listKeys(kv: KV, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor });
    names.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

export async function deleteDays(kv: KV, uid: string) {
  const keys = [...(await listKeys(kv, `day:${uid}:`)), ...(await listKeys(kv, `sent:${uid}:`))];
  await Promise.all(keys.map((k) => kv.delete(k)));
}
```

- [ ] **Step 5: Write `worker/src/reminders/routes.ts`**

```ts
import { isValidReminderTimes, type DayStatus, type MealType, type PushDevice, type ReminderSettings } from "@bites/shared";
import type { Env } from "../env";
import type { verifyRequest as VerifyRequest } from "../auth";
import { localDate, isValidTimeZone } from "./schedule";
import { MAX_DEVICES, deleteDays, deleteSettings, getSettings, putDay, putSettings } from "./store";

export interface ReminderDeps { verifyRequest: typeof VerifyRequest; now: () => Date }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MAX_BODY = 4096;

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseDevice(x: unknown): Omit<PushDevice, "addedAt"> | null {
  const d = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!d || typeof d.endpoint !== "string" || !d.endpoint.startsWith("https://") || d.endpoint.length > 1024) return null;
  if (typeof d.keys?.p256dh !== "string" || typeof d.keys?.auth !== "string") return null;
  return { endpoint: d.endpoint, keys: { p256dh: d.keys.p256dh, auth: d.keys.auth } };
}

export async function handleGetReminders(req: Request, env: Env, deps: ReminderDeps) {
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const s = await getSettings(env.RATE_KV, uid);
  if (!s) return json({ settings: null, deviceRegistered: false });
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  const { devices, ...rest } = s;
  return json({ settings: rest, deviceRegistered: !!endpoint && devices.some((d) => d.endpoint === endpoint) });
}

export async function handlePutReminders(req: Request, env: Env, deps: ReminderDeps) {
  const body = await readBody(req);
  if (!body) return json({ error: "bad_request" }, 400);
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const { tz, locale, reminders } = body;
  if (typeof tz !== "string" || !isValidTimeZone(tz)) return json({ error: "bad_request" }, 400);
  if (locale !== "pt-PT" && locale !== "en") return json({ error: "bad_request" }, 400);
  if (!isValidReminderTimes(reminders)) return json({ error: "bad_request" }, 400);
  const device = body.device === undefined ? null : parseDevice(body.device);
  if (body.device !== undefined && !device) return json({ error: "bad_request" }, 400);

  const now = deps.now().getTime();
  const existing = await getSettings(env.RATE_KV, uid);
  let devices = existing?.devices ?? [];
  if (device) devices = [{ ...device, addedAt: now }, ...devices.filter((d) => d.endpoint !== device.endpoint)].slice(0, MAX_DEVICES);
  const next: ReminderSettings = { tz, locale, reminders, devices, updatedAt: now };
  await putSettings(env.RATE_KV, uid, next);
  return json({ ok: true });
}

export async function handleDeleteReminders(req: Request, env: Env, deps: ReminderDeps) {
  const body = await readBody(req);
  if (!body || typeof body.endpoint !== "string") return json({ error: "bad_request" }, 400);
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const s = await getSettings(env.RATE_KV, uid);
  if (s) {
    const devices = s.devices.filter((d) => d.endpoint !== body.endpoint);
    if (devices.length === 0) await deleteSettings(env.RATE_KV, uid);
    else await putSettings(env.RATE_KV, uid, { ...s, devices });
  }
  return json({ ok: true });
}

export async function handlePutDay(req: Request, env: Env, deps: ReminderDeps) {
  const body = await readBody(req);
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  if (!body) return json({ error: "bad_request" }, 400);
  const { date, logged, kcal, target, units } = body;
  const now = deps.now();
  const near = [localDate(new Date(now.getTime() - 86_400_000), "UTC"), localDate(now, "UTC"), localDate(new Date(now.getTime() + 86_400_000), "UTC")];
  if (typeof date !== "string" || !near.includes(date)) return json({ error: "bad_request" }, 400);
  if (!Array.isArray(logged) || logged.length > 4 || !logged.every((m) => MEALS.includes(m as MealType))) return json({ error: "bad_request" }, 400);
  const isAmount = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 50_000;
  if (!isAmount(kcal) || !isAmount(target) || (units !== "kcal" && units !== "kj")) return json({ error: "bad_request" }, 400);
  const status: DayStatus = { logged: [...new Set(logged as MealType[])], kcal: Math.round(kcal as number), target: Math.round(target as number), units, updatedAt: now.getTime() };
  await putDay(env.RATE_KV, uid, date, status);
  return json({ ok: true });
}

export async function handleDeleteDay(req: Request, env: Env, deps: ReminderDeps) {
  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  await deleteDays(env.RATE_KV, uid);
  return json({ ok: true });
}
```

Note: `handlePutDay` authenticates before validating so the 401 test with an empty body passes; `handlePutReminders` validates first like the existing `handleRedeem`.

- [ ] **Step 6: Wire the routes and CORS in `worker/src/index.ts`**

Change the allow-methods line to:

```ts
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
```

Add the import:

```ts
import { handleDeleteDay, handleDeleteReminders, handleGetReminders, handlePutDay, handlePutReminders } from "./reminders/routes";
```

Add before the final `not_found` line in `route()`:

```ts
  const reminderDeps = { verifyRequest, now: () => new Date() };
  if (pathname === "/api/reminders") {
    if (req.method === "GET") return handleGetReminders(req, env, reminderDeps);
    if (req.method === "PUT") return handlePutReminders(req, env, reminderDeps);
    if (req.method === "DELETE") return handleDeleteReminders(req, env, reminderDeps);
  }
  if (pathname === "/api/day") {
    if (req.method === "PUT") return handlePutDay(req, env, reminderDeps);
    if (req.method === "DELETE") return handleDeleteDay(req, env, reminderDeps);
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -w worker` then `npm run typecheck -w worker`
Expected: PASS (all existing worker tests still green).

- [ ] **Step 8: Commit**

```bash
git add worker/test/helpers/kv.ts worker/src/reminders/store.ts worker/src/reminders/routes.ts worker/src/index.ts worker/test/reminders-routes.test.ts worker/test/router.test.ts
git commit -m "feat(worker): reminder and daily status routes"
```

---

### Task 4: Sending and the cron job

**Files:**
- Create: `worker/src/reminders/send.ts`, `worker/src/reminders/run.ts`
- Modify: `worker/src/index.ts` (`scheduled` export), `worker/src/env.ts`, `worker/wrangler.toml`, `worker/package.json`
- Test: `worker/test/reminders-run.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`dueReminders`, `buildMessage`, store helpers, `listKeys`).
- Produces:
  - `send.ts`: `type SendOutcome = "ok" | "gone" | "retry"`, `type SendFn = (device: PushDevice, payload: string, env: Env) => Promise<SendOutcome>`, `sendPush: SendFn`.
  - `run.ts`: `runReminders(env: Env, now: Date, send: SendFn): Promise<{ sent: number; removed: number; failed: number }>`.
  - `env.ts` gains `VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string`.

- [ ] **Step 1: Add the dependency**

Run: `npm install web-push-neo@0.1.2 -w worker`
Then open `node_modules/web-push-neo/dist/index.mjs` and check that `sendNotification` uses only `fetch`, Web Crypto and `jose` (no `node:` imports). If it imports any `node:` module, stop and switch to `@pushforge/builder` (adjust `sendPush` to call `buildPushHTTPRequest` and `fetch` the result).

- [ ] **Step 2: Write the failing tests** — `worker/test/reminders-run.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_REMINDERS, type ReminderSettings } from "@bites/shared";
import type { Env } from "../src/env";
import { runReminders } from "../src/reminders/run";
import type { SendFn } from "../src/reminders/send";
import { fakeKV } from "./helpers/kv";

const device = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p", auth: "a" }, addedAt: 0 });
const settings = (extra: Partial<ReminderSettings> = {}): ReminderSettings => ({ tz: "Europe/Lisbon", locale: "pt-PT", reminders: DEFAULT_REMINDERS, devices: [device(1)], updatedAt: 0, ...extra });
const setup = (people: Record<string, ReminderSettings>) => {
  const { kv, store } = fakeKV();
  for (const [uid, s] of Object.entries(people)) store.set(`push:${uid}`, JSON.stringify(s));
  return { env: { RATE_KV: kv } as Env, store };
};
const lunchTime = new Date("2026-12-01T13:05:00Z");

describe("runReminders", () => {
  it("sends a due meal reminder once", async () => {
    const { env } = setup({ u1: settings() });
    const send = vi.fn<SendFn>(async () => "ok");
    expect((await runReminders(env, lunchTime, send)).sent).toBe(1);
    const payload = JSON.parse(send.mock.calls[0]![1]);
    expect(payload).toMatchObject({ title: "🍽️ Hora do almoço", tab: "scan", tag: "lunch-2026-12-01" });
    await runReminders(env, new Date("2026-12-01T13:20:00Z"), send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("skips a meal that was already logged, but snacks do not count", async () => {
    const { env, store } = setup({ u1: settings() });
    const send = vi.fn<SendFn>(async () => "ok");
    store.set("day:u1:2026-12-01", JSON.stringify({ logged: ["snack"], kcal: 200, target: 2000, units: "kcal", updatedAt: 0 }));
    await runReminders(env, lunchTime, send);
    expect(send).toHaveBeenCalledTimes(1);
    const { env: env2, store: store2 } = setup({ u1: settings() });
    store2.set("day:u1:2026-12-01", JSON.stringify({ logged: ["lunch"], kcal: 700, target: 2000, units: "kcal", updatedAt: 0 }));
    const send2 = vi.fn<SendFn>(async () => "ok");
    await runReminders(env2, lunchTime, send2);
    expect(send2).not.toHaveBeenCalled();
  });

  it("sends the summary with the day's numbers", async () => {
    const { env, store } = setup({ u1: settings() });
    store.set("day:u1:2026-12-01", JSON.stringify({ logged: ["lunch"], kcal: 1840, target: 2200, units: "kcal", updatedAt: 0 }));
    const send = vi.fn<SendFn>(async () => "ok");
    await runReminders(env, new Date("2026-12-01T21:35:00Z"), send);
    expect(JSON.parse(send.mock.calls[0]![1]).body).toBe("Hoje: 1840 de 2200 kcal — dentro da meta.");
  });

  it("removes devices the push service says are gone", async () => {
    const { env, store } = setup({ u1: settings({ devices: [device(1), device(2)] }) });
    const send = vi.fn<SendFn>(async (d) => (d.endpoint.endsWith("/1") ? "gone" : "ok"));
    const result = await runReminders(env, lunchTime, send);
    expect(result.removed).toBe(1);
    expect(JSON.parse(store.get("push:u1")!).devices.map((d: { endpoint: string }) => d.endpoint)).toEqual(["https://push.example/2"]);
  });

  it("deletes the record when the last device is gone", async () => {
    const { env, store } = setup({ u1: settings() });
    await runReminders(env, lunchTime, async () => "gone");
    expect(store.has("push:u1")).toBe(false);
  });

  it("retries a transient failure on the next run within the hour", async () => {
    const { env } = setup({ u1: settings() });
    const flaky = vi.fn<SendFn>().mockResolvedValueOnce("retry").mockResolvedValue("ok");
    expect((await runReminders(env, lunchTime, flaky)).failed).toBe(1);
    expect((await runReminders(env, new Date("2026-12-01T13:20:00Z"), flaky)).sent).toBe(1);
  });

  it("keeps going when one person's send throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = setup({ u1: settings({ devices: [device(1)] }), u2: settings({ devices: [device(2)] }) });
    const send = vi.fn<SendFn>(async (d) => {
      if (d.endpoint.endsWith("/1")) throw new Error("boom");
      return "ok";
    });
    expect((await runReminders(env, lunchTime, send)).sent).toBe(1);
  });

  it("ignores a corrupt record", async () => {
    const { env, store } = setup({});
    store.set("push:u1", "{not json");
    expect(await runReminders(env, lunchTime, async () => "ok")).toEqual({ sent: 0, removed: 0, failed: 0 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w worker -- reminders-run`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `worker/src/reminders/send.ts`**

```ts
import { sendNotification } from "web-push-neo";
import type { PushDevice } from "@bites/shared";
import type { Env } from "../env";

export type SendOutcome = "ok" | "gone" | "retry";
export type SendFn = (device: PushDevice, payload: string, env: Env) => Promise<SendOutcome>;

/** 404 and 410 mean the subscription no longer exists; anything else is worth another try. */
export const sendPush: SendFn = async (device, payload, env) => {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error("VAPID keys are not configured");
  try {
    await sendNotification({ endpoint: device.endpoint, keys: device.keys }, payload, {
      vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
      TTL: 3600,
      urgency: "normal",
      signal: AbortSignal.timeout(10_000),
    });
    return "ok";
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    return status === 404 || status === 410 ? "gone" : "retry";
  }
};
```

- [ ] **Step 5: Write `worker/src/reminders/run.ts`**

```ts
import type { Env } from "../env";
import { buildMessage } from "./messages";
import { dueReminders } from "./schedule";
import type { SendFn } from "./send";
import { deleteSettings, getDay, getSettings, listKeys, markSent, putSettings, wasSent } from "./store";

export async function runReminders(env: Env, now: Date, send: SendFn) {
  const totals = { sent: 0, removed: 0, failed: 0 };
  const uids = (await listKeys(env.RATE_KV, "push:")).map((k) => k.slice("push:".length));
  for (const uid of uids) {
    try {
      const settings = await getSettings(env.RATE_KV, uid);
      if (!settings?.devices?.length || !settings.reminders || !settings.tz) continue;
      let devices = settings.devices;
      for (const { kind, date } of dueReminders(settings, now)) {
        if (await wasSent(env.RATE_KV, uid, date, kind)) continue;
        const day = await getDay(env.RATE_KV, uid, date);
        if (kind !== "summary" && day?.logged.includes(kind)) continue;
        const payload = JSON.stringify({ ...buildMessage(kind, settings.locale, day), tag: `${kind}-${date}` });
        let delivered = false;
        const kept = [];
        for (const device of devices) {
          const outcome = await send(device, payload, env);
          if (outcome === "gone") totals.removed++;
          else kept.push(device);
          if (outcome === "ok") delivered = true;
        }
        devices = kept;
        if (delivered) {
          await markSent(env.RATE_KV, uid, date, kind);
          totals.sent++;
        } else if (devices.length) totals.failed++;
        if (!devices.length) break;
      }
      if (devices.length !== settings.devices.length) {
        if (devices.length) await putSettings(env.RATE_KV, uid, { ...settings, devices });
        else await deleteSettings(env.RATE_KV, uid);
      }
    } catch (e) {
      console.error("reminders failed for one person", e);
    }
  }
  return totals;
}
```

- [ ] **Step 6: Wire the cron and config**

In `worker/src/env.ts` add before `AI?: Ai;`:

```ts
  /** Web Push (VAPID). The private key is a secret: `wrangler secret put VAPID_PRIVATE_KEY`. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
```

In `worker/src/index.ts` add imports and the handler:

```ts
import { runReminders } from "./reminders/run";
import { sendPush } from "./reminders/send";
```

```ts
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await route(req, env);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(req, env))) out.headers.set(k, v);
    return out;
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runReminders(env, new Date(), sendPush).then((r) => console.log("reminders", r)));
  },
};
```

In `worker/wrangler.toml`, under `[vars]` add (the public key value is filled in during Task 9):

```toml
# Web Push. VAPID_PRIVATE_KEY is a secret (wrangler secret put VAPID_PRIVATE_KEY).
VAPID_PUBLIC_KEY = ""
VAPID_SUBJECT = "mailto:at.renatocruz@gmail.com"
```

and at the end:

```toml
[triggers]
crons = ["*/15 * * * *"]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -w worker` then `npm run typecheck -w worker`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker/src/reminders/send.ts worker/src/reminders/run.ts worker/src/index.ts worker/src/env.ts worker/wrangler.toml worker/package.json package-lock.json worker/test/reminders-run.test.ts
git commit -m "feat(worker): send due reminders from a 15-minute cron"
```

---

### Task 5: Service worker handlers and opening a tab from the URL

**Files:**
- Create: `web/public/push-sw.js`
- Modify: `web/vite.config.ts`, `web/src/App.tsx`
- Test: `web/test/push-sw.test.ts`, `web/test/boot.test.tsx` (one added case)

**Interfaces:**
- Produces: notifications open `/?tab=scan` or `/?tab=diary`; `Shell` reads `?tab=` once on mount and calls `setTab`, then removes the parameter with `history.replaceState`.

- [ ] **Step 1: Write the failing tests**

`web/test/push-sw.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../public/push-sw.js", import.meta.url), "utf8");

function load() {
  const listeners: Record<string, (e: any) => void> = {};
  const win = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) };
  const self = {
    location: { origin: "https://bites.test" },
    addEventListener: (type: string, fn: (e: any) => void) => (listeners[type] = fn),
    registration: { showNotification: vi.fn(async () => {}) },
    clients: { matchAll: vi.fn(async () => [] as unknown[]), openWindow: vi.fn(async () => {}) },
  };
  new Function("self", code)(self);
  return { listeners, self, win };
}
const run = async (fn: (e: any) => void, e: any) => {
  let work: Promise<unknown> = Promise.resolve();
  fn({ ...e, waitUntil: (p: Promise<unknown>) => (work = p) });
  await work;
};

describe("push service worker", () => {
  it("shows the notification from the payload", async () => {
    const { listeners, self } = load();
    await run(listeners.push!, { data: { json: () => ({ title: "Hi", body: "There", tab: "scan", tag: "lunch-2026-12-01" }) } });
    expect(self.registration.showNotification).toHaveBeenCalledWith("Hi", expect.objectContaining({ body: "There", tag: "lunch-2026-12-01", data: { tab: "scan" } }));
  });
  it("falls back to a plain Bites notification for an unreadable payload", async () => {
    const { listeners, self } = load();
    await run(listeners.push!, { data: { json: () => { throw new Error("x"); }, text: () => "raw" } });
    expect(self.registration.showNotification).toHaveBeenCalledWith("Bites", expect.objectContaining({ body: "raw", data: { tab: "diary" } }));
  });
  it("opens the app on the right tab when tapped", async () => {
    const { listeners, self } = load();
    const close = vi.fn();
    await run(listeners.notificationclick!, { notification: { close, data: { tab: "scan" } } });
    expect(close).toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://bites.test/?tab=scan");
  });
  it("reuses an open window instead of opening another", async () => {
    const { listeners, self, win } = load();
    self.clients.matchAll.mockResolvedValue([win]);
    await run(listeners.notificationclick!, { notification: { close: () => {}, data: { tab: "diary" } } });
    expect(win.focus).toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledWith("https://bites.test/?tab=diary");
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });
});
```

Add to `web/test/boot.test.tsx` (inside its main `describe`, after the existing setup that renders `<App skipSplash />` with a stored profile — reuse that file's helper for a signed-in profile):

```tsx
  it("opens the tab named in ?tab= and cleans the address", async () => {
    window.history.replaceState(null, "", "/?tab=scan");
    await renderWithProfile();
    await waitFor(() => expect(useStore.getState().tab).toBe("scan"));
    expect(window.location.search).toBe("");
  });
```

If `boot.test.tsx` has no `renderWithProfile` helper, write one at the top of the file that saves a profile to the test `LocalRepo`, sets it in the store, and renders `<App skipSplash />` the same way the file's existing profile test does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w web -- push-sw boot`
Expected: FAIL, `public/push-sw.js` missing and tab not set.

- [ ] **Step 3: Write `web/public/push-sw.js`**

```js
/* Imported into the generated Workbox service worker (vite.config.ts → workbox.importScripts). */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const tab = data.tab === "scan" ? "scan" : "diary";
  event.waitUntil(
    self.registration.showNotification(data.title || "Bites", {
      body: data.body || "",
      tag: data.tag,
      icon: "/pwa-192x192.png",
      badge: "/pwa-64x64.png",
      data: { tab },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const tab = event.notification.data && event.notification.data.tab === "scan" ? "scan" : "diary";
  const url = new URL(`/?tab=${tab}`, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows[0];
      if (open) {
        await open.focus();
        if (open.navigate) await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
```

- [ ] **Step 4: Import it into the generated service worker** — in `web/vite.config.ts` change the workbox line to:

```ts
      workbox: { navigateFallback: "/index.html", runtimeCaching: [], importScripts: ["push-sw.js"] },
```

- [ ] **Step 5: Read `?tab=` in `Shell`** — in `web/src/App.tsx` inside `function Shell()`, after `const online = useOnline();` add:

```tsx
  // Notifications open "/?tab=scan" or "/?tab=diary"; switch to it once and tidy the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("tab");
    if (wanted === "scan" || wanted === "diary" || wanted === "history") useStore.getState().setTab(wanted);
    if (params.has("tab")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w web` then `npm run typecheck -w web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/public/push-sw.js web/vite.config.ts web/src/App.tsx web/test/push-sw.test.ts web/test/boot.test.tsx
git commit -m "feat(web): push notification handlers and ?tab= deep links"
```

---

### Task 6: Web reminders client

**Files:**
- Create: `web/src/lib/reminders.ts`
- Modify: `web/src/lib/api.ts` (export `authedJson`)
- Test: `web/test/reminders.test.ts`

**Interfaces:**
- Consumes: Task 1 (`DEFAULT_REMINDERS`, `roundToQuarter`, types), `isStandalone`/`detectPlatform` from `lib/install.ts`, `authedJson` from `lib/api.ts`, `Repo` from `lib/repo`, `dayKey` and `Profile` from `@bites/shared`, `resolveLocale` from `i18n.ts`.
- Produces:
  - `remindersSupported(): boolean`
  - `remindersInstallable(): boolean` — supported and (not iOS or standalone)
  - `shouldOfferReminders(): boolean` — supported, standalone, not dismissed, not already on
  - `dismissReminders(): void`
  - `remindersOnHere(): boolean`
  - `type EnableResult = "on" | "denied" | "failed"`
  - `requestReminders(times?: ReminderTimes): Promise<EnableResult>` — permission + subscribe, stores a pending request locally
  - `flushPendingReminders(repo: Repo, locale: Profile["locale"]): Promise<boolean>`
  - `loadReminders(repo: Repo): Promise<{ times: ReminderTimes; registered: boolean } | null>`
  - `saveReminderTimes(repo: Repo, times: ReminderTimes, locale: Profile["locale"]): Promise<boolean>`
  - `disableReminders(repo: Repo): Promise<void>` — unsubscribes this device and deletes it on the server
  - `deleteServerDays(repo: Repo): Promise<void>`
  - `syncToday(repo: Repo, profile: Profile, now?: Date): Promise<"sent" | "skipped">`
  - `refreshTimeZone(repo: Repo, locale: Profile["locale"]): Promise<void>`
  - `resetReminderCache(): void` (test helper for the in-memory "last sent" value)

- [ ] **Step 1: Export `authedJson`** — in `web/src/lib/api.ts` change `async function authedJson<T>(` to `export async function authedJson<T>(`.

- [ ] **Step 2: Write the failing tests** — `web/test/reminders.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_REMINDERS, type Meal, type Profile } from "@bites/shared";
import {
  disableReminders, flushPendingReminders, refreshTimeZone, remindersOnHere, requestReminders, resetReminderCache, saveReminderTimes, shouldOfferReminders, syncToday,
} from "../src/lib/reminders";
import type { Repo } from "../src/lib/repo";

const sub = { endpoint: "https://push.example/1", toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } }), unsubscribe: vi.fn(async () => true) };
function stubPush({ permission = "granted", existing = null as unknown }: { permission?: NotificationPermission; existing?: unknown } = {}) {
  const pushManager = { subscribe: vi.fn(async () => sub), getSubscription: vi.fn(async () => existing) };
  vi.stubGlobal("Notification", Object.assign(function () {}, { permission: "default", requestPermission: vi.fn(async () => permission) }));
  vi.stubGlobal("PushManager", function () {});
  Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve({ pushManager }) }, configurable: true });
  return pushManager;
}
const standalone = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("standalone"), media: q, addEventListener() {}, removeEventListener() {} }));
const fetchOk = () => {
  const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true, settings: { reminders: DEFAULT_REMINDERS }, deviceRegistered: true }), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
};
const meal = (mealType: Meal["mealType"], kcal: number): Meal => ({ id: Math.random().toString(), createdAt: 0, dayKey: "2026-12-01", mealType, title: "x", thumb: null, items: [], totals: { kcal, protein: 0, carbs: 0, fat: 0 }, source: "text", edited: false });
const repo = (meals: Meal[] = []) => ({ getIdToken: async () => "tok", mealsForDay: vi.fn(async () => meals) }) as unknown as Repo;
const profile = { kcalTarget: 2200, units: "kcal", locale: "pt-PT" } as Profile;
const bodyOf = (fn: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(String((fn.mock.calls[i]![1] as RequestInit).body));

beforeEach(() => {
  localStorage.clear();
  resetReminderCache();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("offering reminders", () => {
  it("offers only in the installed app with push support", () => {
    stubPush();
    standalone(false);
    expect(shouldOfferReminders()).toBe(false);
    standalone(true);
    expect(shouldOfferReminders()).toBe(true);
    localStorage.setItem("bites.reminders.dismissed", "1");
    expect(shouldOfferReminders()).toBe(false);
  });
});

describe("turning reminders on before sign-in", () => {
  it("asks permission, subscribes, and keeps the request until there is an account", async () => {
    const pm = stubPush();
    expect(await requestReminders()).toBe("on");
    expect(pm.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(remindersOnHere()).toBe(true);
    const fetchFn = fetchOk();
    expect(await flushPendingReminders(repo(), "pt-PT")).toBe(true);
    const body = bodyOf(fetchFn);
    expect(body).toMatchObject({ locale: "pt-PT", reminders: DEFAULT_REMINDERS, device: { endpoint: "https://push.example/1" } });
    expect(typeof body.tz).toBe("string");
    expect(await flushPendingReminders(repo(), "pt-PT")).toBe(false);
  });
  it("keeps the pending request when the server is unreachable, to try again later", async () => {
    stubPush();
    await requestReminders();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await flushPendingReminders(repo(), "pt-PT")).toBe(false);
    fetchOk();
    expect(await flushPendingReminders(repo(), "pt-PT")).toBe(true);
  });
  it("reports denied permission without subscribing", async () => {
    const pm = stubPush({ permission: "denied" });
    expect(await requestReminders()).toBe("denied");
    expect(pm.subscribe).not.toHaveBeenCalled();
    expect(remindersOnHere()).toBe(false);
  });
});

describe("settings", () => {
  it("rounds times to the quarter hour before saving", async () => {
    stubPush({ existing: sub });
    const fetchFn = fetchOk();
    await saveReminderTimes(repo(), { ...DEFAULT_REMINDERS, lunch: { on: true, time: "13:07" } }, "system");
    expect(bodyOf(fetchFn).reminders.lunch.time).toBe("13:00");
  });
  it("turning off unsubscribes this device and tells the server", async () => {
    stubPush({ existing: sub });
    localStorage.setItem("bites.reminders.on", "1");
    const fetchFn = fetchOk();
    await disableReminders(repo());
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect((fetchFn.mock.calls[0]![1] as RequestInit).method).toBe("DELETE");
    expect(bodyOf(fetchFn)).toEqual({ endpoint: "https://push.example/1" });
    expect(remindersOnHere()).toBe(false);
  });
  it("re-saves when the phone's time zone changed", async () => {
    stubPush({ existing: sub });
    localStorage.setItem("bites.reminders.on", "1");
    localStorage.setItem("bites.reminders.tz", "America/New_York");
    const fetchFn = fetchOk();
    await refreshTimeZone(repo(), "pt-PT");
    expect(fetchFn.mock.calls.some(([, init]) => (init as RequestInit)?.method === "PUT")).toBe(true);
  });
});

describe("syncToday", () => {
  it("sends today's logged meal types and kcal, once per change", async () => {
    localStorage.setItem("bites.reminders.on", "1");
    const fetchFn = fetchOk();
    const r = repo([meal("lunch", 700), meal("snack", 150), meal("lunch", 100)]);
    expect(await syncToday(r, profile, new Date(2026, 11, 1, 14))).toBe("sent");
    expect(bodyOf(fetchFn)).toEqual({ date: "2026-12-01", logged: ["lunch", "snack"], kcal: 950, target: 2200, units: "kcal" });
    expect(await syncToday(r, profile, new Date(2026, 11, 1, 14))).toBe("skipped");
  });
  it("does nothing when reminders are off on this phone or it is offline", async () => {
    const fetchFn = fetchOk();
    expect(await syncToday(repo([meal("lunch", 1)]), profile)).toBe("skipped");
    localStorage.setItem("bites.reminders.on", "1");
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(await syncToday(repo([meal("lunch", 1)]), profile)).toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w web -- reminders.test`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `web/src/lib/reminders.ts`**

```ts
import { DEFAULT_REMINDERS, dayKey, roundToQuarter, REMINDER_KINDS, type MealType, type Profile, type ReminderTimes } from "@bites/shared";
import { authedJson } from "./api";
import { detectPlatform, isStandalone } from "./install";
import type { Repo } from "./repo";
import { resolveLocale } from "../i18n";

const ON = "bites.reminders.on";
const DISMISSED = "bites.reminders.dismissed";
const PENDING = "bites.reminders.pending";
const TZ = "bites.reminders.tz";
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

let lastDaySent: string | null = null;
export const resetReminderCache = () => {
  lastDaySent = null;
};

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Only the convenience flag is lost; the server still has the settings.
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // Same as above.
    }
  },
};

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverLocale = (l: Profile["locale"]) => (l === "system" ? resolveLocale(navigator.language) : l);
const withQuarters = (t: ReminderTimes): ReminderTimes =>
  Object.fromEntries(REMINDER_KINDS.map((k) => [k, { on: t[k].on, time: roundToQuarter(t[k].time) }])) as ReminderTimes;

export function remindersSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "PushManager" in window && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}
export const remindersInstallable = () => remindersSupported() && (detectPlatform() !== "ios" || isStandalone());
export const remindersOnHere = () => ls.get(ON) === "1";
export const dismissReminders = () => ls.set(DISMISSED, "1");
export const shouldOfferReminders = () => remindersSupported() && isStandalone() && ls.get(DISMISSED) !== "1" && !remindersOnHere();

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!remindersSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export type EnableResult = "on" | "denied" | "failed";

/** Must run inside a tap: iOS only shows the permission prompt for a user gesture. */
export async function requestReminders(times: ReminderTimes = DEFAULT_REMINDERS): Promise<EnableResult> {
  if (!remindersSupported()) return "failed";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY }));
    ls.set(PENDING, JSON.stringify({ times: withQuarters(times), device: sub.toJSON() }));
    ls.set(ON, "1");
    return "on";
  } catch {
    return "failed";
  }
}

async function put(repo: Repo, times: ReminderTimes, locale: Profile["locale"], device?: unknown): Promise<boolean> {
  const tz = deviceTimeZone();
  try {
    const r = await authedJson("/api/reminders", { method: "PUT", body: JSON.stringify({ tz, locale: serverLocale(locale), reminders: withQuarters(times), ...(device ? { device } : {}) }) }, await repo.getIdToken());
    if (r.ok) ls.set(TZ, tz);
    return r.ok;
  } catch {
    return false;
  }
}

/** Sends a request made during onboarding (before sign-in) once there is an account. */
export async function flushPendingReminders(repo: Repo, locale: Profile["locale"]): Promise<boolean> {
  const raw = ls.get(PENDING);
  if (!raw) return false;
  let pending: { times: ReminderTimes; device: unknown };
  try {
    pending = JSON.parse(raw);
  } catch {
    ls.del(PENDING);
    return false;
  }
  const ok = await put(repo, pending.times, locale, pending.device);
  if (ok) ls.del(PENDING);
  return ok;
}

export async function loadReminders(repo: Repo): Promise<{ times: ReminderTimes; registered: boolean } | null> {
  try {
    const sub = await currentSubscription();
    const q = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
    const r = await authedJson<{ settings: { reminders: ReminderTimes } | null; deviceRegistered: boolean }>(`/api/reminders${q}`, { method: "GET" }, await repo.getIdToken());
    if (!r.ok || !r.body) return null;
    return { times: r.body.settings?.reminders ?? DEFAULT_REMINDERS, registered: r.body.deviceRegistered };
  } catch {
    return null;
  }
}

export async function saveReminderTimes(repo: Repo, times: ReminderTimes, locale: Profile["locale"]): Promise<boolean> {
  const sub = await currentSubscription().catch(() => null);
  return put(repo, times, locale, sub?.toJSON());
}

export async function disableReminders(repo: Repo): Promise<void> {
  ls.del(ON);
  ls.del(PENDING);
  lastDaySent = null;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  try {
    await authedJson("/api/reminders", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }, await repo.getIdToken());
  } catch {
    // The push service reports the subscription as gone on the next send, and the worker drops it then.
  }
  await sub.unsubscribe().catch(() => false);
}

export async function deleteServerDays(repo: Repo): Promise<void> {
  try {
    await authedJson("/api/day", { method: "DELETE" }, await repo.getIdToken());
  } catch {
    // Daily records expire on their own after 48 hours.
  }
}

/** Reports which meal types are logged today and the total, so the worker can skip reminders and write the summary. */
export async function syncToday(repo: Repo, profile: Profile, now = new Date()): Promise<"sent" | "skipped"> {
  if (!remindersOnHere() || navigator.onLine === false) return "skipped";
  const date = dayKey(now);
  const meals = await repo.mealsForDay(date);
  const logged = [...new Set(meals.map((m) => m.mealType))] as MealType[];
  const kcal = Math.round(meals.reduce((sum, m) => sum + m.totals.kcal, 0));
  const status = { date, logged, kcal, target: profile.kcalTarget, units: profile.units };
  const key = JSON.stringify(status);
  if (key === lastDaySent) return "skipped";
  try {
    const r = await authedJson("/api/day", { method: "PUT", body: key }, await repo.getIdToken());
    if (!r.ok) return "skipped";
    lastDaySent = key;
    return "sent";
  } catch {
    return "skipped";
  }
}

export async function refreshTimeZone(repo: Repo, locale: Profile["locale"]): Promise<void> {
  if (!remindersOnHere() || ls.get(TZ) === deviceTimeZone()) return;
  const current = await loadReminders(repo);
  if (current) await saveReminderTimes(repo, current.times, locale);
}
```

Add the env type to `web/src/globals.d.ts`:

```ts
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -w web -- reminders.test` then `npm run typecheck -w web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/reminders.ts web/src/lib/api.ts web/src/globals.d.ts web/test/reminders.test.ts
git commit -m "feat(web): reminders client, pending flush and daily status sync"
```

---

### Task 7: Onboarding step, Settings section, cleanup on sign-out and delete-all

**Files:**
- Create: `web/src/components/Switch.tsx`, `web/src/features/onboarding/RemindersScreen.tsx`, `web/src/features/settings/RemindersGroup.tsx`
- Modify: `web/src/features/onboarding/Onboarding.tsx`, `web/src/features/settings/SettingsSheet.tsx`, `web/src/locales/en.json`, `web/src/locales/pt-PT.json`
- Test: `web/test/reminders-ui.test.tsx`

**Interfaces:**
- Consumes: Task 6 functions; `DEFAULT_REMINDERS`, `REMINDER_KINDS`, `ReminderTimes`.
- Produces: `Switch({ checked, onChange, label, disabled? })`; `RemindersScreen({ onDone })`; `RemindersGroup()` (reads `repo` and `profile` from the store).

- [ ] **Step 1: Add the strings**

In `web/src/locales/en.json`, add a top-level block before `"install": {`:

```json
  "reminders": {
    "title": "Never forget a meal",
    "body": "A nudge at mealtimes, only if you haven't logged that meal yet, and a short summary of your day.",
    "turnOn": "Turn on reminders",
    "skip": "Not now",
    "continue": "Continue",
    "deniedTitle": "Notifications are off",
    "deniedBody": "Turn on notifications for Bites in your phone's Settings, then come back here.",
    "group": "Reminders",
    "master": "Reminders on this phone",
    "kinds": { "breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "summary": "Daily summary" },
    "time": "{{name}} time",
    "needsInstall": "Add Bites to your home screen to get reminders.",
    "unsupported": "Reminders aren't available in this browser.",
    "saveFailed": "Couldn't save reminders. Try again."
  },
```

In `web/src/locales/pt-PT.json`, the same keys:

```json
  "reminders": {
    "title": "Nunca te esqueças de uma refeição",
    "body": "Um lembrete às horas das refeições, só se ainda não registaste essa refeição, e um resumo curto do teu dia.",
    "turnOn": "Ligar lembretes",
    "skip": "Agora não",
    "continue": "Continuar",
    "deniedTitle": "As notificações estão desligadas",
    "deniedBody": "Liga as notificações do Bites nas Definições do telemóvel e volta cá.",
    "group": "Lembretes",
    "master": "Lembretes neste telemóvel",
    "kinds": { "breakfast": "Pequeno-almoço", "lunch": "Almoço", "dinner": "Jantar", "summary": "Resumo do dia" },
    "time": "Hora do {{name}}",
    "needsInstall": "Adiciona o Bites ao ecrã principal para receberes lembretes.",
    "unsupported": "Os lembretes não estão disponíveis neste navegador.",
    "saveFailed": "Não foi possível guardar os lembretes. Tenta outra vez."
  },
```

The existing `test/locales.test.ts` checks both files have the same keys; it must still pass.

- [ ] **Step 2: Write the failing tests** — `web/test/reminders-ui.test.tsx`

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { DEFAULT_REMINDERS, type Profile } from "@bites/shared";
import * as reminders from "../src/lib/reminders";
import RemindersScreen from "../src/features/onboarding/RemindersScreen";
import RemindersGroup from "../src/features/settings/RemindersGroup";
import { useStore } from "../src/store";

const profile = { locale: "en", units: "kcal", kcalTarget: 2000 } as Profile;

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
  useStore.setState({ profile, repo: { getIdToken: async () => "tok" } as never });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RemindersScreen", () => {
  it("shows the suggested times and turns reminders on", async () => {
    const req = vi.spyOn(reminders, "requestReminders").mockResolvedValue("on");
    const done = vi.fn();
    render(<RemindersScreen onDone={done} />);
    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.getByText("21:30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on reminders" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(req).toHaveBeenCalledWith(DEFAULT_REMINDERS);
  });
  it("explains a denied permission and still lets the person continue", async () => {
    vi.spyOn(reminders, "requestReminders").mockResolvedValue("denied");
    const done = vi.fn();
    render(<RemindersScreen onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on reminders" }));
    expect(await screen.findByText("Notifications are off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(done).toHaveBeenCalled();
  });
  it("remembers Not now", () => {
    const dismiss = vi.spyOn(reminders, "dismissReminders");
    const done = vi.fn();
    render(<RemindersScreen onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(dismiss).toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
  });
});

describe("RemindersGroup", () => {
  it("asks to install first on an iPhone browser", () => {
    vi.spyOn(reminders, "remindersSupported").mockReturnValue(true);
    vi.spyOn(reminders, "remindersInstallable").mockReturnValue(false);
    render(<RemindersGroup />);
    expect(screen.getByText("Add Bites to your home screen to get reminders.")).toBeTruthy();
  });
  it("says when the browser can't do reminders", () => {
    vi.spyOn(reminders, "remindersSupported").mockReturnValue(false);
    render(<RemindersGroup />);
    expect(screen.getByText("Reminders aren't available in this browser.")).toBeTruthy();
  });
  it("loads the times, changes one and turns everything off", async () => {
    vi.spyOn(reminders, "remindersSupported").mockReturnValue(true);
    vi.spyOn(reminders, "remindersInstallable").mockReturnValue(true);
    vi.spyOn(reminders, "remindersOnHere").mockReturnValue(true);
    vi.spyOn(reminders, "loadReminders").mockResolvedValue({ times: DEFAULT_REMINDERS, registered: true });
    const save = vi.spyOn(reminders, "saveReminderTimes").mockResolvedValue(true);
    const disable = vi.spyOn(reminders, "disableReminders").mockResolvedValue();
    render(<RemindersGroup />);
    const lunch = (await screen.findByLabelText("Lunch time")) as HTMLInputElement;
    expect(lunch.value).toBe("13:00");
    fireEvent.change(lunch, { target: { value: "12:30" } });
    fireEvent.blur(lunch);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.anything(), { ...DEFAULT_REMINDERS, lunch: { on: true, time: "12:30" } }, "en"));
    fireEvent.click(screen.getByRole("switch", { name: "Dinner" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ dinner: { on: false, time: "20:30" } }), "en"));
    fireEvent.click(screen.getByRole("switch", { name: "Reminders on this phone" }));
    await waitFor(() => expect(disable).toHaveBeenCalled());
  });
  it("turns reminders on from Settings", async () => {
    vi.spyOn(reminders, "remindersSupported").mockReturnValue(true);
    vi.spyOn(reminders, "remindersInstallable").mockReturnValue(true);
    vi.spyOn(reminders, "remindersOnHere").mockReturnValue(false);
    const req = vi.spyOn(reminders, "requestReminders").mockResolvedValue("on");
    const flush = vi.spyOn(reminders, "flushPendingReminders").mockResolvedValue(true);
    vi.spyOn(reminders, "loadReminders").mockResolvedValue({ times: DEFAULT_REMINDERS, registered: true });
    render(<RemindersGroup />);
    fireEvent.click(screen.getByRole("switch", { name: "Reminders on this phone" }));
    await waitFor(() => expect(flush).toHaveBeenCalled());
    expect(req).toHaveBeenCalled();
  });
});
```

Add to `web/test/settings.test.tsx` a test that delete-all and sign-out clean up reminders:

```tsx
  it("stops reminders on this phone when deleting all data or signing out", async () => {
    const reminders = await import("../src/lib/reminders");
    const disable = vi.spyOn(reminders, "disableReminders").mockResolvedValue();
    const days = vi.spyOn(reminders, "deleteServerDays").mockResolvedValue();
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Delete all data" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(disable).toHaveBeenCalled());
    expect(days).toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w web -- reminders-ui settings`
Expected: FAIL, components missing.

- [ ] **Step 4: Write `web/src/components/Switch.tsx`**

```tsx
interface SwitchProps { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }

/** iOS-style switch with the semantics screen readers expect. */
export default function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-good" : "bg-sep"}`}
    >
      <span className={`absolute left-[2px] top-[2px] size-[27px] rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}
```

- [ ] **Step 5: Write `web/src/features/onboarding/RemindersScreen.tsx`**

```tsx
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_REMINDERS, REMINDER_KINDS } from "@bites/shared";
import PillButton from "../../components/PillButton";
import { dismissReminders, requestReminders } from "../../lib/reminders";

export default function RemindersScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    const result = await requestReminders(DEFAULT_REMINDERS);
    setBusy(false);
    if (result === "on") onDone();
    else setDenied(true);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]">
      <motion.div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto" initial={{ opacity: 0, y: reduce ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 400, damping: 34 }}>
        <div className="mx-auto grid size-[72px] place-items-center rounded-full bg-accent text-white">
          <Bell size={34} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-center text-large-title tracking-[-0.02em]">{t(denied ? "reminders.deniedTitle" : "reminders.title")}</h1>
        <p className="mt-3 text-center text-body text-fg-2">{t(denied ? "reminders.deniedBody" : "reminders.body")}</p>
        {!denied && (
          <ul className="mt-8 divide-y divide-sep overflow-hidden rounded-card bg-elevated">
            {REMINDER_KINDS.map((k) => (
              <li key={k} className="flex items-center justify-between px-4 py-3">
                <span className="text-body">{t(`reminders.kinds.${k}`)}</span>
                <span className="tabular text-body text-fg-2">{DEFAULT_REMINDERS[k].time}</span>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
      <div className="mx-auto w-full max-w-sm">
        {denied ? (
          <PillButton className="w-full" onClick={onDone}>{t("reminders.continue")}</PillButton>
        ) : (
          <>
            <PillButton className="w-full" onClick={() => void turnOn()} disabled={busy}>{t("reminders.turnOn")}</PillButton>
            <div className="mt-2 text-center">
              <PillButton variant="text" onClick={() => { dismissReminders(); onDone(); }}>{t("reminders.skip")}</PillButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Insert the stage in `web/src/features/onboarding/Onboarding.tsx`**

Add imports:

```tsx
import { shouldOfferReminders } from "../../lib/reminders";
import RemindersScreen from "./RemindersScreen";
```

Change the `Stage` type and the initial stage, and route the steps:

```tsx
type Stage = "install" | "camera" | "reminders" | "slides" | "questions" | "plan";
const afterCamera = (): Stage => (shouldOfferReminders() ? "reminders" : "slides");
const afterInstall = (): Stage => (shouldOfferCamera() ? "camera" : afterCamera());
```

```tsx
  const [stage, setStage] = useState<Stage>(initial ? "questions" : shouldOfferInstall() ? "install" : afterInstall());
```

```tsx
  if (stage === "install") return <InstallScreen onDone={() => setStage(afterInstall())} />;

  if (stage === "camera") return <CameraScreen onDone={() => setStage(afterCamera())} />;

  if (stage === "reminders") return <RemindersScreen onDone={() => setStage("slides")} />;
```

(`afterCamera` and `afterInstall` are module-level functions placed above the component.)

- [ ] **Step 7: Write `web/src/features/settings/RemindersGroup.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { REMINDER_KINDS, type ReminderKind, type ReminderTimes } from "@bites/shared";
import Switch from "../../components/Switch";
import { toast } from "../../components/Toast";
import {
  disableReminders, flushPendingReminders, loadReminders, remindersInstallable, remindersOnHere, remindersSupported, requestReminders, saveReminderTimes,
} from "../../lib/reminders";
import { useStore } from "../../store";

const row = "flex min-h-[52px] items-center justify-between gap-3 px-4 py-2";

export default function RemindersGroup() {
  const { t } = useTranslation();
  const repo = useStore((s) => s.repo);
  const locale = useStore((s) => s.profile?.locale ?? "system");
  const [on, setOn] = useState(remindersOnHere());
  const [times, setTimes] = useState<ReminderTimes | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ReminderKind, string>>>({});
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!on) return;
    let live = true;
    void loadReminders(repo).then((r) => live && r && setTimes(r.times));
    return () => {
      live = false;
    };
  }, [on, repo]);

  const save = async (next: ReminderTimes) => {
    setTimes(next);
    if (!(await saveReminderTimes(repo, next, locale))) toast(t("reminders.saveFailed"));
  };

  const toggleAll = async (next: boolean) => {
    setBusy(true);
    if (next) {
      const result = await requestReminders();
      if (result === "on") {
        await flushPendingReminders(repo, locale);
        setDenied(false);
        setOn(true);
      } else setDenied(result === "denied");
    } else {
      await disableReminders(repo);
      setOn(false);
      setTimes(null);
    }
    setBusy(false);
  };

  let body;
  if (!remindersSupported()) body = <p className={`${row} text-subhead text-fg-2`}>{t("reminders.unsupported")}</p>;
  else if (!remindersInstallable()) body = <p className={`${row} text-subhead text-fg-2`}>{t("reminders.needsInstall")}</p>;
  else
    body = (
      <>
        <div className={row}>
          <span className="text-body">{t("reminders.master")}</span>
          <Switch checked={on} onChange={(v) => void toggleAll(v)} label={t("reminders.master")} disabled={busy} />
        </div>
        {denied && <p className={`${row} text-subhead text-fg-2`}>{t("reminders.deniedBody")}</p>}
        {on &&
          times &&
          REMINDER_KINDS.map((k) => {
            const name = t(`reminders.kinds.${k}`);
            return (
              <div key={k} className={row}>
                <span className="text-body">{name}</span>
                <span className="flex items-center gap-3">
                  <input
                    type="time"
                    step={900}
                    aria-label={t("reminders.time", { name })}
                    value={drafts[k] ?? times[k].time}
                    disabled={!times[k].on}
                    onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                    onBlur={() => {
                      const value = drafts[k];
                      setDrafts((d) => ({ ...d, [k]: undefined }));
                      if (value && value !== times[k].time) void save({ ...times, [k]: { ...times[k], time: value } });
                    }}
                    className="tabular bg-transparent text-right text-body outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <Switch checked={times[k].on} onChange={(v) => void save({ ...times, [k]: { ...times[k], on: v } })} label={name} />
                </span>
              </div>
            );
          })}
      </>
    );

  return (
    <section className="mt-7">
      <h3 className="px-1 pb-2 text-caption uppercase tracking-wide">{t("reminders.group")}</h3>
      <div className="divide-y divide-sep overflow-hidden rounded-card bg-elevated">{body}</div>
    </section>
  );
}
```

The time input sends the raw value; `saveReminderTimes` rounds it to the quarter hour (Task 6), and the test expects `12:30`, which is already a quarter.

- [ ] **Step 8: Use it in `web/src/features/settings/SettingsSheet.tsx`**

Add imports:

```tsx
import { deleteServerDays, disableReminders } from "../../lib/reminders";
import RemindersGroup from "./RemindersGroup";
```

Render `<RemindersGroup />` right after the Plan group (inside the sheet's content, before the Account group): `{profile && <RemindersGroup />}`.

In `deleteAll`, before `await repo.clearAll();` add:

```tsx
      await Promise.all([disableReminders(repo), deleteServerDays(repo)]);
```

In `signOut`, before `await repo.signOut?.();` add:

```tsx
      await disableReminders(repo);
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -w web` then `npm run typecheck -w web`
Expected: PASS, including `locales.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/Switch.tsx web/src/features/onboarding/RemindersScreen.tsx web/src/features/onboarding/Onboarding.tsx web/src/features/settings/RemindersGroup.tsx web/src/features/settings/SettingsSheet.tsx web/src/locales/en.json web/src/locales/pt-PT.json web/test/reminders-ui.test.tsx web/test/settings.test.tsx
git commit -m "feat(web): reminders onboarding step and settings section"
```

---

### Task 8: Keep the server in sync from the app shell

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/test/reminders-shell.test.tsx`

**Interfaces:**
- Consumes: `flushPendingReminders`, `refreshTimeZone`, `syncToday` (Task 6).
- Produces: on Shell mount, pending onboarding requests are flushed and the time zone refreshed; whenever `dataVersion` or `profile` changes, today's status is sent after a 2-second debounce.

- [ ] **Step 1: Write the failing test** — `web/test/reminders-shell.test.tsx`

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import "../src/i18n";
import { macroTargets, type Profile } from "@bites/shared";
import * as reminders from "../src/lib/reminders";
import App from "../src/App";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

const profile: Profile = {
  sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain",
  kcalTarget: 2760, macroTargets: macroTargets(2760, 80, "maintain"), locale: "en", units: "kcal", createdAt: 1,
};

describe("Shell keeps reminders in sync", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const repo = new LocalRepo(`bites-shell-${Math.random()}`);
    await repo.saveProfile(profile);
    useStore.setState({ repo, profile: null, dataVersion: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("flushes onboarding requests, refreshes the time zone and sends today's status after a pause", async () => {
    const flush = vi.spyOn(reminders, "flushPendingReminders").mockResolvedValue(false);
    const tz = vi.spyOn(reminders, "refreshTimeZone").mockResolvedValue();
    const sync = vi.spyOn(reminders, "syncToday").mockResolvedValue("sent");
    render(<App skipSplash />);
    await vi.waitFor(() => expect(flush).toHaveBeenCalled());
    expect(tz).toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(sync).toHaveBeenCalledTimes(1);
    act(() => useStore.getState().bump());
    act(() => useStore.getState().bump());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w web -- reminders-shell`
Expected: FAIL, `flushPendingReminders` never called.

- [ ] **Step 3: Add the effects to `Shell` in `web/src/App.tsx`**

Add the import:

```tsx
import { flushPendingReminders, refreshTimeZone, syncToday } from "./lib/reminders";
```

Inside `function Shell()`, after the `?tab=` effect from Task 5:

```tsx
  const repo = useStore((s) => s.repo);
  const dataVersion = useStore((s) => s.dataVersion);

  // A request made during onboarding waits for the account; also follow the phone into a new time zone.
  useEffect(() => {
    if (!profile) return;
    void flushPendingReminders(repo, profile.locale).finally(() => void refreshTimeZone(repo, profile.locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  // Tell the server what's logged today so it can skip reminders and write the summary. Bursts of edits send once.
  useEffect(() => {
    if (!profile) return;
    const id = window.setTimeout(() => void syncToday(repo, profile), 2000);
    return () => window.clearTimeout(id);
  }, [repo, profile, dataVersion]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` (all workspaces) then `npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/test/reminders-shell.test.tsx
git commit -m "feat(web): flush pending reminders and sync today's status from the shell"
```

---

### Task 9: Keys, deploy and verification on a real iPhone

This task touches the owner's Cloudflare account and production. Ask the owner before each deploy, and push to `main` only when told.

**Files:**
- Modify: `worker/wrangler.toml` (`VAPID_PUBLIC_KEY` value), `web/.env` (local only, gitignored)

- [ ] **Step 1: Generate VAPID keys without printing the private key**

Run from `worker/`, writing to a scratch file outside the repo:

```bash
node -e "import('web-push-neo').then(async m => { const k = await m.generateVAPIDKeys(); require('fs').writeFileSync(process.argv[1], JSON.stringify(k)); console.log('public:', k.publicKey); })" "$SCRATCH/vapid.json"
```

(`$SCRATCH` is the session scratchpad directory.) Only the public key is shown.

- [ ] **Step 2: Store the keys**

```bash
node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).privateKey)" "$SCRATCH/vapid.json" | npx wrangler secret put VAPID_PRIVATE_KEY
```

Put the public key in `worker/wrangler.toml` as `VAPID_PUBLIC_KEY = "<public key>"` and in `web/.env` as `VITE_VAPID_PUBLIC_KEY=<public key>`. Delete `$SCRATCH/vapid.json` afterwards.

- [ ] **Step 3: Full verification before deploy**

Run: `npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 4: Deploy (after the owner says to)**

```bash
cd worker && npx wrangler deploy
```

Expected output includes `schedule: */15 * * * *`.

```bash
cd web && VITE_API_URL=https://bites-api.wellbites.workers.dev npm run build && npx wrangler deploy
```

Wait about a minute, then confirm the live bundle contains `push-sw.js` in the service worker (`/sw.js` includes `importScripts("push-sw.js")`) and that `/push-sw.js` serves JavaScript.

- [ ] **Step 5: Real-device check with the owner**

1. On the iPhone, open the installed app, go to Settings → Reminders, turn reminders on, allow notifications.
2. Temporarily set Lunch to the next quarter hour; wait for the notification; tap it and confirm it opens Scan.
3. Log a lunch, set Dinner to the next quarter hour, and confirm a dinner reminder still arrives but a re-set Lunch does not.
4. Check `npx wrangler tail bites-api` during a cron run for the `reminders {...}` log line.
5. Restore the default times.

- [ ] **Step 6: Commit the public key and push when told**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): VAPID public key for reminders"
```
