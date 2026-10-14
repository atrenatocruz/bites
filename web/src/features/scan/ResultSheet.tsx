import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { enUS, pt } from "date-fns/locale";
import { dayKey, macroTargets, scaleItem, sumTotals, type AnalyzeResult, type FoodItem, type MealType } from "@bites/shared";
import Sheet from "../../components/Sheet";
import Ring from "../../components/Ring";
import PillButton from "../../components/PillButton";
import { toast } from "../../components/Toast";
import { useStore } from "../../store";
import { ApiError, errorKey } from "../../lib/api";
import { parseKey } from "../../lib/stats";
import ItemEditor from "./ItemEditor";
import TextEntry from "./TextEntry";

interface ResultSheetProps {
  open: boolean;
  result: AnalyzeResult;
  source: "photo" | "text";
  thumb: string | null;
  hint: string;
  onClose: () => void;
  onRetake: () => void;
  onSaved: () => void;
  reanalyze: (hint: string) => Promise<AnalyzeResult>;
  analyzeText: (text: string) => Promise<AnalyzeResult>;
}

interface Entry { id: number; base: FoodItem; grams: number }

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MACROS = [
  { key: "protein", color: "var(--protein)", short: "common.proteinShort" },
  { key: "carbs", color: "var(--carbs)", short: "common.carbsShort" },
  { key: "fat", color: "var(--fat)", short: "common.fatShort" },
] as const;

