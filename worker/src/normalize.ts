import { sumTotals, macroKcal, type AnalyzeResult, type FoodItem, type MealType } from "@bites/shared";

export class NormalizeError extends Error { code = "bad_output" as const }

const clamp = (n: unknown, lo: number, hi: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(hi, Math.max(lo, v));
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const nstr = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export function normalizeAiOutput(raw: unknown): AnalyzeResult {
  if (!raw || typeof raw !== "object") throw new NormalizeError("not an object");
  const o = raw as Record<string, any>;
  if (typeof o.is_food !== "boolean" || !Array.isArray(o.items)) throw new NormalizeError("missing fields");

  const items: FoodItem[] = o.is_food ? o.items.slice(0, 20).map((i: any) => {
    const protein = r1(clamp(i?.protein_g, 0, 1000)), carbs = r1(clamp(i?.carbs_g, 0, 1000)), fat = r1(clamp(i?.fat_g, 0, 1000));
    let kcal = Math.round(clamp(i?.kcal, 0, 10000));
    const derived = Math.round(macroKcal({ protein, carbs, fat }));
    if (derived > 20 && Math.abs(kcal - derived) / derived > 0.25) kcal = derived;
    return {
      name: str(i?.name, 60) || "?", cookingMethod: str(i?.cooking_method, 40),
      grams: Math.round(clamp(i?.grams, 0, 5000)), kcal, protein, carbs, fat,
      fiber: r1(clamp(i?.fiber_g, 0, 200)), confidence: r1(clamp(i?.confidence, 0, 1)),
      assumption: nstr(i?.assumption, 120),
    };
  }) : [];

  const totals = sumTotals(items);
  const lo = clamp(o.kcal_range?.low, 0, 20000), hi = clamp(o.kcal_range?.high, 0, 20000);
  const mt = o.meal_type_guess === "drink" ? "snack" : MEAL_TYPES.includes(o.meal_type_guess) ? o.meal_type_guess : "snack";

  const low = Math.round(Math.min(lo, hi)), high = Math.round(Math.max(lo, hi));

  return {
    isFood: o.is_food && items.length > 0,
    title: str(o.meal_title, 60), mealType: mt, items, totals,
    kcalRange: { low: Math.min(low, totals.kcal), high: Math.max(high, totals.kcal) },
    confidence: r1(clamp(o.overall_confidence, 0, 1)),
    scaleReference: nstr(o.scale_reference_used, 80),
    followUpQuestion: nstr(o.follow_up_question, 140),
    notes: nstr(o.notes, 240),
  };
}
