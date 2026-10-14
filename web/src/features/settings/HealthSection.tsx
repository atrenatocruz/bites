import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { dayKey } from "@bites/shared";
import { toast } from "../../components/Toast";
import { createKey, deleteKey, fetchActivity, healthAvailable, runShortcutUrl, shortcutUrl } from "../../lib/activity";
import { useStore } from "../../store";
import HealthGuide from "./HealthGuide";

type Copy = { state: "idle" } | { state: "copied" } | { state: "manual"; key: string };

const rowClass = "flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2 text-left";
const linkClass = `${rowClass} text-body font-semibold text-accent-text active:opacity-60`;

/** Starts the clipboard write inside the tap: iOS refuses writes that begin after an await. */
function copyPending(key: Promise<string | null>): Promise<boolean> {
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return Promise.resolve(false);
    const blob = key.then((k) => {
      if (!k) throw new Error("no key");
      return new Blob([k], { type: "text/plain" });
    });
    return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

export default function HealthSection() {
  const { t } = useTranslation();
  const repo = useStore((s) => s.repo);
  const [status, setStatus] = useState<{ hasKey: boolean; syncedAt: number | null } | null>(null);
  const [copy, setCopy] = useState<Copy>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const available = healthAvailable();
  const link = shortcutUrl();

  useEffect(() => {
    if (!available) return;
    let live = true;
    const today = dayKey(new Date());
    void repo
      .getIdToken()
      .catch(() => null)
      .then((token) => fetchActivity(today, today, token))
      .then((r) => {
        if (live && r) setStatus({ hasKey: r.hasKey, syncedAt: r.lastSync?.syncedAt ?? null });
      });
    return () => {
      live = false;
    };
  }, [available, repo]);

  const connect = () => {
    setBusy(true);
    const key = repo
      .getIdToken()
      .catch(() => null)
      .then((token) => createKey(token));
    const copied = copyPending(key);
    void Promise.all([key, copied]).then(([k, ok]) => {
      setBusy(false);
      if (!k) {
        toast(t("errors.generic"));
        return;
      }
      setStatus((s) => ({ hasKey: true, syncedAt: s?.syncedAt ?? null }));
      setCopy(ok ? { state: "copied" } : { state: "manual", key: k });
    });
  };

  const disconnect = async () => {
    setBusy(true);
    const ok = await deleteKey(await repo.getIdToken().catch(() => null));
    setBusy(false);
    if (!ok) {
      toast(t("errors.generic"));
      return;
    }
    setStatus({ hasKey: false, syncedAt: null });
    setCopy({ state: "idle" });
    toast(t("settings.health.disconnected"));
  };

  const connected = status?.hasKey === true && status.syncedAt !== null;
  const pending = status?.hasKey === true && !connected;
  const started = copy.state !== "idle";

  return (
    <section className="mt-7">
      <h3 className="px-1 pb-2 text-caption uppercase tracking-wide">{t("settings.health.title")}</h3>
      <div className="divide-y divide-sep overflow-hidden rounded-card bg-elevated">
        {!available ? (
          <p className="px-4 py-3 text-subhead text-fg-2">{t("settings.health.iphoneOnly")}</p>
        ) : (
          <>
            {connected ? (
              <p className="px-4 py-3 text-subhead">{t("settings.health.lastSync", { when: format(status!.syncedAt!, "d MMM, HH:mm") })}</p>
            ) : (
              <p className="px-4 py-3 text-subhead text-fg-2">{t("settings.health.intro")}</p>
            )}
            {copy.state === "copied" && <p className="px-4 py-3 text-subhead">{t("settings.health.copied")}</p>}
            {copy.state === "manual" && (
              <div className="px-4 py-3">
                <p className="text-subhead">{t("settings.health.copyFailed")}</p>
                <p className="mt-2 select-all break-all rounded-xl bg-bg px-3 py-2 font-mono text-subhead">{copy.key}</p>
                <button
                  type="button"
                  className="mt-2 text-body font-semibold text-accent-text active:opacity-60"
                  onClick={() => {
                    const { key } = copy;
                    void navigator.clipboard?.writeText(key).then(
                      () => setCopy({ state: "copied" }),
                      () => {},
                    );
                  }}
                >
                  {t("settings.health.copy")}
                </button>
              </div>
            )}
            {started && link && (
              <a href={link} target="_blank" rel="noreferrer" className={linkClass}>
                {t("settings.health.addShortcut")}
              </a>
            )}
            {(pending || started) && !connected && <p className="px-4 py-3 text-subhead text-fg-2">{t("settings.health.finish")}</p>}
            {(pending || connected || started) && (
              <a href={runShortcutUrl()} className={linkClass}>
                {t("settings.health.syncNow")}
              </a>
            )}
            {!started && !connected && link && status && (
              <button type="button" disabled={busy} className={`${linkClass} disabled:opacity-50`} onClick={connect}>
                {status.hasKey ? t("settings.health.showKey") : t("settings.health.connect")}
              </button>
            )}
            {connected && (
              <button type="button" className={linkClass} onClick={() => setGuideOpen(true)}>
                {t("settings.health.nightly")}
              </button>
            )}
            {status?.hasKey && (
              <button type="button" disabled={busy} className={`${rowClass} text-body text-danger active:opacity-60 disabled:opacity-50`} onClick={() => void disconnect()}>
                {t("settings.health.disconnect")}
              </button>
            )}
          </>
        )}
      </div>
      <HealthGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </section>
  );
}
