import { useTranslation } from "react-i18next";
import type { DaySummary, MacroTargets } from "@bites/shared";
import Ring from "../../components/Ring";
import MacroBars from "../../components/MacroBars";
import { energyUnit, formatEnergy } from "../../lib/stats";

interface DayCardProps {
  summary: DaySummary | undefined;
  target: number;
  macros: MacroTargets;
  units: "kcal" | "kj";
}

export default function DayCard({ summary, target, macros, units }: DayCardProps) {
  const { t } = useTranslation();
  const eaten = Math.round(summary?.kcal ?? 0);
  const remaining = Math.round(target) - eaten;
  const over = remaining < 0;
  const unit = energyUnit(units);
  const label = t("diary.ring.summary", { eaten: formatEnergy(eaten, units), target: formatEnergy(target, units), unit });
  return (
    <section className="rounded-card bg-elevated p-5">
      <div className="flex flex-col items-center">
        <Ring value={eaten} max={target} size={216} stroke={16} color={over ? "var(--over)" : "var(--accent)"} label={label}>
          <span className={`text-hero ${over ? "text-over" : ""}`}>{over ? `+${formatEnergy(-remaining, units)}` : formatEnergy(remaining, units)}</span>
          <span className="text-caption">{over ? t("diary.ring.over") : t("diary.ring.remaining")}</span>
        </Ring>
        <p className="mt-3 text-subhead tabular text-fg-2" aria-hidden="true">{label}</p>
      </div>
      <div className="mt-5">
        <MacroBars totals={{ kcal: eaten, protein: summary?.protein ?? 0, carbs: summary?.carbs ?? 0, fat: summary?.fat ?? 0 }} targets={macros} />
      </div>
    </section>
  );
}
