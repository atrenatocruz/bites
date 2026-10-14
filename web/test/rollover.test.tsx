import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { dayKey, macroTargets, type Profile } from "@bites/shared";
import App from "../src/App";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

const profile: Profile = {
  sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain",
  kcalTarget: 2760, macroTargets: macroTargets(2760, 80, "maintain"), locale: "en", units: "kcal", createdAt: 1,
};

describe("day rollover in the shell", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("advances the selected day even when the Diary is not mounted, and clears the pin", async () => {
    const repo = new LocalRepo("bites-rollover-1");
    await repo.saveProfile(profile);
    const real = new Date();
    const evening = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 23, 59, 0);
    const after = new Date(evening.getTime() + 2 * 60_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(evening);
    useStore.setState({ repo, profile: null, tab: "scan", selectedDay: dayKey(evening), selectedDayPinned: false });
    render(<App skipSplash />);
    await screen.findByRole("button", { name: "Scan" });
    vi.setSystemTime(after);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(useStore.getState().selectedDay).toBe(dayKey(after));
    expect(useStore.getState().selectedDayPinned).toBe(false);
  });

  it("unpins on rollover but keeps a different pinned past day in view", () => {
    useStore.setState({ selectedDay: "2026-03-01", selectedDayPinned: true });
    useStore.getState().rollDay("2026-03-05", "2026-03-06");
    expect(useStore.getState().selectedDay).toBe("2026-03-01");
    expect(useStore.getState().selectedDayPinned).toBe(false);
  });

  it("pins only when a non-today day is selected", () => {
    useStore.getState().setSelectedDay("2020-01-01");
    expect(useStore.getState().selectedDayPinned).toBe(true);
    useStore.getState().setSelectedDay(dayKey(new Date()));
    expect(useStore.getState().selectedDayPinned).toBe(false);
  });
});
