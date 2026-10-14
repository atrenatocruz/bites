import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "../src/i18n";
import { dayKey, type AnalyzeResult, type FoodItem } from "@bites/shared";
import ResultSheet from "../src/features/scan/ResultSheet";
import { ApiError } from "../src/lib/api";
import { useStore } from "../src/store";

const item = (name: string, grams: number, kcal: number): FoodItem => ({
  name, cookingMethod: "grilled", grams, kcal, protein: kcal / 10, carbs: kcal / 8, fat: kcal / 30, fiber: 1, confidence: 0.9, assumption: null,
});
const RESULT: AnalyzeResult = {
  isFood: true, title: "Bitoque", mealType: "lunch",
  items: [item("Beef", 100, 250), { ...item("Fries", 100, 300), confidence: 0.3, assumption: "Assumed fried" }],
  totals: { kcal: 550, protein: 55, carbs: 70, fat: 18 }, kcalRange: { low: 500, high: 600 }, confidence: 0.8,
  scaleReference: null, followUpQuestion: "Are the fries baked?", notes: null,
};

const noop = async () => RESULT;
function setup(over: Partial<React.ComponentProps<typeof ResultSheet>> = {}) {
  const addMeal = vi.fn(async (m) => ({ ...m, id: "m1" }));
  useStore.setState({ repo: { addMeal } as never, tab: "scan", selectedDay: "2026-03-02", bump: vi.fn() });
  const props = { open: true, result: RESULT, source: "photo" as const, thumb: "data:image/webp;base64,xx", hint: "", onClose: vi.fn(), onRetake: vi.fn(), onSaved: vi.fn(), reanalyze: noop, analyzeText: noop, ...over };
  render(<ResultSheet {...props} />);
  return { addMeal, props };
}

describe("ResultSheet", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows title, hero total and range", () => {
    setup();
    expect(screen.getByText("Bitoque")).toBeTruthy();
    expect(screen.getByTestId("hero-kcal").textContent).toBe("550");
    expect(screen.getByText(/between 500 and 600/)).toBeTruthy();
  });

  it("scales the item and the hero total when grams change", () => {
    setup();
    fireEvent.click(screen.getAllByRole("button", { name: /\+10/ })[0]!);
    expect(screen.getByDisplayValue("110")).toBeTruthy();
    expect(screen.getByTestId("hero-kcal").textContent).toBe("575");
    expect(screen.getByText("275")).toBeTruthy();
  });

  it("accepts typed grams", () => {
    setup();
    fireEvent.change(screen.getAllByRole("spinbutton")[0]!, { target: { value: "200" } });
    expect(screen.getByTestId("hero-kcal").textContent).toBe("800");
  });

  it("saves with the selected day, source, thumb and edited flag", async () => {
    const { addMeal, props } = setup();
    fireEvent.click(screen.getAllByRole("button", { name: /\+10/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(addMeal).toHaveBeenCalledTimes(1));
    const saved = addMeal.mock.calls[0]![0];
    expect(saved.dayKey).toBe("2026-03-02");
    expect(saved.source).toBe("photo");
    expect(saved.thumb).toBe("data:image/webp;base64,xx");
    expect(saved.edited).toBe(true);
    expect(saved.title).toBe("Bitoque");
    expect(saved.mealType).toBe("lunch");
    expect(saved.totals.kcal).toBe(575);
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  });

  it("saves untouched meals as not edited", async () => {
    const { addMeal } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(addMeal).toHaveBeenCalled());
    expect(addMeal.mock.calls[0]![0].edited).toBe(false);
  });

  it("cycles the meal type", async () => {
    const { addMeal } = setup();
    fireEvent.click(screen.getByRole("button", { name: /meal type/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(addMeal).toHaveBeenCalled());
    expect(addMeal.mock.calls[0]![0].mealType).toBe("dinner");
  });

  it("falls back to today when no day is selected", async () => {
    const { addMeal } = setup();
    useStore.setState({ selectedDay: "" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(addMeal).toHaveBeenCalled());
    expect(addMeal.mock.calls[0]![0].dayKey).toBe(dayKey(new Date()));
  });

  it("re-analyzes with the previous hint plus the answer", async () => {
    const reanalyze = vi.fn(async () => ({ ...RESULT, title: "Baked", followUpQuestion: null }));
    setup({ hint: "no sauce", reanalyze });
    fireEvent.change(screen.getByPlaceholderText("Your answer"), { target: { value: "yes baked" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(reanalyze).toHaveBeenCalledWith("no sauce; Are the fries baked? yes baked"));
    await screen.findByText("Baked");
  });

  it("shows a calm error when an add-item analysis fails and keeps the meal", async () => {
    const analyzeText = vi.fn(async () => { throw new ApiError("rate_limited"); });
    setup({ analyzeText });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe your meal/), { target: { value: "a pear" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Analyze" })); });
    expect(await screen.findByText(/scanning fast/)).toBeTruthy();
    expect(screen.getByTestId("hero-kcal").textContent).toBe("550");
  });

  it("appends the items from an add-item analysis", async () => {
    const analyzeText = vi.fn(async () => ({ ...RESULT, items: [item("Pear", 150, 85)] }));
    setup({ analyzeText });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe your meal/), { target: { value: "a pear" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Analyze" })); });
    await waitFor(() => expect(screen.getByTestId("hero-kcal").textContent).toBe("635"));
  });
});
