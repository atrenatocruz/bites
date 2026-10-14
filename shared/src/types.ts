export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type Sex = "female" | "male";
export type Goal = "lose" | "maintain" | "gain";
export type Activity = "sedentary" | "light" | "moderate" | "very";
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
