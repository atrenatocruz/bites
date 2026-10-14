import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import PillButton from "../../components/PillButton";
import { cameraPermission, dismissCamera, requestCameraAccess } from "../../lib/camera";
import { detectPlatform, type Platform } from "../../lib/install";

interface CameraScreenProps {
  onDone: () => void;
  platform?: Platform;
}

type View = "checking" | "ask" | "blocked";

export default function CameraScreen({ onDone, platform = detectPlatform() }: CameraScreenProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [view, setView] = useState<View>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void cameraPermission().then((state) => {
      if (!live) return;
      if (state === "granted") onDone();
      else setView(state === "denied" ? "blocked" : "ask");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allow = async () => {
    setBusy(true);
    const result = await requestCameraAccess();
    setBusy(false);
    if (result === "granted") onDone();
    else setView("blocked");
  };

  const skip = () => {
    dismissCamera();
    onDone();
  };

  if (view === "checking") return <div className="h-full" aria-hidden="true" />;

  const blocked = view === "blocked";
  const help = platform === "ios" ? "ios" : platform === "android" ? "android" : "other";

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]">
      <motion.div
        className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto"
        initial={{ opacity: 0, y: reduce ? 0 : 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 34 }}
      >
        <div className="mx-auto grid size-[72px] place-items-center rounded-full bg-accent text-white">
          <Camera size={34} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-center text-large-title tracking-[-0.02em]">{t(blocked ? "camera.blockedTitle" : "camera.title")}</h1>
        <p className="mt-3 text-center text-body text-fg-2">{t(blocked ? "camera.blockedBody" : "camera.body")}</p>

        <div className="mt-8 rounded-card bg-elevated px-4 py-4">
          <p className="text-headline">{t(blocked ? "camera.fixTitle" : "camera.tipTitle")}</p>
          <p className="mt-1 text-subhead text-fg-2">{t(`camera.${blocked ? "fix" : "tip"}.${help}`)}</p>
        </div>
      </motion.div>

      <div className="mx-auto w-full max-w-sm">
        {blocked ? (
          <PillButton className="w-full" onClick={onDone}>
            {t("camera.continue")}
          </PillButton>
        ) : (
          <PillButton className="w-full" onClick={() => void allow()} disabled={busy}>
            {t("camera.allow")}
          </PillButton>
        )}
        {!blocked && (
          <div className="mt-2 text-center">
            <PillButton variant="text" onClick={skip}>
              {t("camera.skip")}
            </PillButton>
          </div>
        )}
      </div>
    </div>
  );
}
