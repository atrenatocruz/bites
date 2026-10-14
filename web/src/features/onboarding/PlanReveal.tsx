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
  google?: boolean;
  notice?: string | null;
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

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0 rounded-full bg-white p-[3px]" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export default function PlanReveal({ kcal, weightKg, goal, onKcalChange, onStart, google, notice, busy }: PlanRevealProps) {
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
      {notice && (
        <p role="status" className="mb-3 text-center text-subhead text-fg-2">
          {notice}
        </p>
      )}
      <PillButton className="w-full gap-3" onClick={onStart} disabled={busy}>
        {google && <GoogleMark />}
        {t(google ? "onboarding.plan.google" : "onboarding.plan.start")}
      </PillButton>
    </div>
  );
}
