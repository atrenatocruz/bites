import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FoodItem } from "@bites/shared";
import { selectAllOnFocus } from "../../lib/keyboard";

interface ItemEditorProps {
  item: FoodItem;
  onGrams: (grams: number) => void;
  onRemove: () => void;
}

const STEP = 10;
const MAX_GRAMS = 5000;

export default function ItemEditor({ item, onGrams, onRemove }: ItemEditorProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState<string | null>(null);
  const label = t("result.gramsStepper", { name: item.name });

  const step = (delta: number) => {
    setDraft(null);
    onGrams(Math.min(MAX_GRAMS, Math.max(0, item.grams + delta)));
  };

  const stepButton = "flex size-8 items-center justify-center rounded-full bg-elevated text-fg transition-transform active:scale-90";

  return (
    <li className="relative overflow-hidden">
      <span className="absolute inset-y-0 right-5 flex items-center text-subhead text-fg-2" aria-hidden="true">
        {t("common.delete")}
      </span>
      <motion.div
        className="relative flex items-center gap-3 bg-bg px-5 py-3"
        drag={reduce ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -80) onRemove();
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <span className="break-words text-headline">{item.name}</span>
            {item.confidence < 0.5 && (
              <span
                role="img"
                aria-label={t("result.lowConfidence")}
                title={t("result.lowConfidence")}
                className="flex size-4 shrink-0 items-center justify-center rounded-full bg-elevated text-[11px] font-semibold text-fg-2"
              >
                ?
              </span>
            )}
          </div>
          {item.assumption && <div className="break-words text-caption">{item.assumption}</div>}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={stepButton} aria-label={`${label} −${STEP}`} onClick={() => step(-STEP)}>
            <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <input
            type="number"
            inputMode="numeric"
            enterKeyHint="done"
            min={0}
            max={MAX_GRAMS}
            aria-label={label}
            className="tabular w-12 rounded-md bg-transparent text-center text-body outline-none focus-visible:ring-2 focus-visible:ring-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            value={draft ?? String(item.grams)}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n) && n >= 0) onGrams(Math.min(MAX_GRAMS, n));
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onFocus={selectAllOnFocus}
          />
          <button type="button" className={stepButton} aria-label={`${label} +${STEP}`} onClick={() => step(STEP)}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="w-14 text-right">
          <span className="tabular text-headline">{item.kcal}</span>
          <span className="block text-caption">{t("common.kcal")}</span>
        </div>
        <button type="button" onClick={onRemove} className="sr-only focus:not-sr-only focus:text-caption">
          {t("result.remove", { name: item.name })}
        </button>
      </motion.div>
    </li>
  );
}
