import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { format, startOfWeek } from "date-fns";
import { ChevronDown, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { enUS, pt } from "date-fns/locale";
import { dayKey, macroTargets, type DaySummary, type Meal, type MealType } from "@bites/shared";
import MealRow from "../../components/MealRow";
import { toast } from "../../components/Toast";
import { useStore } from "../../store";
import { currentStreak, energyUnit, formatEnergy, parseKey, shiftKey } from "../../lib/stats";
import MealDetailSheet from "../history/MealDetailSheet";
import DayCard from "./DayCard";
import MonthCalendar from "./MonthCalendar";
import Trends from "./Trends";
import WeekStrip from "./WeekStrip";

const DEFAULT_TARGET = 2000;
const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const firstOfMonth = (key: string) => `${key.slice(0, 7)}-01`;
const mondayOf = (key: string) => dayKey(startOfWeek(parseKey(key), { weekStartsOn: 1 }));

interface DiaryScreenProps { onOpenSettings?: () => void }

export default function DiaryScreen({ onOpenSettings }: DiaryScreenProps) {
  const { t, i18n } = useTranslation();
  const reduce = useReducedMotion();
  const repo = useStore((s) => s.repo);
  const dataVersion = useStore((s) => s.dataVersion);
  const profile = useStore((s) => s.profile);
  const selectedDay = useStore((s) => s.selectedDay);
  const setSelectedDay = useStore((s) => s.setSelectedDay);

  const todayKey = dayKey(new Date());
  const [weekStart, setWeekStart] = useState(() => mondayOf(selectedDay));
  const [month, setMonth] = useState(() => firstOfMonth(selectedDay));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [summaries, setSummaries] = useState<DaySummary[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const locale = i18n.language.startsWith("pt") ? pt : enUS;
  const target = profile?.kcalTarget ?? DEFAULT_TARGET;
  const macros = profile?.macroTargets ?? macroTargets(DEFAULT_TARGET, 70, "maintain");
  const units = profile?.units ?? "kcal";

  useEffect(() => {
    setWeekStart(mondayOf(selectedDay));
    setMonth(firstOfMonth(selectedDay));
  }, [selectedDay]);

  const years = [Number(todayKey.slice(0, 4)), Number(selectedDay.slice(0, 4)), Number(month.slice(0, 4)), Number(weekStart.slice(0, 4))];
  const fromKey = `${Math.min(...years) - 1}-01-01`;
  const toKey = `${Math.max(...years)}-12-31`;

  useEffect(() => {
    let live = true;
    void repo.daysInRange(fromKey, toKey).then((list) => live && setSummaries(list));
    return () => {
      live = false;
    };
  }, [repo, dataVersion, fromKey, toKey]);

  useEffect(() => {
    let live = true;
    void repo.mealsForDay(selectedDay).then((list) => live && setMeals(list));
    return () => {
      live = false;
    };
  }, [repo, dataVersion, selectedDay]);

  const days = useMemo(() => new Map(summaries.map((d) => [d.dayKey, d])), [summaries]);
  const streak = useMemo(() => currentStreak(days, todayKey), [days, todayKey]);
  const groups = useMemo(
    () => MEAL_ORDER.map((type) => ({ type, list: meals.filter((m) => m.mealType === type) })).filter((g) => g.list.length > 0),
    [meals],
  );

  const title = selectedDay === todayKey ? t("diary.today") : format(parseKey(selectedDay), "EEE, d MMM", { locale });

  const select = (key: string) => {
    setSelectedDay(key);
    setCalendarOpen(false);
  };

  const remove = async (meal: Meal) => {
    const { id, ...data } = meal;
    setDetailOpen(false);
    try {
      await repo.deleteMeal(id);
    } catch {
      toast(t("errors.generic"));
      return;
    }
    useStore.getState().bump();
    toast(t("history.deleted"), {
      label: t("common.undo"),
      onClick: () => {
        void repo.addMeal(data).then(() => useStore.getState().bump());
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-xl self-start pb-10">
      <header className="flex items-center justify-between pt-4">
        <button
          type="button"
          aria-expanded={calendarOpen}
          aria-label={`${title}. ${calendarOpen ? t("diary.calendar.collapse") : t("diary.calendar.expand")}`}
          onClick={() => setCalendarOpen((o) => !o)}
          className="flex items-center gap-1.5 active:opacity-60"
        >
          <h1 className="text-large-title">{title}</h1>
          <ChevronDown size={22} strokeWidth={2} className={`mt-1 text-fg-2 transition-transform duration-200 ${calendarOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t("diary.settings")} onClick={onOpenSettings} className="grid size-10 place-items-center rounded-full text-fg-2 active:bg-elevated">
          <Settings size={22} strokeWidth={1.75} />
        </button>
      </header>

      <div className="mt-3">
        <AnimatePresence initial={false} mode="wait">
          {calendarOpen ? (
            <motion.div key="month" initial={{ opacity: 0, y: reduce ? 0 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <MonthCalendar
                month={month}
                days={days}
                target={target}
                selectedDay={selectedDay}
                todayKey={todayKey}
                streak={streak}
                locale={locale}
                onSelect={select}
                onShift={(n) => setMonth((m) => firstOfMonth(shiftKey(m, n > 0 ? 32 : -1)))}
              />
            </motion.div>
          ) : (
            <motion.div key="week" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <WeekStrip
                weekStart={weekStart}
                days={days}
                target={target}
                selectedDay={selectedDay}
                todayKey={todayKey}
                locale={locale}
                onSelect={select}
                onShift={(n) => setWeekStart((w) => shiftKey(w, n * 7))}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-5">
        <DayCard summary={days.get(selectedDay)} target={target} macros={macros} units={units} />
      </div>

      <section className="mt-8">
        <h2 className="text-title">{t("diary.meals")}</h2>
        {groups.length === 0 ? (
          <p className="pt-4 text-body text-fg-2">{t("diary.noMeals")}</p>
        ) : (
          groups.map(({ type, list }) => (
            <div key={type} className="mt-4">
              <h3 className="flex items-baseline justify-between pb-1 text-subhead font-semibold">
                <span>{t(`mealType.${type}`)}</span>
                <span className="text-caption tabular">{`${formatEnergy(list.reduce((s, m) => s + m.totals.kcal, 0), units)} ${energyUnit(units)}`}</span>
              </h3>
              <ul>
                {list.map((m) => (
                  <li key={m.id}>
                    <MealRow
                      meal={m}
                      onClick={() => {
                        setSelectedMeal(m);
                        setDetailOpen(true);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <Trends days={summaries} anchor={selectedDay} target={target} units={units} streak={streak} locale={locale} />

      {selectedMeal && <MealDetailSheet key={selectedMeal.id} open={detailOpen} meal={selectedMeal} onClose={() => setDetailOpen(false)} onDelete={(m) => void remove(m)} />}
    </div>
  );
}
