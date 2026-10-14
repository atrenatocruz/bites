import { CalendarDays, List, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore, type Tab } from "../store";

export default function TabBar() {
  const { t } = useTranslation();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);

  const select = (next: Tab) => {
    if (next === tab) return;
    navigator.vibrate?.(10);
    setTab(next);
  };

  const side = (id: "history" | "diary", Icon: typeof List) => (
    <button
      type="button"
      onClick={() => select(id)}
      aria-current={tab === id ? "page" : undefined}
      className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${tab === id ? "text-accent-text" : "text-fg-2"}`}
    >
      <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      <span className="text-[11px] font-medium leading-[14px]">{t(`tabs.${id}`)}</span>
    </button>
  );

  return (
    <nav className="relative z-30 flex items-center border-t border-sep bg-bg/85 px-4 pb-[env(safe-area-inset-bottom)] backdrop-blur-[20px]">
      {side("history", List)}
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => select("scan")}
          aria-label={t("tabs.scan")}
          aria-current={tab === "scan" ? "page" : undefined}
          className="-mt-5 flex size-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_4px_16px_rgba(255,90,31,0.35)] transition-transform active:scale-95"
        >
          <ScanLine size={26} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {side("diary", CalendarDays)}
    </nav>
  );
}
