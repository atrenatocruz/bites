import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { kcalTarget, macroTargets, weeksToGoal, type Profile } from "@bites/shared";
import { toast } from "../../components/Toast";
import { applyProfileLocale } from "../../i18n";
import { useStore } from "../../store";
import PlanReveal from "./PlanReveal";
import Questions, { DEFAULT_ANSWERS, answersFrom, type Answers } from "./Questions";
import Slides from "./Slides";

interface OnboardingProps {
  onDone: (profile: Profile) => void;
  initial?: Profile;
  onCancel?: () => void;
}

type Stage = "slides" | "questions" | "plan";

const isPopupDismissed = (e: unknown) => ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes((e as { code?: string })?.code ?? "");

export default function Onboarding({ onDone, initial, onCancel }: OnboardingProps) {
  const { t } = useTranslation();
  const repo = useStore((s) => s.repo);
  const [stage, setStage] = useState<Stage>(initial ? "questions" : "slides");
  const [answers, setAnswers] = useState<Answers>(initial ? answersFrom(initial) : DEFAULT_ANSWERS);
  const [override, setOverride] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(Boolean(initial));
  const [notice, setNotice] = useState<string | null>(null);
  const googleFlow = repo.kind === "firebase" && !signedIn;

  useEffect(() => {
    if (initial || !repo.currentUser) return;
    let live = true;
    repo.currentUser().then((u) => live && u && setSignedIn(true), () => {});
    return () => {
      live = false;
    };
  }, [repo, initial]);

  const fields = {
    sex: answers.sex ?? "female",
    birthYear: Number(answers.birthYear),
    heightCm: Number(answers.heightCm),
    weightKg: Number(answers.weightKg),
    activity: answers.activity,
    goal: answers.goal,
    workType: answers.workType,
    sleepHours: answers.sleepHours,
    health: answers.health,
    ...(answers.goal === "maintain" ? {} : { targetWeightKg: Number(answers.targetKg), pace: answers.pace }),
  };
  const kcal = override ?? kcalTarget(fields);

  const build = (): Profile => ({
    ...fields,
    kcalTarget: kcal,
    macroTargets: macroTargets(kcal, fields.weightKg, fields.goal),
    locale: initial?.locale ?? "system",
    units: initial?.units ?? "kcal",
    createdAt: initial?.createdAt ?? Date.now(),
  });

  const finish = async (profile: Profile) => {
    await repo.saveProfile(profile);
    useStore.getState().setProfile(profile);
    applyProfileLocale(profile.locale);
    onDone(profile);
  };

  const start = async () => {
    setBusy(true);
    try {
      await finish(build());
    } catch {
      toast(t("errors.generic"));
      setBusy(false);
    }
  };

  const signIn = async (fresh: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await repo.signInWithGoogle?.();
      const stored = await repo.getProfile();
      if (stored) {
        useStore.getState().setProfile(stored);
        applyProfileLocale(stored.locale);
        toast(t("toasts.welcomeBack"));
        onDone(stored);
      } else {
        await fresh();
      }
    } catch (e) {
      setNotice(t(isPopupDismissed(e) ? "onboarding.google.cancelled" : "onboarding.google.failed"));
    }
    setBusy(false);
  };

  const continueWithGoogle = () => signIn(() => finish(build()));

  const signInFromSlides = () =>
    signIn(async () => {
      setSignedIn(true);
      setStage("questions");
    });

  if (stage === "slides") {
    return <Slides onDone={() => setStage("questions")} onSignIn={googleFlow ? () => void signInFromSlides() : undefined} notice={notice} busy={busy} />;
  }

  if (stage === "questions") {
    return (
      <Questions
        value={answers}
        onChange={(patch) => {
          setAnswers((a) => ({ ...a, ...patch }));
          setOverride(null);
        }}
        onFinish={() => {
          setNotice(null);
          setStage("plan");
        }}
        onExit={() => (initial ? onCancel?.() : setStage("slides"))}
      />
    );
  }

  return (
    <PlanReveal
      kcal={kcal}
      weightKg={fields.weightKg}
      goal={fields.goal}
      weeks={weeksToGoal(fields.goal, fields.weightKg, fields.targetWeightKg, fields.pace)}
      targetKg={fields.targetWeightKg}
      sleepHours={fields.sleepHours}
      health={fields.health}
      onKcalChange={setOverride}
      onStart={() => void (googleFlow ? continueWithGoogle() : start())}
      google={googleFlow}
      notice={notice}
      busy={busy}
    />
  );
}
