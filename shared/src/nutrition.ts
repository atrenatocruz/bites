import type { Activity, FoodItem, Goal, Health, MacroTargets, MealType, Pace, Profile, Sex, Totals, WorkType } from "./types";

export const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725 };
const GOAL_DELTA: Record<Goal, number> = { lose: -400, maintain: 0, gain: 300 };
const round1 = (n: number) => Math.round(n * 10) / 10;

export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

/** Weekly weight change in kg for each pace; about 7700 kcal per kg of body weight. */
export const PACE_KG_PER_WEEK: Record<Exclude<Goal, "maintain">, Record<Pace, number>> = {
  lose: { slow: 0.25, steady: 0.5, fast: 0.75 },
  gain: { slow: 0.15, steady: 0.25, fast: 0.4 },
};
/** Extra activity factor for a job that keeps you on your feet. */
export const WORK_BONUS: Record<WorkType, number> = { desk: 0, mixed: 0.05, active: 0.1 };
const BREASTFEEDING_KCAL = 330;

type PlanInput = Pick<Profile, "sex" | "birthYear" | "heightCm" | "weightKg" | "activity" | "goal"> &
  Partial<Pick<Profile, "pace" | "workType" | "health">>;

function dailyDelta(goal: Goal, pace: Pace | undefined, health: Health | undefined): number {
  const sign = goal === "lose" ? -1 : 1;
  const base = goal === "maintain" ? 0 : pace ? sign * Math.round((PACE_KG_PER_WEEK[goal][pace] * 7700) / 7) : GOAL_DELTA[goal];
  if (health === "pregnant") return Math.max(0, base);
  if (health === "breastfeeding") return Math.max(0, base) + BREASTFEEDING_KCAL;
  return base;
}

export function kcalTarget(p: PlanInput, now = new Date()): number {
  const age = now.getFullYear() - p.birthYear;
  const factor = ACTIVITY_FACTOR[p.activity] + WORK_BONUS[p.workType ?? "desk"];
  const tdee = bmr(p.sex, p.weightKg, p.heightCm, age) * factor;
  const floor = p.sex === "male" ? 1500 : 1200;
  return Math.max(floor, Math.round((tdee + dailyDelta(p.goal, p.pace, p.health)) / 10) * 10);
}

/** Whole weeks to get from the current to the target weight, or null when it does not apply. */
export function weeksToGoal(goal: Goal, weightKg: number, targetKg: number | undefined, pace: Pace | undefined): number | null {
  if (goal === "maintain" || targetKg === undefined || !pace) return null;
  const diff = goal === "lose" ? weightKg - targetKg : targetKg - weightKg;
  return diff > 0 ? Math.ceil(diff / PACE_KG_PER_WEEK[goal][pace]) : null;
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
