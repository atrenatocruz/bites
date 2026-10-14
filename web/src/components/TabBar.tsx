import { useRef, type PointerEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarDays, List, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore, type Tab } from "../store";

const TABS: { id: Exclude<Tab, "scan">; Icon: typeof List }[] = [
  { id: "history", Icon: List },
  { id: "diary", Icon: CalendarDays },
];

/** Same spring as the sheets, so every moving surface in the app shares one feel. */
const SPRING = { type: "spring", stiffness: 500, damping: 38 } as const;

/**
 * The iOS 26 pattern: a compact glass capsule with the tabs, and the main action as its own tinted glass
 * circle beside it. The selected tab is a quiet grey pill that slides, and a finger can scrub across the capsule.
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
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-center justify-between px-5 pb-[max(calc(env(safe-area-inset-bottom)-12px),14px)]"
      aria-label={t("tabs.label")}
    >
      {/* Scroll edge effect: content fades out where it meets the floating bar. The camera has its own. */}
      {tab !== "scan" && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[calc(var(--island-clearance)+16px)] bg-gradient-to-t from-bg via-bg/75 to-transparent" />
      )}
      <div
        className="glass pointer-events-auto flex h-14 touch-none select-none items-center rounded-full p-[3px]"
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
          return (
            <button
              key={id}
              type="button"
              data-tab={id}
              // Pointer presses are handled on the capsule; this keeps keyboards and assistive tech working.
              onClick={(e) => e.detail === 0 && select(id)}
              aria-current={selected ? "page" : undefined}
              className={`relative flex h-full w-[84px] flex-col items-center justify-center gap-[3px] rounded-full outline-none transition-[color,transform] duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent ${selected ? "text-accent-text" : "text-fg"}`}
            >
              {selected && <motion.span layoutId="tab-selection" className="glass-selection absolute inset-0 rounded-full" transition={reduce ? { duration: 0 } : SPRING} />}
              <Icon size={21} strokeWidth={2} className="relative" aria-hidden="true" />
              <span className="relative text-[10px] font-semibold leading-none">{t(`tabs.${id}`)}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => select("scan")}
        aria-label={t("tabs.scan")}
        aria-current={tab === "scan" ? "page" : undefined}
        className="glass-tinted pointer-events-auto grid size-14 place-items-center rounded-full text-white outline-none transition-transform duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <ScanLine size={24} strokeWidth={2} aria-hidden="true" />
      </button>
    </nav>
  );
}
