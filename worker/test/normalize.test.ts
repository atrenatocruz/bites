import { describe, it, expect } from "vitest";
import { normalizeAiOutput, NormalizeError } from "../src/normalize";

const raw = {
  is_food: true, meal_title: "Bitoque", meal_type_guess: "lunch",
  items: [
    { name: "Bife", cooking_method: "grelhado", grams: 150, kcal: 300, protein_g: 40, carbs_g: 0, fat_g: 15, fiber_g: 0, confidence: 0.8, assumption: null },
    { name: "Batata frita", cooking_method: "frita", grams: 150, kcal: 470, protein_g: 5, carbs_g: 60, fat_g: 23, fiber_g: 5, confidence: 0.7, assumption: "óleo de fritura" },
  ],
  kcal_range: { low: 650, high: 900 }, overall_confidence: 0.75,
  scale_reference_used: "prato 27 cm", follow_up_question: null, notes: null,
};

describe("normalizeAiOutput", () => {
  it("maps to camelCase and recomputes totals", () => {
    const r = normalizeAiOutput(raw);
    expect(r.title).toBe("Bitoque");
    expect(r.mealType).toBe("lunch");
    expect(r.items[1]!.cookingMethod).toBe("frita");
    expect(r.totals).toEqual({ kcal: 770, protein: 45, carbs: 60, fat: 38 });
    expect(r.scaleReference).toBe("prato 27 cm");
  });
  it("maps drink to snack", () => expect(normalizeAiOutput({ ...raw, meal_type_guess: "drink" }).mealType).toBe("snack"));
  it("clamps absurd numbers and confidence", () => {
    const r = normalizeAiOutput({ ...raw, overall_confidence: 4, items: [{ ...raw.items[0], grams: 99999, kcal: -5, confidence: -1 }] });
    expect(r.items[0]!.grams).toBe(5000);
    expect(r.items[0]!.kcal).toBeGreaterThanOrEqual(0);
    expect(r.items[0]!.confidence).toBe(0);
    expect(r.confidence).toBe(1);
  });
  it("replaces kcal with macro-derived kcal when off by more than 25%", () => {
    const r = normalizeAiOutput({ ...raw, items: [{ ...raw.items[0], kcal: 900 }] }); // macros say 295
    expect(r.items[0]!.kcal).toBe(295);
  });
  it("orders kcal range and keeps it around the total", () => {
    const r = normalizeAiOutput({ ...raw, kcal_range: { low: 900, high: 650 } });
    expect(r.kcalRange).toEqual({ low: 650, high: 900 });
  });
  it("non-food keeps items empty", () => {
    const r = normalizeAiOutput({ ...raw, is_food: false, items: [] });
    expect(r.isFood).toBe(false); expect(r.totals.kcal).toBe(0);
  });
  it("throws bad_output on wrong shape", () => {
    expect(() => normalizeAiOutput({ foo: 1 })).toThrow(NormalizeError);
    expect(() => normalizeAiOutput(null)).toThrow(NormalizeError);
  });
  it("widens kcalRange so the recomputed total sits inside it", () => {
    const low = normalizeAiOutput({ ...raw, kcal_range: { low: 100, high: 200 } });
    expect(low.totals.kcal).toBeGreaterThan(200);
    expect(low.kcalRange).toEqual({ low: 100, high: low.totals.kcal });
    const high = normalizeAiOutput({ ...raw, kcal_range: { low: 5000, high: 6000 } });
    expect(high.kcalRange).toEqual({ low: high.totals.kcal, high: 6000 });
  });
});
