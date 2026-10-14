import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { dayKey, type DaySummary } from "@bites/shared";

export type DayStatus = "empty" | "under" | "good" | "over";

export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function shiftKey(key: string, days: number): string {
  return dayKey(addDays(parseKey(key), days));
}

export function dayStatus(kcal: number | undefined, target: number): DayStatus {
  if (!kcal || kcal <= 0) return "empty";
  if (kcal * 10 < target * 9) return "under";
  if (kcal * 10 > target * 11) return "over";
  return "good";
}

function streakBackFrom(days: Map<string, DaySummary>, start: string): number {
  let n = 0;
  for (let k = start; days.has(k); k = shiftKey(k, -1)) n++;
  return n;
}

export function currentStreak(days: Map<string, DaySummary>, today: string): number {
  return days.has(today) ? streakBackFrom(days, today) : streakBackFrom(days, shiftKey(today, -1));
}

export function bestStreak(days: DaySummary[]): number {
  const keys = [...new Set(days.map((d) => d.dayKey))].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    run = prev !== null && shiftKey(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

export function averageKcal(days: DaySummary[]): number {
  if (days.length === 0) return 0;
  return Math.round(days.reduce((s, d) => s + d.kcal, 0) / days.length);
}

export function daysOnTarget(days: DaySummary[], target: number): number {
  return days.filter((d) => dayStatus(d.kcal, target) === "good").length;
}

export function monthlyAverages(days: DaySummary[], year: number): { month: number; avg: number }[] {
  return Array.from({ length: 12 }, (_, month) => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    return { month, avg: averageKcal(days.filter((d) => d.dayKey.startsWith(prefix))) };
  });
}

export function rangeFor(period: "week" | "month" | "year", anchor: string): { from: string; to: string } {
  const d = parseKey(anchor);
  if (period === "week") return { from: dayKey(startOfWeek(d, { weekStartsOn: 1 })), to: dayKey(endOfWeek(d, { weekStartsOn: 1 })) };
  if (period === "month") return { from: dayKey(startOfMonth(d)), to: dayKey(endOfMonth(d)) };
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
}

export function formatEnergy(kcal: number, units: "kcal" | "kj" = "kcal"): string {
  return String(units === "kj" ? Math.round(kcal * 4.184) : Math.round(kcal));
}

export function energyUnit(units: "kcal" | "kj" = "kcal"): "kcal" | "kJ" {
  return units === "kj" ? "kJ" : "kcal";
}
