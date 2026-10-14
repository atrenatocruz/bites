import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { macroTargets, type Goal } from "@bites/shared";
import PillButton from "../../components/PillButton";

interface PlanRevealProps {
  kcal: number;
  weightKg: number;
  goal: Goal;
  onKcalChange: (kcal: number) => void;
  onStart: () => void;
  onGoogle?: () => void;
  busy?: boolean;
}

const STEP = 50;
const MIN = 800;
const MAX = 6000;

function useCountUp(target: number, duration = 0.9) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) {
      setValue(target);
      return;
    }
    const controls = animate(value, target, { duration, ease: "easeOut", onUpdate: (v) => setValue(Math.round(v)) });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce, duration]);
  return value;
}

export default function PlanReveal({ kcal, weightKg, goal, onKcalChange, onStart, onGoogle, busy }: PlanRevealProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const shown = useCountUp(kcal);
  const macros = macroTargets(kcal, weightKg, goal);
  const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

  const rows = [
    { key: "protein", color: "var(--protein)", grams: macros.protein },
    { key: "carbs", color: "var(--carbs)", grams: macros.carbs },
    { key: "fat", color: "var(--fat)", grams: macros.fat },
  ] as const;

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]">
      <div className="flex min-h-0 flex-1 flex-col justify-center text-center">
        <h1 className="text-title text-fg-2">{t("onboarding.plan.title")}</h1>

        <div className="mt-6 flex items-center justify-center gap-4">
          {editing && (
            <button type="button" aria-label={`${t("onboarding.plan.editTarget")} −`} onClick={() => onKcalChange(clamp(kcal - STEP))} className="grid size-11 place-items-center rounded-full bg-elevated active:scale-95">
              <Minus size={20} strokeWidth={1.75} />
            </button>
          )}
          <div role="img" className="tabular min-w-[4ch] text-[80px] font-bold leading-[84px] tracking-[-0.03em]" aria-label={`${kcal}`}>
            <span aria-hidden="true">{shown}</span>
          </div>
          {editing && (
            <button type="button" aria-label={`${t("onboarding.plan.editTarget")} +`} onClick={() => onKcalChange(clamp(kcal + STEP))} className="grid size-11 place-items-center rounded-full bg-elevated active:scale-95">
              <Plus size={20} strokeWidth={1.75} />
            </button>
          )}
        </div>
        <p className="mt-1 text-body text-fg-2">{t("onboarding.plan.caption")}</p>

        <div className="mx-auto mt-10 grid w-full max-w-xs grid-cols-3 gap-3">
          {rows.map(({ key, color, grams }) => (
            <div key={key} className="rounded-card bg-elevated px-2 py-4">
              <div className="mx-auto mb-2 h-1 w-8 rounded-full" style={{ background: color }} />
              <div className="tabular text-title">{`${grams} ${t("common.g")}`}</div>
              <div className="text-caption">{t(`common.${key}`)}</div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <PillButton variant="text" onClick={() => setEditing((e) => !e)}>
            {editing ? t("common.done") : t("common.edit")}
          </PillButton>
        </div>
      </div>

      <p className="mb-4 text-center text-caption">{t("onboarding.plan.footnote")}</p>
      <div className="flex flex-col gap-3">
        <PillButton className="w-full" onClick={onStart} disabled={busy}>
          {t("onboarding.plan.start")}
        </PillButton>
        {onGoogle && (
          <PillButton variant="secondary" className="w-full" onClick={onGoogle} disabled={busy}>
            {t("onboarding.plan.saveWithGoogle")}
          </PillButton>
        )}
      </div>
    </div>
  );
}
