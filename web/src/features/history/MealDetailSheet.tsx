import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { dayKey, guessMealType, scaleItem, sumTotals, type FoodItem, type Meal, type MealType } from "@bites/shared";
import Sheet from "../../components/Sheet";
import PillButton from "../../components/PillButton";
import { toast } from "../../components/Toast";
import { useStore } from "../../store";
import ItemEditor from "../scan/ItemEditor";

interface MealDetailSheetProps {
  open: boolean;
  meal: Meal;
  onClose: () => void;
  onDelete: (meal: Meal) => void;
}

interface Entry { id: number; base: FoodItem; grams: number }

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export default function MealDetailSheet({ open, meal, onClose, onDelete }: MealDetailSheetProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Entry[]>(() => meal.items.map((base, id) => ({ id, base, grams: base.grams })));
  const [mealType, setMealType] = useState<MealType>(meal.mealType);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => entries.map((e) => scaleItem(e.base, e.grams)), [entries]);
  const totals = useMemo(() => sumTotals(items), [items]);

  const setGrams = (id: number, grams: number) => {
    setDirty(true);
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, grams } : e)));
  };
  const remove = (id: number) => {
    setDirty(true);
    setEntries((es) => es.filter((e) => e.id !== id));
  };
  const cycleMeal = () => {
    setDirty(true);
    setMealType((m) => MEAL_TYPES[(MEAL_TYPES.indexOf(m) + 1) % MEAL_TYPES.length]!);
  };

  const save = async () => {
    if (busy || !dirty || items.length === 0) return;
    setBusy(true);
    const { repo, bump } = useStore.getState();
    try {
      await repo.updateMeal({ ...meal, mealType, items, totals, edited: true });
      bump();
      toast(t("toasts.updated"));
      onClose();
    } catch {
      toast(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const logAgain = async () => {
    if (busy) return;
    setBusy(true);
    const { repo, bump } = useStore.getState();
    const now = new Date();
    const { id: _id, ...rest } = meal;
    try {
      await repo.addMeal({ ...rest, createdAt: now.getTime(), dayKey: dayKey(now), mealType: guessMealType(now) });
      bump();
      toast(t("toasts.loggedAgain"));
      onClose();
    } catch {
      toast(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col pt-2">
        <div className="flex items-center justify-between gap-3 px-5">
          <h2 className="min-w-0 truncate text-title">{meal.title}</h2>
          <button
            type="button"
            onClick={cycleMeal}
            aria-label={`${t("result.mealType")}: ${t(`mealType.${mealType}`)}`}
            className="shrink-0 rounded-full bg-elevated px-3 py-1.5 text-subhead font-medium text-accent-text transition-transform active:scale-95"
          >
            {t(`mealType.${mealType}`)}
          </button>
        </div>
        <div className="px-5 pb-2 pt-4 text-center">
          <div className="text-hero" data-testid="detail-kcal">{totals.kcal}</div>
          <div className="text-caption">{t("common.kcal")}</div>
        </div>
        <h3 className="px-5 pb-1 pt-2 text-caption">{t("result.items")}</h3>
        <ul>
          {entries.map((e, i) => (
            <ItemEditor key={e.id} item={items[i]!} onGrams={(g) => setGrams(e.id, g)} onRemove={() => remove(e.id)} />
          ))}
        </ul>
        <div className="sticky bottom-0 mt-4 flex flex-col items-center gap-1 bg-bg px-5 pb-4 pt-2">
          <PillButton className="w-full" onClick={() => void save()} disabled={busy || !dirty || items.length === 0}>
            {t("common.save")}
          </PillButton>
          <PillButton variant="secondary" className="w-full" onClick={() => void logAgain()} disabled={busy}>
            {t("history.detail.logAgain")}
          </PillButton>
          <PillButton variant="text" onClick={() => onDelete(meal)}>
            {t("history.detail.delete")}
          </PillButton>
        </div>
      </div>
    </Sheet>
  );
}
