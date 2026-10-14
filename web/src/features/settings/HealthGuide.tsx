import { useTranslation } from "react-i18next";
import PillButton from "../../components/PillButton";
import Sheet from "../../components/Sheet";

const STEPS = ["guide1", "guide2", "guide3", "guide4"] as const;

/** How to make the Shortcut run every night: iOS does not let a shared Shortcut set up its own automation. */
export default function HealthGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 pt-2">
        <h2 className="text-title">{t("settings.health.guideTitle")}</h2>
        <ol className="mt-4 space-y-3">
          {STEPS.map((k, i) => (
            <li key={k} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-subhead font-semibold text-on-accent">{i + 1}</span>
              <span className="pt-0.5 text-body">{t(`settings.health.${k}`)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-subhead text-fg-2">{t("settings.health.guideTip")}</p>
        <PillButton className="mt-6 w-full" onClick={onClose}>
          {t("settings.health.done")}
        </PillButton>
      </div>
    </Sheet>
  );
}
