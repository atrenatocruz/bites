import { format } from "date-fns";
import type { Locale } from "date-fns";
import { useTranslation } from "react-i18next";
import type { ActivityResponse, HealthDay } from "@bites/shared";
import { deficitFor, isStale, runShortcutUrl, type BodyProfile } from "../../lib/activity";
import { energyUnit, formatEnergy } from "../../lib/stats";

interface ActivityCardProps {
  day: HealthDay | undefined;
  eatenKcal: number;
  isToday: boolean;
  lastSync: ActivityResponse["lastSync"];
  profile: BodyProfile | null;
  year: number;
  units: "kcal" | "kj";
  locale: Locale;
  now?: number;
}

/** Shortcuts reports workout types in the phone's language, so match both. */
function workoutIcon(type: string): string {
  const t = type.toLowerCase();
  if (/run|corr/.test(t)) return "🏃";
  if (/walk|caminh|hik/.test(t)) return "🚶";
  if (/cycl|bike|cicl|bicic/.test(t)) return "🚴";
  if (/swim|nata/.test(t)) return "🏊";
  if (/strength|força|forca|weight|muscul/.test(t)) return "🏋️";
  if (/yoga|pilates/.test(t)) return "🧘";
  return "💪";
}

function Figure({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span className="text-caption">{label}</span>
      <span className={`text-title tabular ${tone ?? ""}`}>{value}</span>
      <span className="text-caption">{unit}</span>
    </div>
  );
}

export default function ActivityCard({ day, eatenKcal, isToday, lastSync, profile, year, units, locale, now = Date.now() }: ActivityCardProps) {
  const { t } = useTranslation();
  const unit = energyUnit(units);
  const d = deficitFor(day, eatenKcal, profile, year);
  const notes = [isToday ? t("activity.soFar") : null, d?.estimated ? t("activity.estimated") : null].filter(Boolean).join(" · ");

  return (
    <section className="mt-3 rounded-card bg-elevated p-5">
      <h2 className="text-headline">{t("activity.title")}</h2>
      {d ? (
        <>
          <div className="mt-3 flex gap-2">
            <Figure label={t("activity.burned")} value={formatEnergy(d.burned, units)} unit={unit} />
            <Figure label={t("activity.ate")} value={formatEnergy(d.eaten, units)} unit={unit} />
            {d.deficit >= 0 ? (
              <Figure label={t("activity.deficit")} value={formatEnergy(d.deficit, units)} unit={unit} tone="text-accent-text" />
            ) : (
              <Figure label={t("activity.surplus")} value={`+${formatEnergy(-d.deficit, units)}`} unit={unit} tone="text-over" />
            )}
          </div>
          {notes && <p className="mt-2 text-center text-caption">{notes}</p>}
          {day && day.workouts.length > 0 ? (
            <ul className="mt-4 divide-y divide-sep">
              {day.workouts.map((w, i) => (
                <li key={`${w.start}-${i}`} className="flex items-center gap-3 py-2">
                  <span aria-hidden="true" className="text-title">{workoutIcon(w.type)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{w.type}</span>
                    <span className="block text-subhead tabular text-fg-2">{t("activity.workoutLine", { time: format(new Date(w.start), "HH:mm"), minutes: w.minutes })}</span>
                  </span>
                  {w.kcal !== null && <span className="text-subhead tabular text-fg-2">{`${formatEnergy(w.kcal, units)} ${unit}`}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-body text-fg-2">{t("activity.noWorkouts")}</p>
          )}
        </>
      ) : (
        <p className="mt-3 text-body text-fg-2">{t("activity.noData")}</p>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-caption">{lastSync ? t("activity.synced", { when: format(lastSync.syncedAt, "d MMM, HH:mm", { locale }) }) : t("activity.neverSynced")}</span>
        {isStale(lastSync, now) && (
          <a href={runShortcutUrl()} className="text-subhead font-semibold text-accent-text active:opacity-60">
            {t("activity.sync")}
          </a>
        )}
      </div>
    </section>
  );
}
