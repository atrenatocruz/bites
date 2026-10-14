import { useRef, type PointerEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarDays, List, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore, type Tab } from "../store";

const TABS: { id: Tab; Icon: typeof List }[] = [
  { id: "history", Icon: List },
  { id: "scan", Icon: ScanLine },
  { id: "diary", Icon: CalendarDays },
];

/** Same spring as the sheets, so every moving surface in the app shares one feel. */
const SPRING = { type: "spring", stiffness: 400, damping: 34 } as const;

/**
 * A floating "Liquid Glass" island. The selected tab is a lens of lighter glass that slides between tabs,
 * and a finger can scrub across the island to switch, like the iOS tab bar.
 */
export default function TabBar() {
  const { t } = useTranslation();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const reduce = useReducedMotion();
  const pressing = useRef(false);

  const select = (next: Tab) => {
    if (next === tab) return;
    navigator.vibrate?.(10);
    setTab(next);
  };

  const tabUnder = (e: PointerEvent): Tab | null => {
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-tab]");
    return (hit?.getAttribute("data-tab") as Tab | null) ?? null;
  };

  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-5 pb-[max(env(safe-area-inset-bottom),12px)]" aria-label={t("tabs.label")}>
      <div
        className="glass-island pointer-events-auto flex w-full max-w-[340px] touch-none select-none items-center gap-1 rounded-full p-1.5"
        onPointerDown={(e) => {
          pressing.current = true;
          const id = tabUnder(e);
          if (id) select(id);
        }}
        onPointerMove={(e) => {
          if (!pressing.current) return;
          const id = tabUnder(e);
          if (id) select(id);
        }}
        onPointerUp={() => (pressing.current = false)}
        onPointerCancel={() => (pressing.current = false)}
        onPointerLeave={() => (pressing.current = false)}
      >
        {TABS.map(({ id, Icon }) => {
          const selected = tab === id;
          const primary = id === "scan";
          return (
            <button
              key={id}
              type="button"
              data-tab={id}
              // Pointer presses are handled above; this keeps keyboards and assistive tech working.
              onClick={(e) => e.detail === 0 && select(id)}
              aria-label={primary ? t("tabs.scan") : undefined}
              aria-current={selected ? "page" : undefined}
              className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full outline-none transition-[color,transform] duration-150 active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-accent ${selected || primary ? "text-accent-text" : "text-fg/70"}`}
            >
              {selected && (
                <motion.span
                  layoutId="island-lens"
                  className={`glass-lens absolute inset-0 rounded-full ${primary ? "glass-lens--accent" : ""}`}
                  transition={reduce ? { duration: 0 } : SPRING}
                />
              )}
              <Icon size={primary ? 26 : 24} strokeWidth={1.75} className="relative" aria-hidden="true" />
              <span className="relative text-[10px] font-semibold leading-[12px] tracking-[0.01em]" aria-hidden={primary ? true : undefined}>
                {t(`tabs.${id}`)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
