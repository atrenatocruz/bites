import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import PillButton from "../../components/PillButton";

const SLIDES = ["one", "two", "three"] as const;

function Plate({ cx = 140, cy = 150, r = 96 }: { cx?: number; cy?: number; r?: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg-elevated)" />
      <circle cx={cx} cy={cy} r={r * 0.74} fill="none" stroke="var(--separator)" strokeWidth="2" />
    </>
  );
}

function ScanIllustration() {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 280 280" className="size-full" aria-hidden="true">
      <Plate />
      <circle cx="118" cy="140" r="20" fill="var(--carbs)" />
      <rect x="140" y="132" width="44" height="26" rx="13" fill="var(--accent)" />
      <circle cx="150" cy="176" r="14" fill="var(--good)" />
      <rect x="82" y="30" width="116" height="206" rx="26" fill="none" stroke="var(--fg)" strokeWidth="5" />
      <rect x="120" y="40" width="40" height="8" rx="4" fill="var(--fg)" />
      <g fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round">
        <path d="M100 82v-10a8 8 0 0 1 8-8h10" />
        <path d="M162 64h10a8 8 0 0 1 8 8v10" />
        <path d="M180 192v10a8 8 0 0 1-8 8h-10" />
        <path d="M118 210h-10a8 8 0 0 1-8-8v-10" />
      </g>
      <motion.rect
        x="96"
        width="88"
        height="3"
        rx="1.5"
        fill="var(--accent)"
        initial={{ y: 96 }}
        animate={reduce ? { y: 140 } : { y: [96, 184, 96] }}
        transition={reduce ? undefined : { duration: 2.8, ease: "easeInOut", repeat: Infinity }}
      />
    </svg>
  );
}

function Chip({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="176" height="30" rx="15" fill="var(--bg)" stroke="var(--separator)" strokeWidth="1.5" />
      <circle cx="16" cy="15" r="5" fill={color} />
      <text x="29" y="19.5" fontSize="12" fontWeight="600" fill="var(--fg)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {label}
      </text>
    </g>
  );
}

function PartsIllustration() {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const float = (delay: number) => ({
    animate: reduce ? undefined : { y: [0, -4, 0] },
    transition: { duration: 3.2, ease: "easeInOut" as const, repeat: Infinity, delay },
  });
  return (
    <svg viewBox="0 0 280 280" className="size-full" aria-hidden="true">
      <Plate cy={152} r={92} />
      <circle cx="112" cy="146" r="26" fill="var(--carbs)" />
      <rect x="132" y="150" width="56" height="30" rx="15" fill="var(--accent)" />
      <circle cx="170" cy="122" r="14" fill="var(--good)" />
      <path d="M96 62 112 120M184 232l-14-52" stroke="var(--separator)" strokeWidth="1.5" strokeLinecap="round" />
      <motion.g {...float(0)}>
        <Chip x={6} y={34} color="var(--carbs)" label={t("onboarding.illustration.rice")} />
      </motion.g>
      <motion.g {...float(1.2)}>
        <Chip x={98} y={226} color="var(--accent)" label={t("onboarding.illustration.chicken")} />
      </motion.g>
    </svg>
  );
}

function DayIllustration() {
  const reduce = useReducedMotion();
  const R = 66;
  const C = 2 * Math.PI * R;
  const week = [0.9, 1, 0.55, 0.95, 0.8, 0.3, 0];
  const mini = 2 * Math.PI * 14;
  return (
    <svg viewBox="0 0 280 280" className="size-full" aria-hidden="true">
      <circle cx="140" cy="102" r={R} fill="none" stroke="var(--separator)" strokeWidth="16" opacity="0.6" />
      <motion.circle
        cx="140"
        cy="102"
        r={R}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="16"
        strokeLinecap="round"
        transform="rotate(-90 140 102)"
        initial={{ strokeDasharray: `0 ${C}` }}
        animate={{ strokeDasharray: `${C * 0.72} ${C * 0.28}` }}
        transition={{ duration: reduce ? 0 : 1.1, ease: "easeOut", delay: 0.15 }}
      />
      <rect x="116" y="88" width="48" height="8" rx="4" fill="var(--fg)" />
      <rect x="124" y="106" width="32" height="6" rx="3" fill="var(--separator)" />
      {week.map((v, i) => {
        const cx = 34 + i * 35.3;
        const selected = i === 4;
        return (
          <g key={i}>
            {selected && <circle cx={cx} cy="222" r="20" fill="var(--accent)" opacity="0.14" />}
            <circle cx={cx} cy="222" r="14" fill="none" stroke="var(--separator)" strokeWidth="5" opacity="0.7" />
            {v > 0 && (
              <circle
                cx={cx}
                cy="222"
                r="14"
                fill="none"
                stroke={v >= 0.9 && v <= 1 ? "var(--good)" : "var(--accent)"}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${mini * v} ${mini}`}
                transform={`rotate(-90 ${cx} 222)`}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

const ILLUSTRATIONS: Record<(typeof SLIDES)[number], ReactNode> = {
  one: <ScanIllustration />,
  two: <PartsIllustration />,
  three: <DayIllustration />,
};

interface SlidesProps { onDone: () => void }

export default function Slides({ onDone }: SlidesProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const key = SLIDES[index]!;

  const go = (next: number) => {
    if (next < 0) return;
    if (next >= SLIDES.length) return onDone();
    setDir(next > index ? 1 : -1);
    setIndex(next);
  };

  return (
    <div className="flex h-full flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]">
      <motion.div
        key={key}
        className="flex min-h-0 flex-1 touch-pan-y flex-col items-center"
        initial={{ opacity: 0, x: reduce ? 0 : dir * 32 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 34 }}
        drag={reduce ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.25}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60 || info.velocity.x < -500) go(index + 1);
          else if (info.offset.x > 60 || info.velocity.x > 500) go(index - 1);
        }}
      >
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <div className="aspect-square w-full max-w-[320px]">{ILLUSTRATIONS[key]}</div>
        </div>
        <div className="w-full max-w-sm pb-8 text-center">
          <h1 className="text-large-title tracking-[-0.02em]">{t(`onboarding.slides.${key}.title`)}</h1>
          <p className="mt-3 text-body text-fg-2">{t(`onboarding.slides.${key}.body`)}</p>
        </div>
      </motion.div>

      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 flex justify-center gap-2" role="group" aria-label={t("onboarding.page", { current: index + 1, total: SLIDES.length })}>
          {SLIDES.map((s, i) => (
            <span key={s} className={`h-2 rounded-full transition-all duration-300 ${i === index ? "w-5 bg-accent" : "w-2 bg-sep"}`} />
          ))}
        </div>
        <PillButton className="w-full" onClick={() => go(index + 1)}>
          {t("common.continue")}
        </PillButton>
      </div>
    </div>
  );
}
