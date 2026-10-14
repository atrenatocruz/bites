import { describe, it, expect } from "vitest";
import type { DaySummary } from "@bites/shared";
import { averageKcal, bestStreak, currentStreak, dayStatus, daysOnTarget, energyUnit, formatEnergy, monthlyAverages, rangeFor } from "../src/lib/stats";

const d = (dayKey: string, kcal = 2000): DaySummary => ({ dayKey, kcal, protein: 0, carbs: 0, fat: 0, count: 1 });
const map = (...keys: string[]) => new Map(keys.map((k) => [k, d(k)]));

describe("stats", () => {
  it("classifies days with 90% and 110% boundaries inclusive in good", () => {
    expect(dayStatus(undefined, 2000)).toBe("empty");
    expect(dayStatus(0, 2000)).toBe("empty");
    expect(dayStatus(1799, 2000)).toBe("under");
    expect(dayStatus(1800, 2000)).toBe("good");
    expect(dayStatus(2200, 2000)).toBe("good");
    expect(dayStatus(2201, 2000)).toBe("over");
  });

  it("counts the current streak across a month boundary", () => {
    expect(currentStreak(map("2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"), "2026-10-02")).toBe(4);
  });

  it("keeps the streak alive when today is empty but yesterday is logged", () => {
    expect(currentStreak(map("2026-10-12", "2026-10-13"), "2026-10-14")).toBe(2);
    expect(currentStreak(map("2026-10-11"), "2026-10-14")).toBe(0);
    expect(currentStreak(new Map(), "2026-10-14")).toBe(0);
  });

  it("finds the best streak", () => {
    expect(bestStreak([])).toBe(0);
    expect(bestStreak([d("2026-09-30"), d("2026-10-01"), d("2026-10-02"), d("2026-10-05"), d("2026-10-06")])).toBe(3);
  });

  it("averages logged days only, rounded", () => {
    expect(averageKcal([])).toBe(0);
    expect(averageKcal([d("2026-10-01", 1000), d("2026-10-02", 1501)])).toBe(1251);
  });

  it("counts days on target", () => {
    expect(daysOnTarget([d("a", 2000), d("b", 1000), d("c", 2150), d("d", 3000)], 2000)).toBe(2);
  });

  it("computes 12 monthly averages with zeros for empty months", () => {
    const r = monthlyAverages([d("2026-01-05", 1800), d("2026-01-06", 2000), d("2025-01-01", 5000), d("2026-03-01", 2400)], 2026);
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual({ month: 0, avg: 1900 });
    expect(r[1]).toEqual({ month: 1, avg: 0 });
    expect(r[2]).toEqual({ month: 2, avg: 2400 });
  });

  it("builds ranges", () => {
    expect(rangeFor("week", "2026-10-14")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(rangeFor("week", "2026-10-18")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(rangeFor("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(rangeFor("year", "2026-10-14")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("formats energy in kcal or kJ", () => {
    expect(formatEnergy(2000, "kcal")).toBe("2000");
    expect(formatEnergy(100, "kj")).toBe("418");
    expect(energyUnit("kj")).toBe("kJ");
    expect(energyUnit("kcal")).toBe("kcal");
  });
});
