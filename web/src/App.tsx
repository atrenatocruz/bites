import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { applyProfileLocale } from "./i18n";
import { useStore } from "./store";
import TabBar from "./components/TabBar";
import { Toaster } from "./components/Toast";
import ScanScreen from "./features/scan/ScanScreen";
import HistoryScreen from "./features/history/HistoryScreen";
import DiaryScreen from "./features/diary/DiaryScreen";
import Onboarding from "./features/onboarding/Onboarding";
import SettingsSheet from "./features/settings/SettingsSheet";
import Splash from "./features/splash/Splash";

interface AppProps { skipSplash?: boolean }

export default function App({ skipSplash = false }: AppProps) {
  const repo = useStore((s) => s.repo);
  const profile = useStore((s) => s.profile);
  const [splashDone, setSplashDone] = useState(skipSplash);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void repo
      .getProfile()
      .catch(() => null)
      .then((p) => {
        if (!live) return;
        useStore.getState().setProfile(p);
        if (p) applyProfileLocale(p.locale);
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [repo]);

  return (
    <>
      {loaded && (profile ? <Shell /> : <Onboarding onDone={() => {}} />)}
      <AnimatePresence>{!splashDone && <Splash onDone={() => setSplashDone(true)} />}</AnimatePresence>
    </>
  );
}

function Shell() {
  const tab = useStore((s) => s.tab);
  const profile = useStore((s) => s.profile);
  const reduce = useReducedMotion();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [redo, setRedo] = useState(false);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={tab}
            className={
              tab === "scan" ? "absolute inset-0" : "absolute inset-0 flex overflow-y-auto px-5 pt-[env(safe-area-inset-top)]"
            }
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {tab === "scan" ? <ScanScreen /> : tab === "history" ? <HistoryScreen /> : <DiaryScreen onOpenSettings={() => setSettingsOpen(true)} />}
          </motion.section>
        </AnimatePresence>
      </main>
      <TabBar />
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onRedo={() => {
          setSettingsOpen(false);
          setRedo(true);
        }}
      />
      {redo && profile && (
        <div className="fixed inset-0 z-50 bg-bg">
          <Onboarding initial={profile} onDone={() => setRedo(false)} onCancel={() => setRedo(false)} />
        </div>
      )}
      <Toaster />
    </div>
  );
}
