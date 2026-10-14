import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dayKey, macroTargets, type MacroTargets, type Profile } from "@bites/shared";
import PillButton from "../../components/PillButton";
import Sheet from "../../components/Sheet";
import { toast } from "../../components/Toast";
import { applyProfileLocale } from "../../i18n";
import { getPlan, redeemCode, setPlan as switchPlan, type PlanInfo } from "../../lib/api";
import { download, toCSV, toJSON } from "../../lib/export";
import type { AuthUser } from "../../lib/repo";
import { energyUnit, formatEnergy } from "../../lib/stats";
import { useStore } from "../../store";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  onRedo: () => void;
}

const KCAL_MIN = 800;
const KCAL_MAX = 6000;
const KJ_PER_KCAL = 4.184;
const MACRO_KEYS = ["protein", "carbs", "fat"] as const;

const sameMacros = (a: MacroTargets, b: MacroTargets) => a.protein === b.protein && a.carbs === b.carbs && a.fat === b.fat;

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      {title && <h3 className="px-1 pb-2 text-caption uppercase tracking-wide">{title}</h3>}
      <div className="divide-y divide-sep overflow-hidden rounded-card bg-elevated">{children}</div>
    </section>
  );
}

const rowClass = "flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2 text-left";

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-sep/60 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-8 flex-1 rounded-full px-2 text-subhead font-semibold transition-colors ${value === o.id ? "bg-bg shadow-sm" : "text-fg-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ label, value, unit, onStep }: { label: string; value: number; unit: string; onStep: (dir: 1 | -1) => void }) {
  const { t } = useTranslation();
  return (
    <div className={rowClass}>
      <span className="text-body">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={t("settings.decrease", { name: label })} onClick={() => onStep(-1)} className="grid size-8 place-items-center rounded-full bg-bg active:scale-95">
          <Minus size={16} strokeWidth={2} />
        </button>
        <span className="tabular min-w-[4.5ch] text-center text-body">{`${value} ${unit}`}</span>
        <button type="button" aria-label={t("settings.increase", { name: label })} onClick={() => onStep(1)} className="grid size-8 place-items-center rounded-full bg-bg active:scale-95">
          <Plus size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

export default function SettingsSheet({ open, onClose, onRedo }: SettingsSheetProps) {
  const { t } = useTranslation();
  const repo = useStore((s) => s.repo);
  const profile = useStore((s) => s.profile);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [draft, setDraft] = useState("");
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [switching, setSwitching] = useState(false);

  const units = profile?.units ?? "kcal";
  const target = profile?.kcalTarget;

  useEffect(() => {
    if (target !== undefined) setDraft(formatEnergy(target, units));
  }, [target, units]);

  useEffect(() => {
    if (!open || !repo.currentUser) return;
    let live = true;
    void repo.currentUser().then((a) => live && setAccount(a)).catch(() => live && setAccount(null));
    return () => {
      live = false;
    };
  }, [open, repo]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void repo.getIdToken().then((token) => getPlan(token)).then((p) => live && setPlan(p)).catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
  }, [open, repo]);

  const applyCode = async () => {
    if (!code.trim() || redeeming) return;
    setRedeeming(true);
    const result = await redeemCode(code, await repo.getIdToken().catch(() => null));
    setRedeeming(false);
    if (result.ok) {
      setPlan(result.plan);
      setCode("");
      toast(t("settings.codeOk"));
    } else {
      toast(t(result.reason === "invalid" ? "settings.codeInvalid" : result.reason === "limited" ? "settings.codeLimited" : "errors.generic"));
    }
  };

  const togglePlan = async () => {
    if (!plan || switching) return;
    setSwitching(true);
    const next = await switchPlan(plan.plan === "paid" ? "free" : "paid", await repo.getIdToken().catch(() => null));
    setSwitching(false);
    if (next) setPlan(next);
    else toast(t("errors.generic"));
  };

  const save = async (next: Profile) => {
    useStore.getState().setProfile(next);
    try {
      await repo.saveProfile(next);
    } catch {
      toast(t("errors.generic"));
    }
  };

  const setTarget = (kcal: number) => {
    if (!profile) return;
    const clamped = Math.min(KCAL_MAX, Math.max(KCAL_MIN, Math.round(kcal)));
    const manual = !sameMacros(profile.macroTargets, macroTargets(profile.kcalTarget, profile.weightKg, profile.goal));
    void save({
      ...profile,
      kcalTarget: clamped,
      macroTargets: manual ? profile.macroTargets : macroTargets(clamped, profile.weightKg, profile.goal),
    });
  };

  const commitDraft = () => {
    if (!profile) return;
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === "") return setDraft(formatEnergy(profile.kcalTarget, units));
    const kcal = units === "kj" ? n / KJ_PER_KCAL : n;
    setTarget(kcal);
    setDraft(formatEnergy(Math.min(KCAL_MAX, Math.max(KCAL_MIN, Math.round(kcal))), units));
  };

  const stepMacro = (key: (typeof MACRO_KEYS)[number], dir: 1 | -1) => {
    if (!profile) return;
    void save({ ...profile, macroTargets: { ...profile.macroTargets, [key]: Math.min(999, Math.max(0, profile.macroTargets[key] + dir * 5)) } });
  };

  const setLocale = (locale: Profile["locale"]) => {
    if (!profile) return;
    applyProfileLocale(locale);
    void save({ ...profile, locale });
  };

  const exportData = async (kind: "csv" | "json") => {
    try {
      const data = await repo.exportAll();
      const stamp = dayKey(new Date());
      if (kind === "csv") download(`bites-${stamp}.csv`, toCSV(data.meals), "text/csv;charset=utf-8");
      else download(`bites-${stamp}.json`, toJSON(data), "application/json");
      toast(t("toasts.exported"));
    } catch {
      toast(t("errors.generic"));
    }
  };

  const deleteAll = async () => {
    try {
      await repo.clearAll();
    } catch {
      toast(t("errors.generic"));
      return;
    }
    setConfirmOpen(false);
    onClose();
    const store = useStore.getState();
    store.setProfile(null);
    store.bump();
    toast(t("toasts.allDeleted"));
  };

  const signOut = async () => {
    try {
      await repo.signOut?.();
    } catch {
      toast(t("errors.generic"));
      return;
    }
    onClose();
    const store = useStore.getState();
    store.setProfile(null);
    store.bump();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} snap="full">
        <div className="px-5 pb-10">
          <h2 className="text-large-title">{t("settings.title")}</h2>

          {profile && (
            <>
              <Group>
                <label className={rowClass}>
                  <span className="text-body">{t("settings.target")}</span>
                  <span className="flex items-baseline gap-1.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
                      onBlur={commitDraft}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="tabular w-20 bg-transparent text-right text-body font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    <span className="text-body text-fg-2">{energyUnit(units)}</span>
                  </span>
                </label>
                {MACRO_KEYS.map((key) => (
                  <Stepper key={key} label={t(`common.${key}`)} value={profile.macroTargets[key]} unit={t("common.g")} onStep={(dir) => stepMacro(key, dir)} />
                ))}
              </Group>

              <Group title={t("settings.profile")}>
                <button type="button" className={`${rowClass} active:opacity-60`} onClick={onRedo}>
                  <span className="text-body">{t("settings.profileRedo")}</span>
                  <ChevronRight size={18} strokeWidth={1.75} className="text-fg-2" aria-hidden="true" />
                </button>
              </Group>

              <section className="mt-7">
                <h3 className="px-1 pb-2 text-caption uppercase tracking-wide">{t("settings.language")}</h3>
                <Segmented
                  label={t("settings.language")}
                  value={profile.locale}
                  options={[
                    { id: "system", label: t("settings.languageSystem") },
                    { id: "pt-PT", label: t("settings.languagePt") },
                    { id: "en", label: t("settings.languageEn") },
                  ]}
                  onChange={setLocale}
                />
              </section>

              <section className="mt-7">
                <h3 className="px-1 pb-2 text-caption uppercase tracking-wide">{t("settings.units")}</h3>
                <Segmented
                  label={t("settings.units")}
                  value={profile.units}
                  options={[
                    { id: "kcal", label: t("common.kcal") },
                    { id: "kj", label: t("common.kj") },
                  ]}
                  onChange={(u) => void save({ ...profile, units: u })}
                />
              </section>
            </>
          )}

          {plan && (
            <Group title={t("settings.plan")}>
              <div className={rowClass}>
                <span className="min-w-0">
                  <span className="block text-body">{t(plan.plan === "paid" ? "settings.planPaid" : "settings.planFree")}</span>
                  <span className="block text-subhead text-fg-2">{t(plan.plan === "paid" ? "settings.planPaidHint" : "settings.planFreeHint", { count: plan.dailyLimit })}</span>
                </span>
                {plan.unlocked && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={plan.plan === "paid"}
                    aria-label={t("settings.planToggle")}
                    disabled={switching}
                    onClick={() => void togglePlan()}
                    className={`relative h-8 w-[52px] shrink-0 rounded-full transition-colors disabled:opacity-60 ${plan.plan === "paid" ? "bg-accent" : "bg-sep"}`}
                  >
                    <span className={`absolute left-1 top-1 size-6 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none ${plan.plan === "paid" ? "translate-x-5" : ""}`} />
                  </button>
                )}
              </div>
              {!plan.unlocked && (
                <form
                  className={rowClass}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void applyCode();
                  }}
                >
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.slice(0, 64))}
                    aria-label={t("settings.codeLabel")}
                    placeholder={t("settings.codePlaceholder")}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-fg-2 focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  <button type="submit" disabled={!code.trim() || redeeming} className="shrink-0 text-body font-semibold text-accent-text active:opacity-60 disabled:opacity-40">
                    {t("settings.codeApply")}
                  </button>
                </form>
              )}
            </Group>
          )}

          {repo.kind !== "local" && (
            <Group title={t("settings.account")}>
              <div className={rowClass}>
                <span className="min-w-0">
                  <span className="block truncate text-body">{account?.name ?? account?.email ?? t("settings.account")}</span>
                  {account?.name && account.email && <span className="block truncate text-subhead text-fg-2">{account.email}</span>}
                </span>
                <button type="button" className="shrink-0 text-body font-semibold text-accent-text active:opacity-60" onClick={() => void signOut()}>
                  {t("settings.signOut")}
                </button>
              </div>
            </Group>
          )}

          <Group>
            <button type="button" className={`${rowClass} active:opacity-60`} onClick={() => void exportData("csv")}>
              <span className="text-body">{t("settings.exportCsv")}</span>
            </button>
            <button type="button" className={`${rowClass} active:opacity-60`} onClick={() => void exportData("json")}>
              <span className="text-body">{t("settings.exportJson")}</span>
            </button>
            <button type="button" className={`${rowClass} active:opacity-60`} onClick={() => setConfirmOpen(true)}>
              <span className="text-body text-danger">{t("settings.deleteAll")}</span>
            </button>
          </Group>

          <section className="mt-7 px-1">
            <h3 className="pb-2 text-caption uppercase tracking-wide">{t("settings.about")}</h3>
            <p className="text-subhead tabular">{t("settings.version", { version: __APP_VERSION__ })}</p>
            <p className="mt-2 text-subhead text-fg-2">{t("settings.disclaimer")}</p>
          </section>
        </div>
      </Sheet>

      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <div className="px-5 pb-6 text-center">
          <h2 className="text-title">{t("settings.deleteConfirmTitle")}</h2>
          <p className="mt-2 text-body text-fg-2">{t("settings.deleteConfirmBody")}</p>
          <div className="mt-6 flex flex-col gap-2">
            <PillButton className="w-full !bg-danger" onClick={() => void deleteAll()}>
              {t("settings.deleteConfirm")}
            </PillButton>
            <PillButton variant="text" className="w-full" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </PillButton>
          </div>
        </div>
      </Sheet>
    </>
  );
}
