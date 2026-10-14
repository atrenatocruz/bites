import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { enUS } from "date-fns/locale";
import "../src/i18n";
import i18n from "../src/i18n";
import type { HealthDay } from "@bites/shared";
import ActivityCard from "../src/features/diary/ActivityCard";

const body = { sex: "male", weightKg: 80, heightCm: 180, birthYear: 1996 } as const;
const NOW = Date.parse("2026-10-14T21:00:00Z");
const day: HealthDay = { restingKcal: 1700, activeKcal: 950, workouts: [{ type: "Running", start: "2026-10-14T07:10:00", minutes: 42, kcal: 410 }] };
const renderCard = (over: Partial<Parameters<typeof ActivityCard>[0]> = {}) =>
  render(<ActivityCard day={day} eatenKcal={2100} isToday={false} lastSync={{ syncedAt: NOW - 3_600_000, tz: "UTC" }} profile={body} year={2026} units="kcal" locale={enUS} now={NOW} {...over} />);

describe("ActivityCard", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("shows burned, eaten and the deficit with the day's workouts", () => {
    renderCard();
    expect(screen.getByText("2650")).toBeTruthy();
    expect(screen.getByText("2100")).toBeTruthy();
    expect(screen.getByText("550")).toBeTruthy();
    expect(screen.getByText("Deficit")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("07:10 · 42 min")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sync" })).toBeNull();
  });

  it("shows a surplus and the today / estimated labels", () => {
    renderCard({ day: { restingKcal: null, activeKcal: 100, workouts: [] }, eatenKcal: 3000, isToday: true });
    expect(screen.getByText("Surplus")).toBeTruthy();
    expect(screen.getByText(/so far/)).toBeTruthy();
    expect(screen.getByText(/estimated/)).toBeTruthy();
    expect(screen.getByText("No workouts")).toBeTruthy();
  });

  it("says when the day has no Health data", () => {
    renderCard({ day: undefined });
    expect(screen.getByText("No Health data for this day.")).toBeTruthy();
  });

  it("offers Sync when the last sync is over a day old", () => {
    renderCard({ lastSync: { syncedAt: NOW - 30 * 3_600_000, tz: "UTC" } });
    expect(screen.getByRole("link", { name: "Sync" }).getAttribute("href")).toBe("shortcuts://run-shortcut?name=Bites%20Health");
  });
});
