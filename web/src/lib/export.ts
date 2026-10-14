import { format } from "date-fns";
import type { Meal, Profile } from "@bites/shared";

const HEADER = "date,time,meal_type,title,kcal,protein_g,carbs_g,fat_g";

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCSV(meals: Meal[]): string {
  const rows = meals.map((m) =>
    [m.dayKey, format(m.createdAt, "HH:mm"), m.mealType, cell(m.title), m.totals.kcal, m.totals.protein, m.totals.carbs, m.totals.fat].join(","),
  );
  return [HEADER, ...rows].join("\n") + "\n";
}

export function toJSON(data: { profile: Profile | null; meals: Meal[] }): string {
  return JSON.stringify(data, null, 2);
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
