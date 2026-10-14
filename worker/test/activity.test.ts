import { describe, it, expect } from "vitest";
import { handleCreateKey, handleDeleteKey, handleSync } from "../src/activity";
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
    const res = await sync({ tz: "Europe/Lisbon", days: [day("2026-10-05"), day("2026-10-14", { workouts: [run] })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, days: 2 });
    expect(month(store, "2026-10").days["2026-10-05"]).toEqual({ restingKcal: 1700, activeKcal: 450, workouts: [] });
    expect(month(store, "2026-10").days["2026-10-14"].workouts).toEqual([run]);
    expect(JSON.parse(store.get("activity:u1:last")!)).toEqual({ syncedAt: NOW.getTime(), tz: "Europe/Lisbon" });
  });

  it("splits days across a month boundary into two buckets", async () => {
    const { store, deps, env, key } = await connect();
    const early = { ...deps, now: () => new Date("2026-11-02T20:00:00Z") };
    const res = await handleSync(
      req("/api/activity/sync", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ days: [day("2026-10-31"), day("2026-11-01")] }) }),
      env,
      early,
    );
    expect(res.status).toBe(200);
    expect(Object.keys(month(store, "2026-10").days)).toEqual(["2026-10-31"]);
    expect(Object.keys(month(store, "2026-11").days)).toEqual(["2026-11-01"]);
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
    expect((await sync({ days: Array.from({ length: 9 }, (_, i) => day(`2026-10-${10 + i}`)) })).status).toBe(400);
    expect((await sync({ days: [day("2026-10-03")] })).status).toBe(400); // older than 10 days
    expect((await sync({ days: [day("2026-10-16")] })).status).toBe(400); // more than 1 day ahead
    expect((await sync({ days: [day("2026-10-14", { activeKcal: 20_001 })] })).status).toBe(400);
    expect((await sync({ days: [day("2026-10-14", { activeKcal: -1 })] })).status).toBe(400);
    expect((await sync({ days: [day("2026-10-14", { activeKcal: "abc" })] })).status).toBe(400);
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