export default function ResultSheet({ open, result, source, thumb, hint, onClose, onRetake, onSaved, reanalyze, analyzeText }: ResultSheetProps) {
  const { t, i18n } = useTranslation();
  const profile = useStore((s) => s.profile);
  const pinnedDay = useStore((s) => (s.selectedDayPinned && s.selectedDay ? s.selectedDay : null));
  const targetDay = pinnedDay ?? dayKey(new Date());
  const isPt = i18n.language.startsWith("pt");
  const nextId = useRef(0);
  const toEntries = (items: FoodItem[]): Entry[] => items.map((base) => ({ id: nextId.current++, base, grams: base.grams }));

  const [current, setCurrent] = useState(result);
  const [entries, setEntries] = useState<Entry[]>(() => toEntries(result.items));
  const [mealType, setMealType] = useState<MealType>(result.mealType);
  const [edited, setEdited] = useState(false);
  const [currentHint, setCurrentHint] = useState(hint);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<"followUp" | "save" | null>(null);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const items = useMemo(() => entries.map((e) => scaleItem(e.base, e.grams)), [entries]);
  const totals = useMemo(() => sumTotals(items), [items]);
  const ratio = current.totals.kcal > 0 ? totals.kcal / current.totals.kcal : 1;
  const low = Math.round(current.kcalRange.low * ratio);
  const high = Math.round(current.kcalRange.high * ratio);
  const targets = profile?.macroTargets ?? macroTargets(2000, 70, "maintain");

  const setGrams = (id: number, grams: number) => {
    setEdited(true);
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, grams } : e)));
  };
  const remove = (id: number) => {
    setEdited(true);
    setEntries((es) => es.filter((e) => e.id !== id));
  };

  const cycleMeal = () => setMealType((m) => MEAL_TYPES[(MEAL_TYPES.indexOf(m) + 1) % MEAL_TYPES.length]!);

  const submitFollowUp = async () => {
    const text = answer.trim();
    if (!text || !current.followUpQuestion || busy) return;
    const nextHint = [currentHint, `${current.followUpQuestion} ${text}`].filter(Boolean).join("; ");
    setBusy("followUp");
    setFollowUpError(null);
    try {
      const next = await reanalyze(nextHint);
      if (!next.isFood || next.items.length === 0) throw new ApiError("not_food");
      setCurrent(next);
      setEntries(toEntries(next.items));
      setMealType(next.mealType);
      setEdited(false);
      setCurrentHint(nextHint);
      setAnswer("");
    } catch (e) {
      setFollowUpError(t(errorKey(e)));
    } finally {
      setBusy(null);
    }
  };

  const addItems = async (text: string) => {
    const next = await analyzeText(text);
    if (!next.isFood || next.items.length === 0) throw new ApiError("not_food");
    setEntries((es) => [...es, ...toEntries(next.items)]);
    setEdited(true);
    setAdding(false);
  };

  const save = async () => {
    if (busy || items.length === 0 || totals.kcal === 0) return;
    setBusy("save");
    const { repo, selectedDay, selectedDayPinned, bump, setTab } = useStore.getState();
    try {
      await repo.addMeal({
        createdAt: Date.now(),
        dayKey: selectedDayPinned && selectedDay ? selectedDay : dayKey(new Date()),
        mealType,
        title: current.title,
        thumb,
        items,
        totals,
        source,
        edited,
      });
      navigator.vibrate?.(10);
      bump();
      toast(t("toasts.added"), { label: t("toasts.view"), onClick: () => setTab("diary") });
      onSaved();
    } catch {
      toast(t("errors.generic"));
      setBusy(null);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose}>
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between gap-3 px-5">
            <h2 className="min-w-0 break-words text-title">{current.title}</h2>
            <button
              type="button"
              onClick={cycleMeal}
              aria-label={`${t("result.mealType")}: ${t(`mealType.${mealType}`)}`}
              className="shrink-0 rounded-full bg-elevated px-3 py-1.5 text-subhead font-medium text-accent-text transition-transform active:scale-95"
            >
              {t(`mealType.${mealType}`)}
            </button>
          </div>

          {pinnedDay && pinnedDay !== dayKey(new Date()) && (
            <p className="px-5 pt-2 text-center text-caption">
              {t("result.addingTo", { date: format(parseKey(targetDay), isPt ? "EEE'.,' d MMM'.'" : "EEE d MMM", { locale: isPt ? pt : enUS }) })}
            </p>
          )}

          <div className="px-5 pb-1 pt-4 text-center">
            <div className="text-hero" data-testid="hero-kcal">{totals.kcal}</div>
            <div className="text-caption">
              {t("common.kcal")} · {t("result.range", { low, high })}
            </div>
          </div>

          <div className="flex justify-center gap-8 px-5 py-4">
            {MACROS.map(({ key, color, short }) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <Ring value={totals[key]} max={targets[key]} size={56} stroke={6} color={color} label={`${t(`common.${key}`)} ${Math.round(totals[key])} ${t("common.g")}`}>
                  <span className="tabular text-subhead font-semibold">{Math.round(totals[key])}</span>
                </Ring>
                <span className="text-caption">{t(short)} · {t("common.g")}</span>
              </div>
            ))}
          </div>

          <h3 className="px-5 pb-1 pt-2 text-caption">{t("result.items")}</h3>
          <ul>
            {entries.map((e, i) => (
              <ItemEditor key={e.id} item={items[i]!} onGrams={(g) => setGrams(e.id, g)} onRemove={() => remove(e.id)} />
            ))}
          </ul>
          <button type="button" onClick={() => setAdding(true)} className="mx-5 mt-1 flex h-11 items-center gap-2 self-start text-subhead font-medium text-accent-text">
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            {t("result.addItem")}
          </button>

          {current.followUpQuestion && (
            <div className="mx-5 mt-3 rounded-card bg-elevated p-4">
              <div className="text-caption">{t("result.followUp")}</div>
              <p className="mt-1 text-body">{current.followUpQuestion}</p>
              <div className="mt-3 flex gap-2">
                <input
                  value={answer}
                  enterKeyHint="send"
                  maxLength={200}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void submitFollowUp()}
                  placeholder={t("result.followUpPlaceholder")}
                  className="min-w-0 flex-1 rounded-full bg-bg px-4 py-2 text-body outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-fg-2"
                />
                <PillButton variant="primary" className="!h-10 !px-5" disabled={busy === "followUp" || !answer.trim()} onClick={() => void submitFollowUp()}>
                  {busy === "followUp" ? t("scan.analyzing") : t("common.update")}
                </PillButton>
              </div>
              {followUpError && (
                <p role="alert" className="mt-2 text-subhead text-fg-2">
                  {followUpError}
                </p>
              )}
            </div>
          )}

          <div className="sticky bottom-0 mt-4 flex flex-col items-center gap-1 bg-bg px-5 pb-4 pt-2">
            <PillButton className="w-full" onClick={() => void save()} disabled={busy === "save" || items.length === 0 || totals.kcal === 0}>
              {t("result.save")}
            </PillButton>
            <PillButton variant="text" onClick={onRetake}>
              {t("result.retake")}
            </PillButton>
          </div>
        </div>
      </Sheet>
      <TextEntry open={adding} mode="add" onClose={() => setAdding(false)} onSubmit={addItems} />
    </>
  );
}
