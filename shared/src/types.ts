export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type Sex = "female" | "male";
export type Goal = "lose" | "maintain" | "gain";
export type Activity = "sedentary" | "light" | "moderate" | "very";
export type Pace = "slow" | "steady" | "fast";
export type WorkType = "desk" | "mixed" | "active";
export type Health = "none" | "pregnant" | "breastfeeding" | "condition";
export interface Totals { kcal: number; protein: number; carbs: number; fat: number }
export interface FoodItem {
  name: string; cookingMethod: string; grams: number;
  kcal: number; protein: number; carbs: number; fat: number; fiber: number;
  confidence: number; assumption: string | null;
}
export interface Meal {
  id: string; createdAt: number; dayKey: string; mealType: MealType; title: string;
  thumb: string | null; items: FoodItem[]; totals: Totals; source: "photo" | "text"; edited: boolean;
}
export interface DaySummary extends Totals { dayKey: string; count: number }
export interface MacroTargets { protein: number; carbs: number; fat: number }
export interface Profile {
  sex: Sex; birthYear: number; heightCm: number; weightKg: number; activity: Activity; goal: Goal;
  targetWeightKg?: number; pace?: Pace; workType?: WorkType; sleepHours?: number; health?: Health;
  kcalTarget: number; macroTargets: MacroTargets;
  locale: "system" | "pt-PT" | "en"; units: "kcal" | "kj"; createdAt: number;
}
export interface AnalyzeRequest {
  image?: string;
  text?: string;
  hint?: string;
  locale: "pt-PT" | "en";
  localTime: string;
}
export interface AnalyzeResult {
  isFood: boolean; title: string; mealType: MealType; items: FoodItem[]; totals: Totals;
  kcalRange: { low: number; high: number }; confidence: number;
  scaleReference: string | null; followUpQuestion: string | null; notes: string | null;
}
export type AnalyzeError = "not_food" | "refusal" | "bad_output" | "rate_limited" | "unauthorized" | "bad_request" | "upstream";
/** One workout as sent by the Apple Health Shortcut. */
export interface HealthWorkout { type: string; start: string; minutes: number; kcal: number | null }
/** One day of Apple Health data. Energy is in kcal; null when Health had no samples. */
export interface HealthDay { restingKcal: number | null; activeKcal: number | null; workouts: HealthWorkout[] }
/** GET /api/activity response. */
export interface ActivityResponse {
  days: Record<string, HealthDay>;
  lastSync: { syncedAt: number; tz: string } | null;
  hasKey: boolean;
}
