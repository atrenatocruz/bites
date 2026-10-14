import { describe, it, expect } from "vitest";
import { applyDayDelta } from "../src/lib/repo/dayAggregate";

describe("applyDayDelta", () => {
  it("creates", () => expect(applyDayDelta(undefined, "2026-10-14", { kcal: 500, protein: 20, carbs: 50, fat: 20 }, 1))
    .toEqual({ dayKey: "2026-10-14", kcal: 500, protein: 20, carbs: 50, fat: 20, count: 1 }));
  it("subtracts and never goes negative", () => expect(applyDayDelta({ dayKey: "d", kcal: 100, protein: 1, carbs: 1, fat: 1, count: 2 }, "d", { kcal: -150, protein: -2, carbs: -1, fat: -1 }, -1))
    .toEqual({ dayKey: "d", kcal: 0, protein: 0, carbs: 0, fat: 0, count: 1 }));
  it("returns null when count hits 0", () => expect(applyDayDelta({ dayKey: "d", kcal: 100, protein: 1, carbs: 1, fat: 1, count: 1 }, "d", { kcal: -100, protein: -1, carbs: -1, fat: -1 }, -1)).toBeNull());
  it("rounds kcal to an integer and macros to 0.1", () => expect(applyDayDelta(undefined, "d", { kcal: 100.6, protein: 1.26, carbs: 2.04, fat: 0.05 }, 1))
    .toEqual({ dayKey: "d", kcal: 101, protein: 1.3, carbs: 2, fat: 0.1, count: 1 }));
});
