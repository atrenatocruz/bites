import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, configure, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { macroTargets } from "@bites/shared";
import Onboarding from "../src/features/onboarding/Onboarding";
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

  it("shows the Google button only when the repo is not local", async () => {
    useStore.setState({ repo: Object.assign(Object.create(repo), { kind: "firebase" as const }) });
    render(<Onboarding onDone={() => {}} initial={{ sex: "female", birthYear: 1990, heightCm: 165, weightKg: 60, activity: "light", goal: "lose", kcalTarget: 1700, macroTargets: { protein: 108, carbs: 180, fat: 53 }, locale: "system", units: "kcal", createdAt: 1 }} />);
    click("Continue");
    click("Continue");
    click("Continue");
    click("Continue");
    expect(await screen.findByRole("button", { name: "Save with Google" })).toBeTruthy();
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
