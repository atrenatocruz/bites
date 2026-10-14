import type { Activity, FoodItem, Goal, MacroTargets, MealType, Profile, Sex, Totals } from "./types";

export const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 };
const GOAL_DELTA: Record<Goal, number> = { lose: -400, maintain: 0, gain: 300 };
const round1 = (n: number) => Math.round(n * 10) / 10;

export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

export function kcalTarget(p: Pick<Profile, "sex" | "birthYear" | "heightCm" | "weightKg" | "activity" | "goal">, now = new Date()): number {
  const age = now.getFullYear() - p.birthYear;
  const tdee = bmr(p.sex, p.weightKg, p.heightCm, age) * ACTIVITY_FACTOR[p.activity];
  const floor = p.sex === "male" ? 1500 : 1200;
  return Math.max(floor, Math.round((tdee + GOAL_DELTA[p.goal]) / 10) * 10);
}

export function macroTargets(kcal: number, weightKg: number, goal: Goal): MacroTargets {
  const protein = Math.round(weightKg * (goal === "maintain" ? 1.6 : 1.8));
  const fat = Math.round((kcal * 0.28) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { protein, carbs, fat };
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return round1(weightKg / (m * m));
}

export function scaleItem(item: FoodItem, grams: number): FoodItem {
  const g = Math.max(0, Math.round(grams));
  const r = item.grams > 0 ? g / item.grams : 0;
  return {
    ...item, grams: g,
    kcal: Math.round(item.kcal * r),
    protein: round1(item.protein * r), carbs: round1(item.carbs * r),
    fat: round1(item.fat * r), fiber: round1(item.fiber * r),
  };
}

export function sumTotals(items: Pick<FoodItem, "kcal" | "protein" | "carbs" | "fat">[]): Totals {
  const t = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  return { kcal: Math.round(t.kcal), protein: round1(t.protein), carbs: round1(t.carbs), fat: round1(t.fat) };
}

export function macroKcal(t: Pick<Totals, "protein" | "carbs" | "fat">): number {
  return t.protein * 4 + t.carbs * 4 + t.fat * 9;
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function guessMealType(d: Date): MealType {
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= 300 && m < 660) return "breakfast";
  if (m >= 660 && m < 900) return "lunch";
  if (m >= 900 && m < 1110) return "snack";
  if (m >= 1110 && m < 1380) return "dinner";
  return "snack";
}
