import { describe, it, expect } from "vitest";
import { handlePlan, handleRedeem, handleSetPlan, sha256Hex, type PlanDeps } from "../src/redeem";
import type { Env } from "../src/env";

const HASH = "33a476a898298d1ec4da66385586df87d236d7dc982d0743ade1786e5b3a9fa4";

function makeEnv(over: Partial<Env> = {}) {
  const store = new Map<string, string>();
  const RATE_KV = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } as unknown as KVNamespace;
  return { env: { ANTHROPIC_API_KEY: "k", RATE_KV: Object.assign(RATE_KV, { delete: async (k: string) => { store.delete(k); } }), REDEEM_CODE_HASHES: HASH, ...over } as Env, store };
}
const deps = (uid: string | null = "uid1"): PlanDeps => ({ verifyRequest: async () => uid, now: () => new Date("2026-10-14T12:00:00Z") });
const post = (body: unknown) => new Request("http://x/api/redeem", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("sha256Hex", () => {
  it("matches the configured hash for the real code", async () => expect(await sha256Hex("renatonaprozis")).toBe(HASH));
});

describe("handleRedeem", () => {
  it("upgrades the user to paid with the right code", async () => {
    const { env, store } = makeEnv();
    const r = await handleRedeem(post({ code: "renatonaprozis" }), env, deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, plan: "paid", dailyLimit: 30, unlocked: true });
    expect(store.get("plan:uid1")).toBe("paid");
    expect(store.get("unlocked:uid1")).toBe("1");
  });
  it("ignores case and surrounding spaces", async () => {
    const { env, store } = makeEnv();
    expect((await handleRedeem(post({ code: "  RenatoNaProzis " }), env, deps())).status).toBe(200);
    expect(store.get("plan:uid1")).toBe("paid");
  });
  it("rejects a wrong code without changing the plan", async () => {
    const { env, store } = makeEnv();
    const r = await handleRedeem(post({ code: "nope" }), env, deps());
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_code" });
    expect(store.has("plan:uid1")).toBe(false);
  });
  it("accepts nothing when no codes are configured", async () => {
    const { env } = makeEnv({ REDEEM_CODE_HASHES: undefined });
    expect((await handleRedeem(post({ code: "renatonaprozis" }), env, deps())).status).toBe(400);
  });
  it("401 when unauthenticated", async () => {
    const { env } = makeEnv();
    expect((await handleRedeem(post({ code: "renatonaprozis" }), env, deps(null))).status).toBe(401);
  });
  it("400 on a missing, non-string or oversized code", async () => {
    const { env } = makeEnv();
    for (const bad of ["{nope", {}, { code: 5 }, { code: "" }, { code: "a".repeat(65) }]) expect((await handleRedeem(post(bad), env, deps())).status).toBe(400);
  });
  it("429 after 10 guesses a day, even for the right code", async () => {
    const { env } = makeEnv();
    for (let i = 0; i < 10; i++) expect((await handleRedeem(post({ code: `guess${i}` }), env, deps())).status).toBe(400);
    expect((await handleRedeem(post({ code: "renatonaprozis" }), env, deps())).status).toBe(429);
  });
});

describe("handlePlan", () => {
  const get = () => new Request("http://x/api/plan");
  it("reports free with the free limit by default", async () => {
    const { env } = makeEnv();
    expect(await (await handlePlan(get(), env, deps())).json()).toEqual({ plan: "free", dailyLimit: 5, unlocked: false });
  });
  it("reports paid after redeeming", async () => {
    const { env } = makeEnv();
    await handleRedeem(post({ code: "renatonaprozis" }), env, deps());
    expect(await (await handlePlan(get(), env, deps())).json()).toEqual({ plan: "paid", dailyLimit: 30, unlocked: true });
  });
  it("401 when unauthenticated", async () => {
    const { env } = makeEnv();
    expect((await handlePlan(get(), env, deps(null))).status).toBe(401);
  });
});

describe("handleSetPlan", () => {
  const set = (plan: unknown) => new Request("http://x/api/plan", { method: "POST", body: JSON.stringify({ plan }) });

  it("refuses paid until Premium is unlocked", async () => {
    const { env, store } = makeEnv();
    const r = await handleSetPlan(set("paid"), env, deps());
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "locked" });
    expect(store.has("plan:uid1")).toBe(false);
  });
  it("lets an unlocked user switch off and on", async () => {
    const { env, store } = makeEnv();
    await handleRedeem(post({ code: "renatonaprozis" }), env, deps());
    expect(await (await handleSetPlan(set("free"), env, deps())).json()).toEqual({ plan: "free", dailyLimit: 5, unlocked: true });
    expect(store.has("plan:uid1")).toBe(false);
    expect(await (await handleSetPlan(set("paid"), env, deps())).json()).toEqual({ plan: "paid", dailyLimit: 30, unlocked: true });
    expect(store.get("plan:uid1")).toBe("paid");
  });
  it("remembers a hand-set paid plan when switching to free", async () => {
    const { env, store } = makeEnv();
    store.set("plan:uid1", "paid");
    await handleSetPlan(set("free"), env, deps());
    expect(store.get("unlocked:uid1")).toBe("1");
    expect((await handleSetPlan(set("paid"), env, deps())).status).toBe(200);
  });
  it("400 on a bad plan and 401 when unauthenticated", async () => {
    const { env } = makeEnv();
    expect((await handleSetPlan(set("gold"), env, deps())).status).toBe(400);
    expect((await handleSetPlan(set("free"), env, deps(null))).status).toBe(401);
  });
});
