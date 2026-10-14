import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import type { Meal } from "@bites/shared";
import { useStore } from "../store";
import { energyUnit, formatEnergy } from "../lib/stats";

interface MealRowProps { meal: Meal; onClick: () => void }

export default function MealRow({ meal, onClick }: MealRowProps) {
  const { t } = useTranslation();
  const units = useStore((s) => s.profile?.units ?? "kcal");
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 border-b border-sep py-3 text-left last:border-b-0 active:opacity-70">
      <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-elevated">
        {meal.thumb && <img src={meal.thumb} alt="" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-headline">{meal.title}</div>
        <div className="text-caption tabular">{`${t(`mealType.${meal.mealType}`)} · ${format(meal.createdAt, "HH:mm")}`}</div>
      </div>
      <div className="shrink-0 text-right">
        <span className="text-headline tabular">{formatEnergy(meal.totals.kcal, units)}</span>
        <span className="ml-1 text-caption">{energyUnit(units)}</span>
      </div>
    </button>
  );
}
