import { format } from "date-fns";
import type { Locale } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DaySummary } from "@bites/shared";
import { dayStatus, parseKey, shiftKey } from "../../lib/stats";
import MiniRing from "./MiniRing";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

interface MonthCalendarProps {
  month: string;
  days: Map<string, DaySummary>;
  target: number;
  selectedDay: string;
  todayKey: string;
  streak: number;
  locale: Locale;
  onSelect: (key: string) => void;
  onShift: (months: number) => void;
}

export default function MonthCalendar({ month, days, target, selectedDay, todayKey, streak, locale, onSelect, onShift }: MonthCalendarProps) {
  const { t } = useTranslation();
  const first = parseKey(month);
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const canNext = shiftKey(month, count) <= todayKey;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => shiftKey(month, i))];

  return (
    <div className="rounded-card bg-elevated px-3 pb-3 pt-2">
      <div className="flex items-center justify-between pb-1">
        <button type="button" aria-label={t("diary.calendar.previous")} onClick={() => onShift(-1)} className="grid size-9 place-items-center rounded-full text-fg-2 active:bg-sep">
          <ChevronLeft size={20} strokeWidth={1.75} />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-headline capitalize">{format(first, "LLLL yyyy", { locale })}</span>
          {streak > 0 && <span className="text-caption">{`🔥 ${t("diary.streak", { count: streak })}`}</span>}
        </div>
        <button type="button" aria-label={t("diary.calendar.next")} disabled={!canNext} onClick={() => onShift(1)} className="grid size-9 place-items-center rounded-full text-fg-2 active:bg-sep disabled:opacity-30">
          <ChevronRight size={20} strokeWidth={1.75} />
        </button>
      </div>
      <div className="grid grid-cols-7 justify-items-center gap-y-1.5">
        {WEEKDAY_KEYS.map((wd) => (
          <span key={wd} className="text-caption">{t(`diary.weekdays.${wd}`)}</span>
        ))}
        {cells.map((key, i) => {
          if (!key) return <span key={`b${i}`} />;
          const summary = days.get(key);
          const selected = key === selectedDay;
          const future = key > todayKey;
          return (
            <button
              key={key}
              type="button"
              disabled={future}
              aria-pressed={selected}
              aria-label={format(parseKey(key), "EEEE, d MMMM", { locale })}
              onClick={() => onSelect(key)}
              className="rounded-full active:opacity-60 disabled:opacity-35"
            >
              <MiniRing kcal={summary?.kcal} target={target} status={dayStatus(summary?.kcal, target)} size={36} stroke={3.5} filled={selected}>
                <span className={`text-caption tabular !font-semibold ${selected ? "!text-bg" : key === todayKey ? "!text-accent" : "!text-fg"}`}>{parseKey(key).getDate()}</span>
              </MiniRing>
            </button>
          );
        })}
      </div>
    </div>
  );
}
