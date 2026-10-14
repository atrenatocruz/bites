import { describe, it, expect, beforeEach } from "vitest";
import type { Meal, Profile } from "@bites/shared";
import { LocalRepo } from "../src/lib/repo/local";

let n = 0;
let repo: LocalRepo;
beforeEach(() => { repo = new LocalRepo(`bites-test-${++n}`); });

const totals = (kcal: number) => ({ kcal, protein: kcal / 10, carbs: kcal / 10, fat: kcal / 20 });
const mk = (over: Partial<Omit<Meal, "id">> = {}): Omit<Meal, "id"> => ({
  createdAt: 1000, dayKey: "2026-10-14", mealType: "lunch", title: "Rice and chicken", thumb: null,
  items: [{ name: "Rice", cookingMethod: "boiled", grams: 150, kcal: 200, protein: 4, carbs: 44, fat: 0.4, fiber: 1, confidence: 0.8, assumption: null }],
  totals: totals(200), source: "photo", edited: false, ...over,
});
const profile: Profile = {
  sex: "female", birthYear: 1990, heightCm: 165, weightKg: 60, activity: "light", goal: "maintain",
  kcalTarget: 2000, macroTargets: { protein: 120, carbs: 230, fat: 65 }, locale: "system", units: "kcal", createdAt: 1,
};

describe("LocalRepo", () => {
  it("reports kind and no token", async () => {
    expect(repo.kind).toBe("local");
    expect(await repo.getIdToken()).toBeNull();
  });

  it("addMeal is reflected in mealsForDay and daysInRange", async () => {
    const a = await repo.addMeal(mk());
    await repo.addMeal(mk({ createdAt: 2000, totals: totals(300) }));
    expect(a.id).toBeTruthy();
    expect((await repo.mealsForDay("2026-10-14")).map((m) => m.createdAt)).toEqual([1000, 2000]);
    expect(await repo.daysInRange("2026-10-01", "2026-10-31")).toEqual([
      { dayKey: "2026-10-14", kcal: 500, protein: 50, carbs: 50, fat: 25, count: 2 },
    ]);
    expect(await repo.getMeal(a.id)).toEqual(a);
    expect(await repo.getMeal("nope")).toBeNull();
  });

  it("daysInRange is inclusive and skips empty days", async () => {
    await repo.addMeal(mk({ dayKey: "2026-10-10" }));
    await repo.addMeal(mk({ dayKey: "2026-10-12" }));
    await repo.addMeal(mk({ dayKey: "2026-10-14" }));
    const days = await repo.daysInRange("2026-10-10", "2026-10-12");
    expect(days.map((d) => d.dayKey)).toEqual(["2026-10-10", "2026-10-12"]);
  });

  it("updateMeal adjusts the day by the delta", async () => {
    const m = await repo.addMeal(mk());
    await repo.updateMeal({ ...m, totals: totals(260), edited: true });
    const [day] = await repo.daysInRange("2026-10-14", "2026-10-14");
    expect(day).toMatchObject({ kcal: 260, count: 1 });
    expect((await repo.getMeal(m.id))?.edited).toBe(true);
  });

  it("updateMeal moving dayKey moves totals between days", async () => {
    const m = await repo.addMeal(mk());
    await repo.addMeal(mk({ createdAt: 3000, totals: totals(100) }));
    await repo.updateMeal({ ...m, dayKey: "2026-10-13" });
    expect(await repo.daysInRange("2026-10-13", "2026-10-14")).toEqual([
      { dayKey: "2026-10-13", kcal: 200, protein: 20, carbs: 20, fat: 10, count: 1 },
      { dayKey: "2026-10-14", kcal: 100, protein: 10, carbs: 10, fat: 5, count: 1 },
    ]);
  });

  it("deleteMeal removes the day row when it was the last meal", async () => {
    const a = await repo.addMeal(mk());
    const b = await repo.addMeal(mk({ createdAt: 2000 }));
    await repo.deleteMeal(a.id);
    expect((await repo.daysInRange("2026-10-14", "2026-10-14"))[0]).toMatchObject({ kcal: 200, count: 1 });
    await repo.deleteMeal(b.id);
    expect(await repo.daysInRange("2026-10-14", "2026-10-14")).toEqual([]);
    expect(await repo.mealsForDay("2026-10-14")).toEqual([]);
  });

  it("listMeals is newest first and paginates with before/limit", async () => {
    for (const t of [1000, 2000, 3000, 4000]) await repo.addMeal(mk({ createdAt: t }));
    expect((await repo.listMeals()).map((m) => m.createdAt)).toEqual([4000, 3000, 2000, 1000]);
    expect((await repo.listMeals({ limit: 2 })).map((m) => m.createdAt)).toEqual([4000, 3000]);
    expect((await repo.listMeals({ before: 3000, limit: 2 })).map((m) => m.createdAt)).toEqual([2000, 1000]);
  });

  it("round-trips the profile", async () => {
    expect(await repo.getProfile()).toBeNull();
    await repo.saveProfile(profile);
    expect(await repo.getProfile()).toEqual(profile);
  });

  it("exportAll returns profile and meals; clearAll empties everything", async () => {
    await repo.saveProfile(profile);
    await repo.addMeal(mk());
    const all = await repo.exportAll();
    expect(all.profile).toEqual(profile);
    expect(all.meals).toHaveLength(1);
    await repo.clearAll();
    expect(await repo.getProfile()).toBeNull();
    expect(await repo.listMeals()).toEqual([]);
    expect(await repo.daysInRange("2000-01-01", "2100-01-01")).toEqual([]);
  });
});
