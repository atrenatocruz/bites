import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import TabBar from "../src/components/TabBar";
import { useStore } from "../src/store";

const stubHit = (el: Element | null) => Object.defineProperty(document, "elementFromPoint", { value: () => el, configurable: true });

describe("TabBar (iOS 26 style)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ tab: "scan" });
  });
  afterEach(() => {
    cleanup();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it("has a glass capsule with History and Diary and a separate tinted Scan button", () => {
    const { container } = render(<TabBar />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    const capsule = container.querySelector(".glass")!;
    expect(capsule.textContent).toContain("History");
    expect(capsule.textContent).toContain("Diary");
    const scan = screen.getByRole("button", { name: "Scan" });
    expect(scan.classList.contains("glass-tinted")).toBe(true);
    expect(capsule.contains(scan)).toBe(false);
  });

  it("shows no selection pill while on Scan, and one on the active tab otherwise", () => {
    const { container, rerender } = render(<TabBar />);
    expect(screen.getByRole("button", { name: "Scan" }).getAttribute("aria-current")).toBe("page");
    expect(container.querySelectorAll(".glass-selection").length).toBe(0);
    useStore.setState({ tab: "diary" });
    rerender(<TabBar />);
    expect(screen.getByRole("button", { name: /diary/i }).getAttribute("aria-current")).toBe("page");
    expect(container.querySelectorAll(".glass-selection").length).toBe(1);
  });

  it("switches on the press itself, not on release", () => {
    render(<TabBar />);
    const history = screen.getByRole("button", { name: /history/i });
    stubHit(history);
    fireEvent.pointerDown(history);
    expect(useStore.getState().tab).toBe("history");
  });

  it("follows a finger scrubbing across the capsule", () => {
    render(<TabBar />);
    const history = screen.getByRole("button", { name: /history/i });
    const diary = screen.getByRole("button", { name: /diary/i });
    stubHit(history);
    fireEvent.pointerDown(history);
    stubHit(diary);
    fireEvent.pointerMove(diary);
    expect(useStore.getState().tab).toBe("diary");
    fireEvent.pointerUp(diary);
    stubHit(history);
    fireEvent.pointerMove(history);
    expect(useStore.getState().tab).toBe("diary");
  });

  it("opens Scan from the round button and works from the keyboard", () => {
    useStore.setState({ tab: "history" });
    render(<TabBar />);
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(useStore.getState().tab).toBe("scan");
    fireEvent.click(screen.getByRole("button", { name: /diary/i }));
    expect(useStore.getState().tab).toBe("diary");
  });

  it("does not buzz or switch again when the current tab is pressed", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    useStore.setState({ tab: "history" });
    render(<TabBar />);
    const history = screen.getByRole("button", { name: /history/i });
    stubHit(history);
    fireEvent.pointerDown(history);
    expect(vibrate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("opens on the Diary by default", async () => {
    vi.resetModules();
    const fresh = await import("../src/store");
    expect(fresh.useStore.getState().tab).toBe("diary");
  });
});
