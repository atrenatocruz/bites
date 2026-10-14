import type { Meal } from "@bites/shared";
import type { Repo } from "./types";

export async function mergeMeals(target: Pick<Repo, "addMeal">, meals: Meal[]): Promise<number> {
  const ordered = [...meals].sort((a, b) => a.createdAt - b.createdAt);
  for (const { id: _id, ...data } of ordered) await target.addMeal(data);
  return ordered.length;
}
