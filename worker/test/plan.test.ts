import { describe, it, expect, vi } from "vitest";
import { dailyLimit, getPlan } from "../src/plan";
import { callWorkersAi } from "../src/workersai";
import type { Env } from "../src/env";

const kv = (v: string | null) => ({ get: async () => v }) as unknown as Pick<KVNamespace, "get">;

describe("getPlan", () => {
  it("is paid only for the exact value", async () => {
    expect(await getPlan(kv("paid"), "u")).toBe("paid");
    expect(await getPlan(kv(null), "u")).toBe("free");
    expect(await getPlan(kv("PAID"), "u")).toBe("free");
  });
});

describe("dailyLimit", () => {
  it("defaults to 30 paid and 5 free", () => {
    expect(dailyLimit("paid", {})).toBe(30);
    expect(dailyLimit("free", {})).toBe(5);
  });
  it("reads the env values and ignores junk", () => {
    expect(dailyLimit("paid", { DAILY_LIMIT: "50" })).toBe(50);
    expect(dailyLimit("free", { FREE_DAILY_LIMIT: "2" })).toBe(2);
    expect(dailyLimit("free", { FREE_DAILY_LIMIT: "abc" })).toBe(5);
    expect(dailyLimit("free", { FREE_DAILY_LIMIT: "" })).toBe(5);
  });
});

describe("callWorkersAi", () => {
  const req = { image: "AAAA", locale: "en" as const, localTime: "12:00" };
  const envWith = (run: (m: string, i: any) => Promise<unknown>) => ({ AI: { run } }) as unknown as Env;

  it("sends the photo as a data URL with the schema and returns the parsed object", async () => {
    const run = vi.fn(async () => ({ response: { is_food: true } }));
    const out = await callWorkersAi(req, envWith(run));
    expect(out).toEqual({ kind: "ok", json: { is_food: true } });
    const [model, input] = run.mock.calls[0] as unknown as [string, any];
    expect(model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(input.messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
    expect(input.response_format.type).toBe("json_schema");
  });
  it("parses a JSON string response", async () => {
    expect(await callWorkersAi(req, envWith(async () => ({ response: '{"a":1}' })))).toEqual({ kind: "ok", json: { a: 1 } });
  });
  it("reports truncated for unparsable or empty output", async () => {
    expect(await callWorkersAi(req, envWith(async () => ({ response: "not json" })))).toEqual({ kind: "truncated" });
    expect(await callWorkersAi(req, envWith(async () => ({})))).toEqual({ kind: "truncated" });
  });
  it("gives up when Workers AI never answers, instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      const hang = { AI: { run: () => new Promise(() => {}) }, FREE_AI_TIMEOUT_MS: "5000" } as unknown as Env;
      const pending = callWorkersAi(req, hang).catch((e) => e);
      await vi.advanceTimersByTimeAsync(5001);
      expect(((await pending) as Error).message).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });
  it("asks for compact output and a low temperature", async () => {
    const run = vi.fn(async () => ({ response: {} }));
    await callWorkersAi(req, envWith(run));
    const input = (run.mock.calls[0] as unknown as [string, any])[1];
    expect(input.temperature).toBe(0.2);
    expect(input.max_tokens).toBeLessThanOrEqual(1500);
    expect(input.messages[1].content[1].text).toContain("compact JSON");
  });
  it("throws when the AI binding is missing", async () => {
    await expect(callWorkersAi(req, {} as Env)).rejects.toThrow();
  });
});
