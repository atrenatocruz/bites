import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AnalyzeRequest, AnalyzeResult } from "@bites/shared";
import { analyze, ANALYZE_TIMEOUT_MS, ApiError } from "../src/lib/api";

const RESULT: AnalyzeResult = {
  isFood: true, title: "Toast", mealType: "breakfast",
  items: [{ name: "Toast", cookingMethod: "toasted", grams: 60, kcal: 160, protein: 5, carbs: 30, fat: 2, fiber: 2, confidence: 0.9, assumption: null }],
  totals: { kcal: 160, protein: 5, carbs: 30, fat: 2 }, kcalRange: { low: 140, high: 180 }, confidence: 0.9,
  scaleReference: null, followUpQuestion: null, notes: null,
};
const REQ: AnalyzeRequest = { text: "toast", locale: "en", localTime: "08:00" };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("analyze", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the result on 200", async () => {
    fetchMock.mockResolvedValue(reply(200, RESULT));
    expect(await analyze(REQ, null)).toEqual(RESULT);
    expect(fetchMock.mock.calls[0]![0]).toContain("/api/analyze");
  });

  it("throws not_food carrying the result on 422", async () => {
    fetchMock.mockResolvedValue(reply(422, { error: "not_food", result: { ...RESULT, isFood: false } }));
    const err = await analyze(REQ, null).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("not_food");
    expect(err.result.isFood).toBe(false);
  });

  it("maps 429, 401, 400 and 502", async () => {
    for (const [status, body, code] of [
      [429, { error: "rate_limited" }, "rate_limited"],
      [401, { error: "unauthorized" }, "unauthorized"],
      [400, { error: "bad_request" }, "bad_request"],
      [502, { error: "upstream" }, "upstream"],
    ] as const) {
      fetchMock.mockResolvedValueOnce(reply(status, body));
      const err = await analyze(REQ, null).catch((e) => e);
      expect(err.code).toBe(code);
    }
  });

  it("treats an unreadable error body as upstream", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 500 }));
    const err = await analyze(REQ, null).catch((e) => e);
    expect(err.code).toBe("upstream");
  });

  it("is offline without fetching when navigator.onLine is false", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const err = await analyze(REQ, null).catch((e) => e);
    expect(err.code).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is offline when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await analyze(REQ, null).catch((e) => e);
    expect(err.code).toBe("offline");
  });

  it("sends the bearer token and a stable device id", async () => {
    fetchMock.mockImplementation(async () => reply(200, RESULT));
    await analyze(REQ, "x");
    await analyze(REQ, null);
    const first = new Headers(fetchMock.mock.calls[0]![1].headers);
    const second = new Headers(fetchMock.mock.calls[1]![1].headers);
    expect(first.get("authorization")).toBe("Bearer x");
    expect(second.get("authorization")).toBeNull();
    expect(first.get("x-device-id")).toBeTruthy();
    expect(first.get("x-device-id")).toBe(second.get("x-device-id"));
    expect(localStorage.getItem("bites.device")).toBe(first.get("x-device-id"));
  });

  it("gives up with an upstream error when the server never answers", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
      const pending = analyze(REQ, "x").catch((e) => e);
      await vi.advanceTimersByTimeAsync(ANALYZE_TIMEOUT_MS + 10);
      const err = await pending;
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("upstream");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still reports offline for other network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(analyze(REQ, "x")).rejects.toMatchObject({ code: "offline" });
  });
});
