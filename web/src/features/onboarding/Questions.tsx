import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { bmi, type Activity, type Goal, type Profile, type Sex } from "@bites/shared";
import PillButton from "../../components/PillButton";

export interface Answers {
  goal: Goal;
  sex: Sex | null;
  birthYear: string;
  heightCm: string;
  weightKg: string;
  activity: Activity;
}

export const DEFAULT_ANSWERS: Answers = { goal: "maintain", sex: null, birthYear: "1990", heightCm: "170", weightKg: "70", activity: "light" };

export const answersFrom = (p: Profile): Answers => ({
  goal: p.goal,
  sex: p.sex,
  birthYear: String(p.birthYear),
  heightCm: String(p.heightCm),
  weightKg: String(p.weightKg),
  activity: p.activity,
});

const inRange = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n >= min && n <= max;
};

const validBirthYear = (raw: string) => inRange(raw, 1900, new Date().getFullYear() - 10) && Number.isInteger(Number(raw));
const validHeight = (raw: string) => inRange(raw, 100, 250);
const validWeight = (raw: string) => inRange(raw, 30, 300);

const GOALS: Goal[] = ["lose", "maintain", "gain"];
const SEXES: Sex[] = ["female", "male"];
const ACTIVITIES: { id: Activity; key: string }[] = [
  { id: "sedentary", key: "sedentary" },
  { id: "light", key: "light" },
  { id: "moderate", key: "moderate" },
  { id: "very", key: "very" },
];
const TOTAL = 4;

function Option({ selected, onClick, children, className = "" }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-card px-5 py-4 text-left transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] ${selected ? "bg-accent/10 shadow-[inset_0_0_0_2px_var(--accent)]" : "bg-elevated"} ${className}`}
    >
      {children}
    </button>
  );
}

function NumberField({ id, label, value, unit, onChange, invalid }: { id: string; label: string; value: string; unit: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="text-caption">
        {label}
      </label>
      <div className={`mt-1.5 flex items-baseline gap-2 rounded-card bg-elevated px-5 py-3 ${invalid ? "shadow-[inset_0_0_0_2px_var(--over)]" : ""}`}>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))}
          className="tabular min-w-0 flex-1 bg-transparent text-[34px] font-bold leading-[41px] tracking-[-0.02em] outline-none"
        />
        <span className="text-body text-fg-2">{unit}</span>
      </div>
    </div>
  );
}

interface QuestionsProps {
  value: Answers;
  onChange: (patch: Partial<Answers>) => void;
  onFinish: () => void;
  onExit: () => void;
}

export default function Questions({ value, onChange, onFinish, onExit }: QuestionsProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  const heightOk = validHeight(value.heightCm);
  const weightOk = validWeight(value.weightKg);
  const birthOk = validBirthYear(value.birthYear);
  const canContinue = [true, value.sex !== null && birthOk, heightOk && weightOk, true][step]!;

  const next = () => {
    if (!canContinue) return;
    if (step === TOTAL - 1) onFinish();
    else setStep(step + 1);
  };
  const back = () => (step === 0 ? onExit() : setStep(step - 1));

  const bmiValue = heightOk && weightOk ? bmi(Number(value.weightKg), Number(value.heightCm)) : null;
  const category = bmiValue === null ? "" : bmiValue < 18.5 ? "bmiUnderweight" : bmiValue < 25 ? "bmiHealthy" : bmiValue < 30 ? "bmiOverweight" : "bmiObese";

  const titleKey = ["goal", "about", "body", "activity"][step]!;

  return (
    <form
      className="mx-auto flex h-full w-full max-w-md flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),12px)]"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <div className="flex items-center gap-3">
        <button type="button" onClick={back} aria-label={t("common.back")} className="-ml-2 grid size-10 place-items-center rounded-full text-fg-2 active:bg-elevated">
          <ChevronLeft size={24} strokeWidth={1.75} />
        </button>
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-sep"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL}
          aria-valuenow={step + 1}
          aria-valuetext={t("onboarding.step", { current: step + 1, total: TOTAL })}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${((step + 1) / TOTAL) * 100}%` }} />
        </div>
        <span className="w-10" aria-hidden="true" />
      </div>

      <motion.div
        key={step}
        className="min-h-0 flex-1 overflow-y-auto pt-8"
        initial={{ opacity: 0, x: reduce ? 0 : 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 34 }}
      >
        <p className="text-caption">{t("onboarding.step", { current: step + 1, total: TOTAL })}</p>
        <h1 className="mt-2 text-large-title tracking-[-0.02em]">{t(`onboarding.${titleKey}.title`)}</h1>

        {step === 0 && (
          <div className="mt-8 flex flex-col gap-3">
            {GOALS.map((g) => (
              <Option key={g} selected={value.goal === g} onClick={() => onChange({ goal: g })}>
                <span className="text-headline">{t(`onboarding.goal.${g}`)}</span>
              </Option>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="mt-8 flex flex-col gap-6">
            <div>
              <div className="text-caption">{t("onboarding.about.sexLabel")}</div>
              <div className="mt-1.5 grid grid-cols-2 gap-3" role="group" aria-label={t("onboarding.about.sexLabel")}>
                {SEXES.map((s) => (
                  <Option key={s} selected={value.sex === s} onClick={() => onChange({ sex: s })}>
                    <span className="text-headline">{t(`onboarding.about.${s}`)}</span>
                  </Option>
                ))}
              </div>
              <p className="mt-2 text-caption">{t("onboarding.about.sexNote")}</p>
            </div>
            <NumberField id="birth-year" label={t("onboarding.about.birthYear")} value={value.birthYear} unit="" invalid={value.birthYear !== "" && !birthOk} onChange={(v) => onChange({ birthYear: v.replace(/\./g, "").slice(0, 4) })} />
          </div>
        )}

        {step === 2 && (
          <div className="mt-8 flex flex-col gap-5">
            <NumberField id="height" label={t("onboarding.body.height")} value={value.heightCm} unit={t("common.cm")} invalid={value.heightCm !== "" && !heightOk} onChange={(v) => onChange({ heightCm: v })} />
            <NumberField id="weight" label={t("onboarding.body.weight")} value={value.weightKg} unit={t("common.kg")} invalid={value.weightKg !== "" && !weightOk} onChange={(v) => onChange({ weightKg: v })} />
            <p className="min-h-5 text-subhead text-fg-2 tabular" aria-live="polite">
              {bmiValue !== null && t("onboarding.body.bmi", { value: bmiValue.toFixed(1), category: t(`onboarding.body.${category}`) })}
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="mt-8 flex flex-col gap-3">
            {ACTIVITIES.map(({ id, key }) => (
              <Option key={id} selected={value.activity === id} onClick={() => onChange({ activity: id })}>
                <span className="block text-headline">{t(`onboarding.activity.${key}`)}</span>
                <span className="mt-0.5 block text-subhead text-fg-2">{t(`onboarding.activity.${key}Hint`)}</span>
              </Option>
            ))}
          </div>
        )}
      </motion.div>

      <PillButton type="submit" className="w-full" disabled={!canContinue}>
        {t("common.continue")}
      </PillButton>
    </form>
  );
}
