import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { bmr, dayKey, type DaySummary, type HealthDay } from "@bites/shared";
import { createKey, deficitFor, fetchActivity, isStale, periodActivity, runShortcutUrl, useActivity } from "../src/lib/activity";
import { shiftKey } from "../src/lib/stats";

const body = { sex: "male", weightKg: 80, heightCm: 180, birthYear: 1996 } as const;
const hd = (restingKcal: number | null, activeKcal: number | null, workouts: HealthDay["workouts"] = []): HealthDay => ({ restingKcal, activeKcal, workouts });
const sum = (key: string, kcal: number): DaySummary => ({ dayKey: key, kcal, protein: 0, carbs: 0, fat: 0, count: 1 });

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
    const expected = Math.round(bmr("male", 80, 180, 30) + 300);
    expect(deficitFor(hd(null, 300), 0, body, 2026)).toEqual({ burned: expected, eaten: 0, deficit: expected, estimated: true });
  });
  it("treats zero resting energy as not measured", () => {
    expect(deficitFor(hd(0, 300), 0, body, 2026)?.estimated).toBe(true);
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

  it("asks for at most the last 400 days, which is all the server keeps", async () => {
    ios();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const today = dayKey(new Date());
    renderHook(() => useActivity("2020-01-01", "2030-12-31", async () => "tok"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url).toContain(`from=${shiftKey(today, -399)}&to=${today}`);
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
