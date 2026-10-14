import type { DaySummary, Meal, Profile } from "@bites/shared";

export interface AccountInfo { anonymous: boolean; email: string | null }

export interface Repo {
  kind: "local" | "firebase";
  getProfile(): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;
  addMeal(m: Omit<Meal, "id">): Promise<Meal>;
  updateMeal(m: Meal): Promise<void>;
  deleteMeal(id: string): Promise<void>;
  getMeal(id: string): Promise<Meal | null>;
  listMeals(opts?: { limit?: number; before?: number }): Promise<Meal[]>;
  mealsForDay(dayKey: string): Promise<Meal[]>;
  daysInRange(fromKey: string, toKey: string): Promise<DaySummary[]>;
  exportAll(): Promise<{ profile: Profile | null; meals: Meal[] }>;
  clearAll(): Promise<void>;
  getIdToken(): Promise<string | null>;
  getAccount?(): Promise<AccountInfo>;
  signInWithGoogle?(): Promise<void>;
  signOut?(): Promise<void>;
}
