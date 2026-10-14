import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import Analyzing, { AnalyzingDots, FreeModeHint } from "../src/components/Analyzing";
import { useStore } from "../src/store";

describe("Analyzing", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ plan: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the label and the first hint", () => {
    render(<Analyzing />);
    expect(screen.getByText("Analyzing…")).toBeTruthy();
    expect(screen.getByText("Spotting the ingredients")).toBeTruthy();
  });

  it("rotates through the hints", async () => {
    render(<Analyzing />);
    expect(await screen.findByText("Estimating the portions", {}, { timeout: 6000 })).toBeTruthy();
  }, 10000);

  it("warns that the free plan is slower, and says nothing on the paid or unknown plan", () => {
    useStore.setState({ plan: { plan: "free", dailyLimit: 5, unlocked: false } });
    const { unmount } = render(<Analyzing />);
    expect(screen.getByText("On the free plan this can take 10–20 seconds")).toBeTruthy();
    unmount();

    useStore.setState({ plan: { plan: "paid", dailyLimit: 30, unlocked: true } });
    render(<FreeModeHint />);
    expect(screen.queryByText(/10–20/)).toBeNull();
    cleanup();

    useStore.setState({ plan: null });
    render(<Analyzing />);
    expect(screen.queryByText(/10–20/)).toBeNull();
  });

  it("speaks Portuguese", async () => {
    await i18n.changeLanguage("pt-PT");
    useStore.setState({ plan: { plan: "free", dailyLimit: 5, unlocked: false } });
    render(<Analyzing />);
    expect(screen.getByText("A analisar…")).toBeTruthy();
    expect(screen.getByText("No plano gratuito pode demorar 10–20 segundos")).toBeTruthy();
  });

  it("renders four decorative dots", () => {
    const { container } = render(<AnalyzingDots />);
    expect(container.querySelectorAll("span > span").length).toBe(4);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
