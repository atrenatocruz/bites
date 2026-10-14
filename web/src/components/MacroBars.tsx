import { useTranslation } from "react-i18next";
import type { MacroTargets, Totals } from "@bites/shared";

interface MacroBarsProps { totals: Totals; targets: MacroTargets }

const ROWS = [
  { key: "protein", color: "var(--protein)" },
  { key: "carbs", color: "var(--carbs)" },
  { key: "fat", color: "var(--fat)" },
] as const;

export default function MacroBars({ totals, targets }: MacroBarsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-4">
      {ROWS.map(({ key, color }) => {
        const value = Math.round(totals[key]);
        const target = Math.round(targets[key]);
        const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
        return (
          <div key={key} className="flex-1">
            <div className="text-caption">{t(`common.${key}`)}</div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-sep">
              <div className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="mt-1 text-subhead tabular">{`${value} / ${target} ${t("common.g")}`}</div>
          </div>
        );
      })}
    </div>
  );
}
