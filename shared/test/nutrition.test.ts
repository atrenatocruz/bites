import { describe, it, expect } from "vitest";
import { bmr, kcalTarget, macroTargets, scaleItem, sumTotals, macroKcal, dayKey, guessMealType, bmi, weeksToGoal } from "../src";
import type { FoodItem } from "../src";

const rice: FoodItem = { name: "Rice", cookingMethod: "boiled", grams: 150, kcal: 195, protein: 4, carbs: 42, fat: 0.5, fiber: 0.6, confidence: 0.8, assumption: null };

describe("bmr", () => {
  it("Mifflin-St Jeor male", () => expect(bmr("male", 80, 180, 30)).toBe(1780));
  it("Mifflin-St Jeor female", () => expect(bmr("female", 60, 165, 30)).toBe(1320.25));
});

describe("kcalTarget", () => {
  const base = { sex: "male" as const, birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate" as const };
  const now = new Date(2026, 9, 14);
  it("maintain = tdee rounded to 10", () => expect(kcalTarget({ ...base, goal: "maintain" }, now)).toBe(2760));
  it("lose = tdee - 400", () => expect(kcalTarget({ ...base, goal: "lose" }, now)).toBe(2360));
  it("gain = tdee + 300", () => expect(kcalTarget({ ...base, goal: "gain" }, now)).toBe(3060));
  it("never below floor", () =>
    expect(kcalTarget({ sex: "female", birthYear: 1950, heightCm: 150, weightKg: 45, activity: "sedentary", goal: "lose" }, now)).toBe(1200));
});

describe("kcalTarget with the onboarding extras", () => {
  const base = { sex: "male" as const, birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate" as const };
  const now = new Date(2026, 9, 14);
  it("pace sets the deficit: 0.5 kg a week is 550 kcal", () => expect(kcalTarget({ ...base, goal: "lose", pace: "steady" }, now)).toBe(2210));
  it("a faster pace lowers the target further", () => expect(kcalTarget({ ...base, goal: "lose", pace: "fast" }, now)).toBeLessThan(kcalTarget({ ...base, goal: "lose", pace: "slow" }, now)));
  it("an active job raises the activity factor", () => expect(kcalTarget({ ...base, goal: "maintain", workType: "active" }, now)).toBe(2940));
  it("pregnancy removes any deficit", () => expect(kcalTarget({ ...base, goal: "lose", pace: "fast", health: "pregnant" }, now)).toBe(2760));
  it("breastfeeding removes the deficit and adds 330 kcal", () => expect(kcalTarget({ ...base, goal: "lose", pace: "fast", health: "breastfeeding" }, now)).toBe(3090));
});

describe("weeksToGoal", () => {
  it("rounds up whole weeks", () => expect(weeksToGoal("lose", 80, 70, "steady")).toBe(20));
  it("works for gaining", () => expect(weeksToGoal("gain", 60, 65, "steady")).toBe(20));
  it("is null when maintaining or the target is on the wrong side", () => {
    expect(weeksToGoal("maintain", 80, 70, "steady")).toBeNull();
    expect(weeksToGoal("lose", 80, 85, "steady")).toBeNull();
    expect(weeksToGoal("lose", 80, undefined, "steady")).toBeNull();
  });
});

describe("macroTargets", () => {
  it("splits kcal into protein/fat/carbs grams", () => {
    const m = macroTargets(2000, 70, "maintain");
    expect(m.protein).toBe(112);
    expect(m.fat).toBe(62);
    expect(m.carbs).toBe(249);
  });
  it("uses 1.8 g/kg when losing", () => expect(macroTargets(2000, 70, "lose").protein).toBe(126));
});

describe("scaleItem", () => {
  it("scales proportionally", () => {
    const s = scaleItem(rice, 300);
    expect(s.grams).toBe(300); expect(s.kcal).toBe(390); expect(s.carbs).toBe(84); expect(s.fat).toBe(1);
  });
  it("clamps negative grams to 0", () => expect(scaleItem(rice, -10).kcal).toBe(0));
  it("handles items with 0 grams by keeping values at 0", () => expect(scaleItem({ ...rice, grams: 0, kcal: 0 }, 100).kcal).toBe(0));
});

describe("sumTotals", () => {
  it("sums and rounds", () => expect(sumTotals([rice, rice])).toEqual({ kcal: 390, protein: 8, carbs: 84, fat: 1 }));
  it("empty is zero", () => expect(sumTotals([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 }));
});

describe("misc", () => {
  it("macroKcal", () => expect(macroKcal({ protein: 10, carbs: 10, fat: 10 })).toBe(170));
  it("dayKey uses local date", () => expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05"));
  it("guessMealType", () => {
    expect(guessMealType(new Date(2026, 0, 1, 8))).toBe("breakfast");
    expect(guessMealType(new Date(2026, 0, 1, 13))).toBe("lunch");
    expect(guessMealType(new Date(2026, 0, 1, 17))).toBe("snack");
    expect(guessMealType(new Date(2026, 0, 1, 20))).toBe("dinner");
    expect(guessMealType(new Date(2026, 0, 1, 2))).toBe("snack");
  });
  it("bmi one decimal", () => expect(bmi(80, 180)).toBe(24.7));
});
