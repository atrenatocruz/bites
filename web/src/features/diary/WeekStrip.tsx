import { useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { useTranslation } from "react-i18next";
import type { DaySummary } from "@bites/shared";
import { dayStatus, parseKey, shiftKey } from "../../lib/stats";
import MiniRing from "./MiniRing";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

interface WeekStripProps {
  weekStart: string;
  days: Map<string, DaySummary>;
  target: number;
  selectedDay: string;
  todayKey: string;
  locale: Locale;
  onSelect: (key: string) => void;
  onShift: (weeks: number) => void;
  workoutDays?: Set<string>;
}

export default function WeekStrip({ weekStart, days, target, selectedDay, todayKey, locale, onSelect, onShift, workoutDays }: WeekStripProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const dir = useRef(0);
  const isCurrentWeek = shiftKey(weekStart, 7) > todayKey;

  const shift = (weeks: number) => {
    if (weeks > 0 && isCurrentWeek) return;
    dir.current = weeks;
    onShift(weeks);
  };

  return (
    <div className="relative">
      <button type="button" className="sr-only" onClick={() => shift(-1)}>
        {t("diary.calendar.previous")}
      </button>
      <motion.div
        key={weekStart}
        className="flex touch-pan-y justify-between"
        initial={{ opacity: 0, x: reduce ? 0 : dir.current * 28 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        drag="x"
        dragSnapToOrigin
        dragElastic={0.2}
        dragConstraints={{ left: 0, right: 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.x > 48) shift(-1);
          else if (info.offset.x < -48) shift(1);
        }}
      >
        {WEEKDAY_KEYS.map((wd, i) => {
          const key = shiftKey(weekStart, i);
          const date = parseKey(key);
          const summary = days.get(key);
          const selected = key === selectedDay;
          const future = key > todayKey;
          return (
            <button
              key={key}
              type="button"
              disabled={future}
              aria-pressed={selected}
              aria-label={workoutDays?.has(key) ? t("activity.workoutDay", { date: format(date, "EEEE, d MMMM", { locale }) }) : format(date, "EEEE, d MMMM", { locale })}
              onClick={() => onSelect(key)}
              className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1 transition-opacity active:opacity-60 disabled:opacity-35"
            >
              <span className={`text-caption ${selected ? "!text-fg" : ""}`}>{t(`diary.weekdays.${wd}`)}</span>
              <MiniRing kcal={summary?.kcal} target={target} status={dayStatus(summary?.kcal, target)} size={40} stroke={4} filled={selected}>
                <span className={`text-subhead tabular font-semibold ${selected ? "text-bg" : key === todayKey ? "text-accent-text" : ""}`}>{date.getDate()}</span>
              </MiniRing>
              <span aria-hidden="true" className={`size-1 rounded-full ${workoutDays?.has(key) ? "bg-accent" : "bg-transparent"}`} />
            </button>
          );
        })}
      </motion.div>
      <button type="button" className="sr-only" disabled={isCurrentWeek} onClick={() => shift(1)}>
        {t("diary.calendar.next")}
      </button>
    </div>
  );
}
