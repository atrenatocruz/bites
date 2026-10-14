import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStore } from "./store";
import TabBar from "./components/TabBar";
import { Toaster } from "./components/Toast";
import ScanScreen from "./features/scan/ScanScreen";
import HistoryScreen from "./features/history/HistoryScreen";

export default function App() {
  const { t } = useTranslation();
  const tab = useStore((s) => s.tab);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={tab}
            className={
              tab === "scan"
                ? "absolute inset-0"
                : tab === "history"
                  ? "absolute inset-0 flex overflow-y-auto px-5 pt-[env(safe-area-inset-top)]"
                  : "absolute inset-0 flex items-center justify-center overflow-y-auto px-5 pt-[env(safe-area-inset-top)]"
            }
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {tab === "scan" ? <ScanScreen /> : tab === "history" ? <HistoryScreen /> : <h1 className="text-large-title">{t(`tabs.${tab}`)}</h1>}
          </motion.section>
        </AnimatePresence>
      </main>
      <TabBar />
      <Toaster />
    </div>
  );
}
