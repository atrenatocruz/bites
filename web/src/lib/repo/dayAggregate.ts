import type { DaySummary, Totals } from "@bites/shared";

const macro = (n: number) => Math.max(0, Math.round(n * 10) / 10);

export function applyDayDelta(cur: DaySummary | undefined, dayKey: string, delta: Totals, countDelta: number): DaySummary | null {
  const count = (cur?.count ?? 0) + countDelta;
  if (count <= 0) return null;
  return {
    dayKey,
    kcal: Math.max(0, Math.round((cur?.kcal ?? 0) + delta.kcal)),
    protein: macro((cur?.protein ?? 0) + delta.protein),
    carbs: macro((cur?.carbs ?? 0) + delta.carbs),
    fat: macro((cur?.fat ?? 0) + delta.fat),
    count,
  };
}
