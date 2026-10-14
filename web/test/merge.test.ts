import { describe, it, expect } from "vitest";
import type { Meal } from "@bites/shared";
import { LocalRepo } from "../src/lib/repo/local";
import { mergeMeals } from "../src/lib/repo/merge";

let n = 0;
const meal = (id: string, dayKey: string, createdAt: number, kcal: number): Meal => ({
  id, createdAt, dayKey, mealType: "lunch", title: id, thumb: null, items: [],
  totals: { kcal, protein: 10, carbs: 20, fat: 5 }, source: "text", edited: false,
});

describe("mergeMeals", () => {
  it("re-adds meals to the target and keeps day aggregates right", async () => {
    const target = new LocalRepo(`bites-merge-${++n}`);
    await target.addMeal({ ...meal("x", "2026-03-02", 1, 100), id: undefined } as never);
    const count = await mergeMeals(target, [meal("a", "2026-03-02", 3, 300), meal("b", "2026-03-03", 2, 200)]);
    expect(count).toBe(2);
    expect((await target.listMeals()).length).toBe(3);
    const days = await target.daysInRange("2026-03-01", "2026-03-31");
    expect(days.find((d) => d.dayKey === "2026-03-02")).toMatchObject({ kcal: 400, count: 2 });
    expect(days.find((d) => d.dayKey === "2026-03-03")).toMatchObject({ kcal: 200, count: 1 });
  });

  it("does nothing for an empty list", async () => {
    const target = new LocalRepo(`bites-merge-${++n}`);
    expect(await mergeMeals(target, [])).toBe(0);
    expect(await target.listMeals()).toEqual([]);
  });
});
