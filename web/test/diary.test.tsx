import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, configure, act } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { dayKey, type Meal } from "@bites/shared";
import DiaryScreen from "../src/features/diary/DiaryScreen";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 320, height: 176 }}>{children}</div> };
});

configure({ asyncUtilTimeout: 5000 });

let n = 0;
let repo: LocalRepo;

const at = (daysAgo: number, h: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, 0, 0, 0);
  return d;
};
const mk = (title: string, when: Date, kcal: number): Omit<Meal, "id"> => ({
  createdAt: when.getTime(), dayKey: dayKey(when), mealType: "lunch", title, thumb: null,
  items: [{ name: title, cookingMethod: "grilled", grams: 100, kcal, protein: 10, carbs: 20, fat: 5, fiber: 1, confidence: 0.9, assumption: null }],
  totals: { kcal, protein: 10, carbs: 20, fat: 5 }, source: "photo", edited: false,
});

describe("DiaryScreen", () => {
  beforeEach(async () => {
    repo = new LocalRepo(`bites-diary-${++n}`);
    await i18n.changeLanguage("en");
    useStore.setState({ repo, profile: null, dataVersion: 0, selectedDay: dayKey(new Date()) });
  });
  afterEach(cleanup);

  it("shows the average deficit and workouts in Trends once Health is connected", async () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "iPhone", onLine: true });
    const today = dayKey(new Date());
    const yesterday = dayKey(at(1, 12));
    const activity = {
      days: {
        [today]: { restingKcal: 1700, activeKcal: 800, workouts: [{ type: "Running", start: new Date().toISOString(), minutes: 30, kcal: 300 }] },
        [yesterday]: { restingKcal: 1700, activeKcal: 300, workouts: [] }, // no meals logged: left out of the average
      },
      lastSync: { syncedAt: Date.now(), tz: "UTC" },
      hasKey: true,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(activity), { status: 200 })));
    try {
      await repo.addMeal(mk("Lunch", at(0, 12), 2000));
      render(<DiaryScreen />);
      expect(await screen.findByText("Avg deficit")).toBeTruthy();
      const stat = screen.getByText("Avg deficit").parentElement!;
      expect(within(stat).getByText("500")).toBeTruthy();
      const workouts = screen.getByText("Workouts").parentElement!;
      expect(within(workouts).getByText("1")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      localStorage.clear();
    }
  });

  it("shows today's meals and the remaining kcal in the ring", async () => {
    await repo.addMeal(mk("Porridge", at(0, 8), 500));
    render(<DiaryScreen />);
    expect(await screen.findByText("Porridge")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Today");
    expect(await screen.findByRole("img", { name: "500 of 2000 kcal" })).toBeTruthy();
    expect(screen.getByText("1500")).toBeTruthy();
  });

  it("switches title and meals when a day is tapped in the week strip", async () => {
    const yesterday = at(1, 13);
    await repo.addMeal(mk("Porridge", at(0, 8), 500));
    await repo.addMeal(mk("Salad", yesterday, 300));
    render(<DiaryScreen />);
    await screen.findByText("Porridge");
    const yesterdayKey = dayKey(yesterday);
    if (new Date().getDay() === 1) fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    const strip = screen.getAllByRole("button", { pressed: false }).find((b) => b.getAttribute("aria-label")?.includes(String(yesterday.getDate())) && b.getAttribute("aria-label")?.includes(yesterday.toLocaleDateString("en-US", { weekday: "long" })));
    expect(strip).toBeTruthy();
    fireEvent.click(strip!);
    expect(await screen.findByText("Salad")).toBeTruthy();
    expect(screen.queryByText("Porridge")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("Today");
    expect(useStore.getState().selectedDay).toBe(yesterdayKey);
  });

  it("shows overshoot as +N over", async () => {
    await repo.addMeal(mk("Feast", at(0, 12), 2300));
    render(<DiaryScreen />);
    expect(await screen.findByText("+300")).toBeTruthy();
    expect(screen.getByText("over")).toBeTruthy();
  });

  it("uses kJ when the profile asks for it", async () => {
    await repo.addMeal(mk("Porridge", at(0, 8), 500));
    useStore.setState({
      profile: { sex: "female", birthYear: 1990, heightCm: 165, weightKg: 60, activity: "light", goal: "maintain", kcalTarget: 2000, macroTargets: { protein: 100, carbs: 250, fat: 70 }, locale: "en", units: "kj", createdAt: 0 },
    });
    render(<DiaryScreen />);
    expect(await screen.findByRole("img", { name: "2092 of 8368 kJ" })).toBeTruthy();
  });

  it("expands the month calendar from the title and shows the streak", async () => {
    await repo.addMeal(mk("Porridge", at(0, 8), 500));
    await repo.addMeal(mk("Salad", at(1, 13), 300));
    render(<DiaryScreen />);
    await screen.findByText("Porridge");
    fireEvent.click(screen.getByRole("button", { name: /Today\. Show month/ }));
    const header = await screen.findByText(/2 day streak/);
    expect(header.textContent).toContain("🔥");
    expect(within(screen.getByRole("button", { name: /Today\. Hide month/ })).getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("renders the trends section with stats", async () => {
    await repo.addMeal(mk("Porridge", at(0, 8), 2000));
    render(<DiaryScreen />);
    await screen.findByText("Porridge");
    expect(screen.getByText("Trends")).toBeTruthy();
    expect(screen.getByText("Average / day")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(screen.getByText("On target")).toBeTruthy();
  });
});
