import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStore } from "../store";

const DOTS = ["var(--protein)", "var(--carbs)", "var(--fat)", "var(--accent)"] as const;
const STEPS = ["analyzingStep1", "analyzingStep2", "analyzingStep3"] as const;
const STEP_MS = 3500;

/** Four dots in the macro colors that bounce one after the other. Still, but softly pulsing, with reduced motion. */
export function AnalyzingDots({ size = 10, className = "" }: { size?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} aria-hidden="true">
      {DOTS.map((color, i) => (
        <motion.span
          key={color}
          className="block rounded-full"
          style={{ width: size, height: size, background: color }}
          animate={reduce ? { opacity: [0.45, 1, 0.45] } : { y: [0, -size * 0.9, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: reduce ? 1.6 : 0.9, ease: "easeInOut", repeat: Infinity, delay: i * 0.12 }}
        />
      ))}
    </span>
  );
}

/** Rotating hint about what the AI is doing. Purely decorative: the label above it is what screen readers get. */
function Steps() {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % STEPS.length), STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="relative block h-5 overflow-hidden text-center text-subhead opacity-80" aria-hidden="true">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={index}
          className="block"
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -8 }}
          transition={{ duration: 0.25 }}
        >
          {t(`scan.${STEPS[index]!}`)}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A quiet heads-up that the free plan is slower. Shown only when the server says the user is on it. */
export function FreeModeHint({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const free = useStore((s) => s.plan?.plan === "free");
  if (!free) return null;
  return <p className={`text-center text-subhead opacity-60 ${className}`}>{t("scan.freeSlow")}</p>;
}

/** The full "analyzing" state: animated dots, the label and the rotating hint. */
export default function Analyzing({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <AnalyzingDots size={12} />
      <div className="flex flex-col items-center gap-1">
        <span className="text-headline">{t("scan.analyzing")}</span>
        <Steps />
      </div>
      <FreeModeHint className="max-w-[260px]" />
    </div>
  );
}
