import { useTranslation } from "react-i18next";
import { useOnline } from "../lib/useOnline";

export default function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="shrink-0 bg-fg px-5 pb-2 pt-[calc(env(safe-area-inset-top)+8px)] text-center text-subhead text-bg">
      {t("errors.offline")}
    </div>
  );
}
