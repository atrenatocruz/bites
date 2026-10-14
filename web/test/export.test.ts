import { describe, it, expect } from "vitest";
import type { Meal } from "@bites/shared";
import { toCSV, toJSON } from "../src/lib/export";

const meal = (id: string, title: string, createdAt: number, dayKey: string): Meal => ({
  id, createdAt, dayKey, mealType: "lunch", title, thumb: null,
  items: [], totals: { kcal: 520, protein: 31.5, carbs: 60, fat: 14.2 }, source: "photo", edited: false,
});

describe("toCSV", () => {
  const at = new Date(2026, 9, 14, 13, 5).getTime();

  it("writes the header and one row per meal", () => {
    const csv = toCSV([meal("a", "Salad", at, "2026-10-14"), meal("b", "Soup", at, "2026-10-14")]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("date,time,meal_type,title,kcal,protein_g,carbs_g,fat_g");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2026-10-14,13:05,lunch,Salad,520,31.5,60,14.2");
  });

  it("quotes titles containing commas, quotes and newlines", () => {
    const csv = toCSV([meal("a", 'Rice, beans and "chicken"', at, "2026-10-14")]);
    expect(csv.trim().split("\n")[1]).toBe('2026-10-14,13:05,lunch,"Rice, beans and ""chicken""",520,31.5,60,14.2');
  });

  it("returns only the header for no meals", () => {
    expect(toCSV([]).trim()).toBe("date,time,meal_type,title,kcal,protein_g,carbs_g,fat_g");
  });
});

describe("toJSON", () => {
  it("serialises profile and meals", () => {
    const out = JSON.parse(toJSON({ profile: null, meals: [meal("a", "Salad", 1, "2026-10-14")] }));
    expect(out.profile).toBeNull();
    expect(out.meals[0].title).toBe("Salad");
  });
});
