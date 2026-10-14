import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { dayKey, type Meal } from "@bites/shared";
import HistoryScreen from "../src/features/history/HistoryScreen";
import { Toaster } from "../src/components/Toast";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

let n = 0;
let repo: LocalRepo;

const at = (daysAgo: number, h: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, 0, 0, 0);
  return d;
};
const item = (name: string, grams: number, kcal: number) => ({
  name, cookingMethod: "grilled", grams, kcal, protein: kcal / 10, carbs: kcal / 8, fat: kcal / 30, fiber: 1, confidence: 0.9, assumption: null,
});
const mk = (title: string, when: Date, kcal: number, itemName = title): Omit<Meal, "id"> => ({
  createdAt: when.getTime(), dayKey: dayKey(when), mealType: "lunch", title, thumb: null,
  items: [item(itemName, 100, kcal)], totals: { kcal, protein: kcal / 10, carbs: kcal / 8, fat: kcal / 30 }, source: "photo", edited: false,
});

async function setup() {
  await repo.addMeal(mk("Porridge", at(0, 8), 300));
  await repo.addMeal(mk("Pão com queijo", at(0, 10), 200, "Queijo"));
  await repo.addMeal(mk("Salad", at(1, 13), 150));
  useStore.setState({ repo, tab: "history", dataVersion: 0 });
  render(<><HistoryScreen /><Toaster /></>);
  await screen.findByText("Porridge");
}

describe("HistoryScreen", () => {
  beforeEach(async () => {
    repo = new LocalRepo(`bites-history-${++n}`);
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("groups meals by day with headers and day totals", async () => {
    await setup();
    const today = screen.getByRole("heading", { name: /^Today/ });
    expect(within(today).getByText("500")).toBeTruthy();
    const yesterday = screen.getByRole("heading", { name: /^Yesterday/ });
    expect(within(yesterday).getByText("150")).toBeTruthy();
  });

  it("shows the empty state without meals", async () => {
    useStore.setState({ repo, dataVersion: 0 });
    render(<HistoryScreen />);
    expect(await screen.findByText("Your scans will show up here.")).toBeTruthy();
  });

  it("filters by title and item name ignoring case and accents", async () => {
    await setup();
    const search = screen.getByPlaceholderText("Search meals");
    fireEvent.change(search, { target: { value: "PAO" } });
    expect(screen.getByText("Pão com queijo")).toBeTruthy();
    expect(screen.queryByText("Porridge")).toBeNull();
    fireEvent.change(search, { target: { value: "queijo" } });
    expect(screen.getByText("Pão com queijo")).toBeTruthy();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No meals match your search.")).toBeTruthy();
  });

  it("keeps the true day total while a search filters the list", async () => {
    await setup();
    fireEvent.change(screen.getByPlaceholderText("Search meals"), { target: { value: "porridge" } });
    const today = screen.getByRole("heading", { name: /^Today/ });
    await waitFor(() => expect(within(today).getByText("500")).toBeTruthy());
    expect(screen.queryByText("Pão com queijo")).toBeNull();
  });

  it("ignores a second delete of the same meal while the first is in flight", async () => {
    await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = repo.deleteMeal.bind(repo);
    const spy = vi.spyOn(repo, "deleteMeal").mockImplementation(async (id) => { await gate; return real(id); });
    fireEvent.click(screen.getByText("Salad"));
    const del = await screen.findByRole("button", { name: "Delete meal" });
    fireEvent.click(del);
    fireEvent.click(del);
    release();
    await waitFor(() => expect(screen.queryByText("Salad")).toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Salad");
    expect((await repo.listMeals()).filter((m) => m.title === "Salad")).toHaveLength(1);
  });

  it("deletes a meal and restores it with Undo", async () => {
    await setup();
    fireEvent.click(screen.getByText("Salad"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete meal" }));
    await waitFor(() => expect(screen.queryByText("Salad")).toBeNull());
    expect((await repo.listMeals()).map((m) => m.title)).not.toContain("Salad");
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Salad")).toBeTruthy();
    const restored = (await repo.listMeals()).find((m) => m.title === "Salad")!;
    expect(restored.dayKey).toBe(dayKey(at(1, 13)));
    expect(restored.createdAt).toBe(at(1, 13).getTime());
  });

  it("adds the meal back only once when Undo is tapped twice", async () => {
    await setup();
    fireEvent.click(screen.getByText("Salad"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete meal" }));
    await waitFor(() => expect(screen.queryByText("Salad")).toBeNull());
    const undo = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    fireEvent.click(undo);
    await screen.findByText("Salad");
    await new Promise((r) => setTimeout(r, 50));
    expect((await repo.listMeals()).filter((m) => m.title === "Salad")).toHaveLength(1);
  });

  it("edits grams in the detail sheet and saves with edited:true", async () => {
    await setup();
    fireEvent.click(screen.getByText("Salad"));
    fireEvent.click(await screen.findByRole("button", { name: /Grams for Salad \+10/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => {
      const m = (await repo.listMeals()).find((x) => x.title === "Salad")!;
      expect(m.edited).toBe(true);
      expect(m.items[0]!.grams).toBe(110);
      expect(m.totals.kcal).toBe(165);
    });
  });

  it("logs a meal again today", async () => {
    await setup();
    fireEvent.click(screen.getByText("Salad"));
    fireEvent.click(await screen.findByRole("button", { name: "Log again today" }));
    await waitFor(async () => {
      const salads = (await repo.listMeals()).filter((m) => m.title === "Salad");
      expect(salads).toHaveLength(2);
      const copy = salads.find((m) => m.dayKey === dayKey(new Date()))!;
      expect(copy.items).toEqual(salads.find((m) => m !== copy)!.items);
      expect(Math.abs(copy.createdAt - Date.now())).toBeLessThan(10_000);
    });
  });
});
