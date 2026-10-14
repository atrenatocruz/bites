import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { enUS, pt } from "date-fns/locale";
import { format } from "date-fns";
import { dayKey, type Meal } from "@bites/shared";
import MealRow from "../../components/MealRow";
import Logo from "../../components/Logo";
import { useStore } from "../../store";
import MealDetailSheet from "./MealDetailSheet";
import { useRemoveMeal } from "./useRemoveMeal";
import { energyUnit, formatEnergy } from "../../lib/stats";

const PAGE = 50;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function matches(meal: Meal, q: string) {
  return fold(meal.title).includes(q) || meal.items.some((i) => fold(i.name).includes(q));
}

function SwipeRow({ meal, onOpen, onDelete }: { meal: Meal; onOpen: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const dragged = useRef(false);
  return (
    <li className="relative overflow-hidden">
      <span className="absolute inset-y-0 right-0 flex items-center text-subhead text-fg-2" aria-hidden="true">
        {t("common.delete")}
      </span>
      <motion.div
        className="relative bg-bg"
        drag={reduce ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          setTimeout(() => {
            dragged.current = false;
          }, 0);
          if (info.offset.x < -80) onDelete();
        }}
      >
        <MealRow meal={meal} onClick={() => !dragged.current && onOpen()} />
      </motion.div>
    </li>
  );
}

export default function HistoryScreen() {
  const { t, i18n } = useTranslation();
  const repo = useStore((s) => s.repo);
  const units = useStore((s) => s.profile?.units ?? "kcal");
  const dataVersion = useStore((s) => s.dataVersion);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Meal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const mealsRef = useRef(meals);
  mealsRef.current = meals;

  useEffect(() => {
    let live = true;
    const limit = Math.max(PAGE, mealsRef.current.length);
    void repo.listMeals({ limit }).then((list) => {
      if (!live) return;
      setMeals(list);
      setHasMore(list.length === limit);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [repo, dataVersion]);

  const loadMore = useCallback(async () => {
    const last = mealsRef.current[mealsRef.current.length - 1];
    if (loading.current || !last) return;
    loading.current = true;
    try {
      const next = await repo.listMeals({ limit: PAGE, before: last.createdAt });
      setMeals((m) => [...m, ...next]);
      setHasMore(next.length === PAGE);
    } finally {
      loading.current = false;
    }
  }, [repo]);

  const q = fold(query.trim());

  useEffect(() => {
    if (q && hasMore) void loadMore();
  }, [q, hasMore, meals.length, loadMore]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, meals.length]);

  const dayKeys = useMemo(() => [...new Set(meals.map((m) => m.dayKey))].sort(), [meals]);
  const firstDay = dayKeys[0];
  const lastDay = dayKeys[dayKeys.length - 1];
  const [dayTotals, setDayTotals] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!firstDay || !lastDay) return;
    let live = true;
    void repo.daysInRange(firstDay, lastDay).then((list) => live && setDayTotals(new Map(list.map((d) => [d.dayKey, d.kcal]))));
    return () => {
      live = false;
    };
  }, [repo, dataVersion, firstDay, lastDay]);

  const visible = useMemo(() => (q ? meals.filter((m) => matches(m, q)) : meals), [meals, q]);
  const groups = useMemo(() => {
    const map = new Map<string, Meal[]>();
    for (const m of visible) map.set(m.dayKey, [...(map.get(m.dayKey) ?? []), m]);
    return [...map.entries()];
  }, [visible]);

  const locale = i18n.language.startsWith("pt") ? pt : enUS;
  const todayKey = dayKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);
  const dayLabel = (key: string) => {
    if (key === todayKey) return t("history.today");
    if (key === yesterdayKey) return t("history.yesterday");
    const [y, m, d] = key.split("-").map(Number);
    return format(new Date(y!, m! - 1, d!), "EEE, d MMM", { locale });
  };

  const open = (meal: Meal) => {
    setSelected(meal);
    setDetailOpen(true);
  };

  const remove = useRemoveMeal(useCallback(() => setDetailOpen(false), []));

  return (
    <div className="mx-auto w-full max-w-xl self-start pb-8">
      <h1 className="text-large-title pt-4">{t("history.title")}</h1>
      <label className="relative mt-3 block">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-2" aria-hidden="true" />
        <input
          type="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("history.searchPlaceholder")}
          aria-label={t("common.search")}
          className="h-10 w-full rounded-full bg-elevated pl-10 pr-4 text-body outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-fg-2"
        />
      </label>

      {loaded && meals.length === 0 && (
        <div className="flex flex-col items-center gap-4 pt-24 text-center">
          <Logo size={48} />
          <p className="text-body text-fg-2">{t("history.empty")}</p>
        </div>
      )}
      {loaded && meals.length > 0 && visible.length === 0 && !hasMore && (
        <p className="pt-16 text-center text-body text-fg-2">{t("history.noResults")}</p>
      )}

      {groups.map(([key, list]) => (
        <section key={key} className="mt-6">
          <h2 className="flex items-baseline justify-between pb-1 text-subhead font-semibold">
            <span>{dayLabel(key)}</span>
            <span className="text-caption tabular">
              <span>{formatEnergy(dayTotals.get(key) ?? list.reduce((s, m) => s + m.totals.kcal, 0), units)}</span> {energyUnit(units)}
            </span>
          </h2>
          <ul>
            {list.map((m) => (
              <SwipeRow key={m.id} meal={m} onOpen={() => open(m)} onDelete={() => void remove(m)} />
            ))}
          </ul>
        </section>
      ))}
      {hasMore && <div ref={sentinel} className="h-8" aria-hidden="true" />}

      {selected && <MealDetailSheet key={selected.id} open={detailOpen} meal={selected} onClose={() => setDetailOpen(false)} onDelete={(m) => void remove(m)} />}
    </div>
  );
}
