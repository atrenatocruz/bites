import { useEffect, useState } from "react";
import { bmr, dayKey, type ActivityResponse, type DaySummary, type HealthDay, type Profile } from "@bites/shared";
import { authedJson } from "./api";
import { detectPlatform } from "./install";
import { shiftKey } from "./stats";

export const SHORTCUT_NAME = "Bites Health";
const CACHE_KEY = "bites.activity";
const STALE_MS = 24 * 60 * 60 * 1000;
/** The server keeps about 400 days, so asking for more only costs reads. */
const KEPT_DAYS = 400;

export type BodyProfile = Pick<Profile, "sex" | "weightKg" | "heightCm" | "birthYear">;
export interface Deficit { burned: number; eaten: number; deficit: number; estimated: boolean }

/** The shared iCloud link to the Shortcut; empty until the owner has built and shared it. */
export const shortcutUrl = (): string => import.meta.env.VITE_HEALTH_SHORTCUT_URL ?? "";
/** Opening the app with ?health=setup shows Connect before the Shortcut link exists, so the owner can get a key to build it. */
export const healthSetupMode = () => typeof location !== "undefined" && new URLSearchParams(location.search).get("health") === "setup";
export const runShortcutUrl = () => `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
/** Apple Health can only be reached through Shortcuts, which exist on iPhone and iPad. */
export const healthAvailable = () => detectPlatform() === "ios";

export async function createKey(token: string | null): Promise<string | null> {
  try {
    const r = await authedJson<{ key: string }>("/api/activity/key", { method: "POST" }, token);
    return r.ok && typeof r.body?.key === "string" ? r.body.key : null;
  } catch {
    return null;
  }
}

export async function deleteKey(token: string | null): Promise<boolean> {
  try {
    return (await authedJson("/api/activity/key", { method: "DELETE" }, token)).ok;
  } catch {
    return false;
  }
}

export async function deleteAllActivity(token: string | null): Promise<boolean> {
  try {
    return (await authedJson("/api/activity", { method: "DELETE" }, token)).ok;
  } catch {
    return false;
  }
}

export async function fetchActivity(from: string, to: string, token: string | null): Promise<ActivityResponse | null> {
  try {
    const r = await authedJson<ActivityResponse>(`/api/activity?from=${from}&to=${to}`, { method: "GET" }, token);
    return r.ok && r.body && typeof r.body.days === "object" ? r.body : null;
  } catch {
    return null;
  }
}

/** Burned (Health resting + active) minus eaten. Null when the day has no Health energy at all. */
export function deficitFor(day: HealthDay | undefined, eatenKcal: number, profile: BodyProfile | null, year: number): Deficit | null {
  if (!day || (day.restingKcal === null && day.activeKcal === null)) return null;
  // Health sums to 0 when nothing was measured (no Apple Watch), so 0 resting energy means unknown.
  let resting = day.restingKcal && day.restingKcal > 0 ? day.restingKcal : null;
  let estimated = false;
  if (resting === null) {
    if (!profile) return null;
    resting = bmr(profile.sex, profile.weightKg, profile.heightCm, year - profile.birthYear);
    estimated = true;
  }
  const burned = Math.round(resting + (day.activeKcal ?? 0));
  const eaten = Math.round(eatenKcal);
  return { burned, eaten, deficit: burned - eaten, estimated };
}

/** Average deficit over days with both Health data and logged meals, and the number of workouts, for [from, to]. */
export function periodActivity(days: Record<string, HealthDay>, summaries: DaySummary[], from: string, to: string, profile: BodyProfile | null) {
  const eaten = new Map(summaries.map((s) => [s.dayKey, s.kcal]));
  let total = 0;
  let counted = 0;
  let workouts = 0;
  for (let key = from; key <= to; key = shiftKey(key, 1)) {
    const day = days[key];
    if (!day) continue;
    workouts += day.workouts.length;
    const kcal = eaten.get(key);
    if (kcal === undefined) continue;
    const d = deficitFor(day, kcal, profile, Number(key.slice(0, 4)));
    if (!d) continue;
    total += d.deficit;
    counted += 1;
  }
  return { avgDeficit: counted ? Math.round(total / counted) : null, workouts };
}

export const isStale = (lastSync: ActivityResponse["lastSync"], now: number) => !lastSync || now - lastSync.syncedAt > STALE_MS;

/** Forget the cached Health data, e.g. when the person deletes everything or signs out. */
export function clearActivityCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing cached, or storage blocked.
  }
}

function readCache(): ActivityResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ActivityResponse) : null;
  } catch {
    return null;
  }
}

/** Health data for [from, to], trimmed to the days the server keeps. Starts from the last cached answer, refetches on range change and when the app comes back to the foreground (e.g. after running the Shortcut). */
export function useActivity(from: string, to: string, getToken: () => Promise<string | null>): ActivityResponse | null {
  const enabled = healthAvailable();
  const [data, setData] = useState<ActivityResponse | null>(() => (enabled ? readCache() : null));
  const today = dayKey(new Date());
  const start = from > shiftKey(today, 1 - KEPT_DAYS) ? from : shiftKey(today, 1 - KEPT_DAYS);
  const end = to < today ? to : today;

  useEffect(() => {
    if (!enabled || start > end) return;
    let live = true;
    const load = async () => {
      const next = await fetchActivity(start, end, await getToken().catch(() => null));
      if (!live || !next) return;
      setData(next);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked: the in-memory copy still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
    // getToken is a stable repo method; refetching on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, start, end]);

  return data;
}
