import { describe, it, expect, vi } from "vitest";
import { handleAnalyze, type Deps } from "../src/analyze";
import type { Env } from "../src/env";
import { MOCK_RESULT } from "../src/mock";

const raw = {
  is_food: true, meal_title: "Bitoque", meal_type_guess: "lunch",
  items: [
    { name: "Bife", cooking_method: "grelhado", grams: 150, kcal: 300, protein_g: 40, carbs_g: 0, fat_g: 15, fiber_g: 0, confidence: 0.8, assumption: null },
    { name: "Batata frita", cooking_method: "frita", grams: 150, kcal: 470, protein_g: 5, carbs_g: 60, fat_g: 23, fiber_g: 5, confidence: 0.7, assumption: "óleo de fritura" },
  ],
  kcal_range: { low: 650, high: 900 }, overall_confidence: 0.75,
  scale_reference_used: "prato 27 cm", follow_up_question: null, notes: null,
};

function makeEnv(over: Partial<Env> = {}, plan: "free" | "paid" = "paid"): Env {
  const store = new Map<string, string>(plan === "paid" ? [["plan:uid1", "paid"]] : []);
  const RATE_KV = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } as unknown as KVNamespace;
  return { ANTHROPIC_API_KEY: "k", RATE_KV, ...over };
}
function makeDeps(over: Partial<Deps> = {}): Deps {
  return {
    callClaude: vi.fn(async () => ({ kind: "ok", json: raw }) as const),
    callWorkersAi: vi.fn(async () => ({ kind: "ok", json: raw }) as const),
    verifyRequest: vi.fn(async () => "uid1"),
    now: () => new Date("2026-10-14T12:00:00Z"),
    ...over,
  };
}
const post = (body: unknown) => new Request("http://x/api/analyze", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const ok = { text: "bitoque", locale: "pt-PT", localTime: "13:00" };

describe("handleAnalyze", () => {
  it("400 on invalid json", async () => {
    expect((await handleAnalyze(post("{nope"), makeEnv(), makeDeps())).status).toBe(400);
  });
  it("400 without image or text", async () => {
    expect((await handleAnalyze(post({ locale: "en", localTime: "10:00" }), makeEnv(), makeDeps())).status).toBe(400);
  });
  it("400 when image too large", async () => {
    const r = await handleAnalyze(post({ ...ok, image: "a".repeat(2_000_001) }), makeEnv(), makeDeps());
    expect(r.status).toBe(400);
  });
  it("401 when unauthenticated", async () => {
    const r = await handleAnalyze(post(ok), makeEnv(), makeDeps({ verifyRequest: async () => null }));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "unauthorized" });
  });
  it("429 after the daily limit", async () => {
    const env = makeEnv({ DAILY_LIMIT: "1" });
    const deps = makeDeps();
    expect((await handleAnalyze(post(ok), env, deps)).status).toBe(200);
    const r = await handleAnalyze(post(ok), env, deps);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "rate_limited", plan: "paid" });
  });
  it("paid plan uses Claude, not Workers AI", async () => {
    const deps = makeDeps();
    expect((await handleAnalyze(post(ok), makeEnv(), deps)).status).toBe(200);
    expect(deps.callClaude).toHaveBeenCalledTimes(1);
    expect(deps.callWorkersAi).not.toHaveBeenCalled();
  });
  it("free plan uses Workers AI, not Claude", async () => {
    const deps = makeDeps();
    const r = await handleAnalyze(post(ok), makeEnv({}, "free"), deps);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).title).toBe("Bitoque");
    expect(deps.callWorkersAi).toHaveBeenCalledTimes(1);
    expect(deps.callClaude).not.toHaveBeenCalled();
  });
  it("free plan stops after 5 scans a day by default, paid has its own limit", async () => {
    const free = makeEnv({}, "free");
    const deps = makeDeps();
    for (let i = 0; i < 5; i++) expect((await handleAnalyze(post(ok), free, deps)).status).toBe(200);
    const r = await handleAnalyze(post(ok), free, deps);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "rate_limited", plan: "free" });
    const paid = makeEnv({ DAILY_LIMIT: "30", FREE_DAILY_LIMIT: "1" });
    for (let i = 0; i < 6; i++) expect((await handleAnalyze(post(ok), paid, deps)).status).toBe(200);
  });
  it("FREE_DAILY_LIMIT overrides the free default", async () => {
    const env = makeEnv({ FREE_DAILY_LIMIT: "1" }, "free");
    const deps = makeDeps();
    expect((await handleAnalyze(post(ok), env, deps)).status).toBe(200);
    expect((await handleAnalyze(post(ok), env, deps)).status).toBe(429);
  });
  it("502 when Workers AI throws on the free plan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleAnalyze(post(ok), makeEnv({}, "free"), makeDeps({ callWorkersAi: async () => { throw new Error("boom"); } }));
    expect(r.status).toBe(502);
  });
  it("200 with normalized body", async () => {
    const r = await handleAnalyze(post(ok), makeEnv(), makeDeps());
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body.title).toBe("Bitoque");
    expect(body.totals.kcal).toBe(770);
  });
  it("422 not_food with result", async () => {
    const deps = makeDeps({ callClaude: async () => ({ kind: "ok", json: { ...raw, is_food: false, items: [] } }) });
    const r = await handleAnalyze(post(ok), makeEnv(), deps);
    expect(r.status).toBe(422);
    const body = (await r.json()) as any;
    expect(body.error).toBe("not_food");
    expect(body.result.isFood).toBe(false);
  });
  it("422 refusal", async () => {
    const r = await handleAnalyze(post(ok), makeEnv(), makeDeps({ callClaude: async () => ({ kind: "refusal" }) }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "refusal" });
  });
  it("422 bad_output on truncated", async () => {
    const r = await handleAnalyze(post(ok), makeEnv(), makeDeps({ callClaude: async () => ({ kind: "truncated" }) }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "bad_output" });
  });
  it("422 bad_output on malformed json", async () => {
    const r = await handleAnalyze(post(ok), makeEnv(), makeDeps({ callClaude: async () => ({ kind: "ok", json: { foo: 1 } }) }));
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "bad_output" });
  });
  it("MOCK_AI returns the mock without calling Claude", async () => {
    const deps = makeDeps();
    const r = await handleAnalyze(post(ok), makeEnv({ MOCK_AI: "1" }), deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(MOCK_RESULT);
    expect(deps.callClaude).not.toHaveBeenCalled();
  });
  it("502 when Claude throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleAnalyze(post(ok), makeEnv(), makeDeps({ callClaude: async () => { throw new Error("boom"); } }));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "upstream" });
  });
  it("400 when hint, text or localTime are not strings, before counting the rate limit", async () => {
    const env = makeEnv({ DAILY_LIMIT: "1" });
    for (const bad of [{ hint: 5 }, { text: { a: 1 } }, { localTime: 1300 }]) {
      const r = await handleAnalyze(post({ ...ok, ...bad }), env, makeDeps());
      expect(r.status).toBe(400);
    }
    const r = await handleAnalyze(post(ok), env, makeDeps());
    expect(r.status).toBe(200);
  });

  describe("failed scans do not use up the daily limit", () => {
    const freeOne = () => makeEnv({ FREE_DAILY_LIMIT: "1" }, "free");
    const thenWorks = async (env: Env, failing: Partial<Deps>) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const first = await handleAnalyze(post(ok), env, makeDeps(failing));
      expect(first.status).not.toBe(200);
      expect((await handleAnalyze(post(ok), env, makeDeps())).status).toBe(200);
    };
    it("after the AI throws or times out", () => thenWorks(freeOne(), { callWorkersAi: async () => { throw new Error("timed out"); } }));
    it("after a refusal", () => thenWorks(freeOne(), { callWorkersAi: async () => ({ kind: "refusal" }) }));
    it("after truncated output", () => thenWorks(freeOne(), { callWorkersAi: async () => ({ kind: "truncated" }) }));
    it("after output that cannot be read", () => thenWorks(freeOne(), { callWorkersAi: async () => ({ kind: "ok", json: { foo: 1 } }) }));
    it("on the paid plan too", () => thenWorks(makeEnv({ DAILY_LIMIT: "1" }), { callClaude: async () => { throw new Error("boom"); } }));

    it("but a real answer, even not food, still counts", async () => {
      const env = freeOne();
      const notFood = makeDeps({ callWorkersAi: async () => ({ kind: "ok", json: { ...raw, is_food: false, items: [] } }) });
      expect((await handleAnalyze(post(ok), env, notFood)).status).toBe(422);
      expect((await handleAnalyze(post(ok), env, makeDeps())).status).toBe(429);
    });
    it("many failures in a row never block the person", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const env = freeOne();
      const broken = makeDeps({ callWorkersAi: async () => { throw new Error("x"); } });
      for (let i = 0; i < 6; i++) expect((await handleAnalyze(post(ok), env, broken)).status).toBe(502);
      expect((await handleAnalyze(post(ok), env, makeDeps())).status).toBe(200);
    });
  });
});
