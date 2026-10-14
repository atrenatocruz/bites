import { lazy, Suspense, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { useTranslation } from "react-i18next";
import type { DaySummary } from "@bites/shared";
import { averageKcal, bestStreak, daysOnTarget, energyUnit, formatEnergy, monthlyAverages, parseKey, rangeFor, shiftKey } from "../../lib/stats";

const TrendsChart = lazy(() => import("./TrendsChart"));

type Period = "week" | "month" | "year";
const PERIODS: Period[] = ["week", "month", "year"];

interface TrendsProps {
  days: DaySummary[];
  anchor: string;
  target: number;
  units: "kcal" | "kj";
  streak: number;
  locale: Locale;
}

function Stat({ title, value, caption }: { title: string; value: string; caption?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-2xl bg-elevated px-3 py-3">
      <span className="truncate text-caption">{title}</span>
      <span className="mt-1 text-title tabular">{value}</span>
      <span className="truncate text-caption">{caption ?? " "}</span>
    </div>
  );
}

export default function Trends({ days, anchor, target, units, streak, locale }: TrendsProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [period, setPeriod] = useState<Period>("week");
  const { from, to } = useMemo(() => rangeFor(period, anchor), [period, anchor]);
  const inRange = useMemo(() => days.filter((d) => d.dayKey >= from && d.dayKey <= to), [days, from, to]);

  const data = useMemo(() => {
    if (period === "year") {
      const year = parseKey(anchor).getFullYear();
      return monthlyAverages(days, year).map((m) => ({ label: format(new Date(year, m.month, 1), "LLLLL", { locale }).toUpperCase(), kcal: m.avg }));
    }
    const byKey = new Map(inRange.map((d) => [d.dayKey, d.kcal]));
    const count = period === "week" ? 7 : parseKey(to).getDate();
    return Array.from({ length: count }, (_, i) => {
      const key = shiftKey(from, i);
      const date = parseKey(key);
      return { label: period === "week" ? format(date, "EEEEE", { locale }).toUpperCase() : String(date.getDate()), kcal: Math.round(byKey.get(key) ?? 0) };
    });
  }, [period, anchor, days, inRange, from, to, locale]);

  const unit = energyUnit(units);
  const hasData = inRange.length > 0;

  return (
    <section className="mt-8">
      <h2 className="text-title">{t("diary.trends.title")}</h2>
      <div role="group" aria-label={t("diary.trends.title")} className="mt-3 flex rounded-full bg-elevated p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            onClick={() => setPeriod(p)}
            className={`h-8 flex-1 rounded-full text-subhead font-semibold transition-colors ${period === p ? "bg-bg shadow-sm" : "text-fg-2"}`}
          >
            {t(`diary.trends.${p}`)}
          </button>
        ))}
      </div>

      <div className="mt-4" role="img" aria-label={t("diary.trends.chartLabel", { period: t(`diary.trends.${period}`) })}>
        {hasData ? (
          <Suspense fallback={<div className="h-44" />}>
            <TrendsChart data={data} target={target} targetLabel={t("diary.trends.targetLine")} interval={period === "month" ? 4 : 0} radius={period === "month" ? 3 : 6} animate={!reduce} />
          </Suspense>
        ) : (
          <div className="grid h-44 place-items-center text-body text-fg-2">{t("diary.trends.noData")}</div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Stat title={t("diary.trends.average")} value={formatEnergy(averageKcal(inRange), units)} caption={unit} />
        <Stat title={t("diary.trends.daysOnTarget")} value={String(daysOnTarget(inRange, target))} caption={t("diary.trends.ofLogged", { count: inRange.length })} />
        <Stat title={t("diary.trends.streak")} value={`${streak > 0 ? "🔥 " : ""}${streak}`} caption={t("diary.trends.best", { count: bestStreak(days) })} />
      </div>
    </section>
  );
}
