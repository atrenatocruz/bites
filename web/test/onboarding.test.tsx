import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, configure, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { macroTargets, type Profile } from "@bites/shared";
import Onboarding from "../src/features/onboarding/Onboarding";
import { Toaster } from "../src/components/Toast";
import Splash from "../src/features/splash/Splash";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

configure({ asyncUtilTimeout: 5000 });

let n = 0;
let repo: LocalRepo;

const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));

describe("Onboarding", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0));
    repo = new LocalRepo(`bites-onb-${++n}`);
    await i18n.changeLanguage("en");
    useStore.setState({ repo, profile: null, dataVersion: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("goes through slides and questions, reveals 2760 kcal and saves the profile", async () => {
    const done = vi.fn();
    render(<Onboarding onDone={done} />);

    expect(screen.getByText("Point. Snap. Know.")).toBeTruthy();
    click("Continue");
    expect(screen.getByText("Every ingredient, counted.")).toBeTruthy();
    click("Continue");
    expect(screen.getByText("Your day at a glance.")).toBeTruthy();
    click("Continue");

    expect(screen.getByText("What's your goal?")).toBeTruthy();
    click("Maintain weight");
    click("Continue");

    click("Male");
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "1996" } });
    click("Continue");

    fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "80" } });
    expect(screen.getByText("BMI 24.7 · healthy")).toBeTruthy();
    click("Continue");

    click(/Moderate/);
    click("Continue");

    expect(await screen.findByText("2760")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save with Google" })).toBeNull();
    click("Start");

    await waitFor(() => expect(done).toHaveBeenCalled());
    const saved = await repo.getProfile();
    expect(saved).toMatchObject({ sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain", kcalTarget: 2760, units: "kcal", locale: "system" });
    expect(saved?.macroTargets).toEqual(macroTargets(2760, 80, "maintain"));
    expect(useStore.getState().profile?.kcalTarget).toBe(2760);
  });

  it("blocks Continue until the sex is chosen", () => {
    render(<Onboarding onDone={() => {}} />);
    click("Continue");
    click("Continue");
    click("Continue");
    click("Continue");
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe("with Google sign-in (Firebase mode)", () => {
    const fake = (stored: Profile | null, signIn: () => Promise<void> = async () => {}) => {
      const signInWithGoogle = vi.fn(signIn);
      const saveProfile = vi.fn(repo.saveProfile.bind(repo));
      const getProfile = vi.fn(async () => stored);
      const fakeRepo = Object.assign(Object.create(repo), {
        kind: "firebase" as const,
        currentUser: async () => null,
        signInWithGoogle,
        saveProfile,
        getProfile,
      });
      useStore.setState({ repo: fakeRepo });
      return { signInWithGoogle, saveProfile };
    };

    const toPlan = () => {
      click("Continue");
      click("Continue");
      click("Continue");
      click("Maintain weight");
      click("Continue");
      click("Male");
      fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "1996" } });
      click("Continue");
      fireEvent.change(screen.getByLabelText("Height (cm)"), { target: { value: "180" } });
      fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "80" } });
      click("Continue");
      click(/Moderate/);
      click("Continue");
    };

    const existing: Profile = { ...({} as Profile), sex: "female", birthYear: 1990, heightCm: 165, weightKg: 60, activity: "light", goal: "lose", kcalTarget: 1700, macroTargets: { protein: 108, carbs: 180, fat: 53 }, locale: "en", units: "kcal", createdAt: 1 };

    it("replaces Start and Save with Google by a single Continue with Google button", async () => {
      fake(null);
      render(<Onboarding onDone={() => {}} />);
      toPlan();
      expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Save with Google" })).toBeNull();
    });

    it("keeps the stored profile for a returning Google account", async () => {
      const { signInWithGoogle, saveProfile } = fake(existing);
      const done = vi.fn();
      render(
        <>
          <Onboarding onDone={done} />
          <Toaster />
        </>,
      );
      toPlan();
      click("Continue with Google");
      await waitFor(() => expect(done).toHaveBeenCalledWith(existing));
      expect(signInWithGoogle).toHaveBeenCalledTimes(1);
      expect(saveProfile).not.toHaveBeenCalled();
      expect(useStore.getState().profile).toEqual(existing);
      expect(await screen.findByText("Welcome back")).toBeTruthy();
    });

    it("saves the answers for a new Google account", async () => {
      const { saveProfile } = fake(null);
      const done = vi.fn();
      render(<Onboarding onDone={done} />);
      toPlan();
      click("Continue with Google");
      await waitFor(() => expect(done).toHaveBeenCalled());
      expect(saveProfile).toHaveBeenCalledTimes(1);
      expect(saveProfile.mock.calls[0]![0]).toMatchObject({ sex: "male", birthYear: 1996, kcalTarget: 2760 });
    });

    it("stays on the plan with a calm message when the popup is closed", async () => {
      const { saveProfile } = fake(null, () => Promise.reject(Object.assign(new Error("closed"), { code: "auth/popup-closed-by-user" })));
      const done = vi.fn();
      render(<Onboarding onDone={done} />);
      toPlan();
      click("Continue with Google");
      expect(await screen.findByText(/Sign-in was cancelled/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
      expect(done).not.toHaveBeenCalled();
      expect(saveProfile).not.toHaveBeenCalled();
    });

    it("shows an error and allows another try after a failure", async () => {
      const { signInWithGoogle } = fake(null, () => Promise.reject(new Error("network")));
      render(<Onboarding onDone={() => {}} />);
      toPlan();
      click("Continue with Google");
      expect(await screen.findByText(/Couldn't sign in/)).toBeTruthy();
      await waitFor(() => expect((screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement).disabled).toBe(false));
      click("Continue with Google");
      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(2));
    });

    it("enters the app from the first-slide sign-in link when a profile exists", async () => {
      fake(existing);
      const done = vi.fn();
      render(<Onboarding onDone={done} />);
      click("Already have an account? Sign in");
      await waitFor(() => expect(done).toHaveBeenCalledWith(existing));
    });

    it("continues with the questions after signing in without a profile, then just starts", async () => {
      const { saveProfile } = fake(null);
      const done = vi.fn();
      render(<Onboarding onDone={done} />);
      click("Already have an account? Sign in");
      expect(await screen.findByText("What's your goal?")).toBeTruthy();
      click("Maintain weight");
      click("Continue");
      click("Female");
      click("Continue");
      click("Continue");
      click(/Moderate/);
      click("Continue");
      expect(await screen.findByText("Your daily plan")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
      click("Start");
      await waitFor(() => expect(done).toHaveBeenCalled());
      expect(saveProfile).toHaveBeenCalledTimes(1);
    });
  });

  it("offers Start and no sign-in link in local mode", () => {
    render(<Onboarding onDone={() => {}} />);
    expect(screen.queryByText("Already have an account? Sign in")).toBeNull();
  });
});

describe("Splash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("finishes by itself within 1.2 s", () => {
    const done = vi.fn();
    render(<Splash onDone={done} />);
    expect(screen.getByText("Bites")).toBeTruthy();
    vi.advanceTimersByTime(900);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("is skipped by a tap, only once", () => {
    const done = vi.fn();
    const { container } = render(<Splash onDone={done} />);
    fireEvent.pointerDown(container.firstElementChild!);
    fireEvent.pointerDown(container.firstElementChild!);
    vi.advanceTimersByTime(2000);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
