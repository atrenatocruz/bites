import { useTranslation } from "react-i18next";
import { useStore, type Tab } from "./store";

const TABS: Tab[] = ["history", "scan", "diary"];

export default function App() {
  const { t } = useTranslation();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <main className="flex flex-1 items-center justify-center px-5">
        <h1 className="text-large-title">{t(`tabs.${tab}`)}</h1>
      </main>
      <nav className="flex justify-around border-t border-sep pb-[env(safe-area-inset-bottom)]">
        {TABS.map((id) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`h-16 flex-1 text-subhead ${tab === id ? "text-accent" : "text-fg-2"}`}>
            {t(`tabs.${id}`)}
          </button>
        ))}
      </nav>
    </div>
  );
}
