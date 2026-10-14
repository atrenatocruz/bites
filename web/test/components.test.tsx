import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "../src/i18n";
import type { Meal } from "@bites/shared";
import Ring from "../src/components/Ring";
import MacroBars from "../src/components/MacroBars";
import TabBar from "../src/components/TabBar";
import MealRow from "../src/components/MealRow";
import Sheet from "../src/components/Sheet";
import { Toaster, toast } from "../src/components/Toast";
import { useStore } from "../src/store";

const arcOf = (c: HTMLElement) => c.querySelector("circle[data-arc]") as SVGCircleElement;

describe("Ring", () => {
  it("renders the arc for value/max", () => {
    const { container } = render(<Ring value={50} max={100} size={100} stroke={10} color="red" animate={false} />);
    const arc = arcOf(container);
    const circ = 2 * Math.PI * 45;
    const [dash = 0, gap = 0] = arc.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(circ * 0.5, 1);
    expect(dash + gap).toBeCloseTo(circ, 1);
  });
  it("caps at 100%", () => {
    const { container } = render(<Ring value={500} max={100} size={100} stroke={10} color="red" animate={false} />);
    const [dash = 0, gap = 0] = arcOf(container).getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(dash + gap, 1);
  });
});

describe("Ring label", () => {
  it("is exposed as a labelled image", () => {
    render(<Ring value={1} max={2} size={100} stroke={10} color="red" animate={false} label="1 of 2 kcal" />);
    expect(screen.getByRole("img", { name: "1 of 2 kcal" })).toBeTruthy();
  });
});

describe("Sheet", () => {
  it("renders content and closes from the handle", () => {
    let closed = false;
    render(<Sheet open onClose={() => { closed = true; }}><p>Hello</p></Sheet>);
    expect(screen.getByText("Hello")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toBe(true);
  });
});

describe("Toaster", () => {
  it("keeps a persistent status region", () => {
    render(<Toaster />);
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => toast("Saved"));
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });
});

describe("MacroBars", () => {
  it("shows grams against target", () => {
    render(<MacroBars totals={{ kcal: 900, protein: 45, carbs: 100, fat: 20 }} targets={{ protein: 120, carbs: 250, fat: 70 }} />);
    expect(screen.getByText("45 / 120 g")).toBeTruthy();
  });
});

describe("TabBar", () => {
  beforeEach(() => useStore.setState({ tab: "scan" }));
  it("sets the store tab on click", () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole("button", { name: /diary/i }));
    expect(useStore.getState().tab).toBe("diary");
  });
});

describe("MealRow", () => {
  it("shows title, kcal and HH:mm", () => {
    const at = new Date(2026, 0, 5, 7, 5).getTime();
    const meal: Meal = {
      id: "1", createdAt: at, dayKey: "2026-01-05", mealType: "breakfast", title: "Oats", thumb: null, items: [],
      totals: { kcal: 320, protein: 10, carbs: 50, fat: 6 }, source: "text", edited: false,
    };
    render(<MealRow meal={meal} onClick={() => {}} />);
    expect(screen.getByText("Oats")).toBeTruthy();
    expect(screen.getByText(/320/)).toBeTruthy();
    expect(screen.getByText(/07:05/)).toBeTruthy();
  });
});
