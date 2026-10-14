import { useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import Logo from "../../components/Logo";
import PillButton from "../../components/PillButton";
import { canPromptInstall, detectPlatform, dismissInstall, promptInstall, subscribeInstall, type Platform } from "../../lib/install";

interface InstallScreenProps {
  onDone: () => void;
  platform?: Platform;
}

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-4 rounded-card bg-elevated px-4 py-3.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-subhead font-bold text-white" aria-hidden="true">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-body">{children}</span>
      <span className="shrink-0 text-fg-2" aria-hidden="true">
        {icon}
      </span>
    </li>
  );
}

export default function InstallScreen({ onDone, platform = detectPlatform() }: InstallScreenProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCanPrompt(canPromptInstall());
    return subscribeInstall(() => setCanPrompt(canPromptInstall()));
  }, []);

  const install = async () => {
    setBusy(true);
    const accepted = await promptInstall();
    setBusy(false);
    if (accepted) onDone();
  };

  const skip = () => {
    dismissInstall();
    onDone();
  };

  const ios = platform === "ios";

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]">
      <motion.div
        className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto"
        initial={{ opacity: 0, y: reduce ? 0 : 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 34 }}
      >
        <div className="flex justify-center">
          <Logo size={72} bitten />
        </div>
        <h1 className="mt-6 text-center text-large-title tracking-[-0.02em]">{t("install.title")}</h1>
        <p className="mt-3 text-center text-body text-fg-2">{t(ios ? "install.bodyIos" : "install.bodyAndroid")}</p>

        {ios && (
          <ol className="mt-8 flex flex-col gap-3">
            <Step n={1} icon={<Share size={22} strokeWidth={1.75} />}>
              {t("install.ios.share")}
            </Step>
            <Step n={2} icon={<SquarePlus size={22} strokeWidth={1.75} />}>
              {t("install.ios.add")}
            </Step>
            <Step n={3} icon={null}>
              {t("install.ios.confirm")}
            </Step>
          </ol>
        )}

        {!ios && !canPrompt && (
          <ol className="mt-8 flex flex-col gap-3">
            <Step n={1} icon={<EllipsisVertical size={22} strokeWidth={1.75} />}>
              {t("install.android.menu")}
            </Step>
            <Step n={2} icon={<SquarePlus size={22} strokeWidth={1.75} />}>
              {t("install.android.add")}
            </Step>
          </ol>
        )}
      </motion.div>

      <div className="mx-auto w-full max-w-sm">
        {ios || !canPrompt ? (
          <PillButton className="w-full" onClick={onDone}>
            {t("install.done")}
          </PillButton>
        ) : (
          <PillButton className="w-full" onClick={() => void install()} disabled={busy}>
            {t("install.button")}
          </PillButton>
        )}
        <div className="mt-2 text-center">
          <PillButton variant="text" onClick={skip}>
            {t("install.skip")}
          </PillButton>
        </div>
      </div>
    </div>
  );
}
