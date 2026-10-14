import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import TabBar from "../src/components/TabBar";
import { useStore } from "../src/store";

const stubHit = (el: Element | null) => Object.defineProperty(document, "elementFromPoint", { value: () => el, configurable: true });

describe("TabBar (glass island)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ tab: "scan" });
  });
  afterEach(() => {
    cleanup();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it("is a floating island with the three tabs and a labelled nav", () => {
    const { container } = render(<TabBar />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(container.querySelector(".glass-island")).toBeTruthy();
    expect(screen.getByRole("button", { name: /history/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /diary/i })).toBeTruthy();
  });

  it("marks the current tab and puts the glass lens on it only", () => {
    const { container } = render(<TabBar />);
    expect(screen.getByRole("button", { name: "Scan" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /history/i }).getAttribute("aria-current")).toBeNull();
    expect(container.querySelectorAll(".glass-lens").length).toBe(1);
    expect(container.querySelector(".glass-lens--accent")).toBeTruthy();
  });

  it("switches on the press itself, not on release", () => {
    const history = (render(<TabBar />), screen.getByRole("button", { name: /history/i }));
    stubHit(history);
    fireEvent.pointerDown(history, { clientX: 10, clientY: 10 });
    expect(useStore.getState().tab).toBe("history");
  });

  it("follows a finger scrubbing across the island", () => {
    render(<TabBar />);
    const history = screen.getByRole("button", { name: /history/i });
    const diary = screen.getByRole("button", { name: /diary/i });
    stubHit(history);
    fireEvent.pointerDown(history);
    expect(useStore.getState().tab).toBe("history");
    stubHit(diary);
    fireEvent.pointerMove(diary);
    expect(useStore.getState().tab).toBe("diary");
    fireEvent.pointerUp(diary);
    stubHit(history);
    fireEvent.pointerMove(history);
    expect(useStore.getState().tab).toBe("diary");
  });

  it("still works from the keyboard and screen readers", () => {
    render(<TabBar />);
    fireEvent.click(screen.getByRole("button", { name: /diary/i }));
    expect(useStore.getState().tab).toBe("diary");
  });

  it("does not buzz or switch again when the current tab is pressed", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    render(<TabBar />);
    const scan = screen.getByRole("button", { name: "Scan" });
    stubHit(scan);
    fireEvent.pointerDown(scan);
    expect(vibrate).not.toHaveBeenCalled();
    stubHit(screen.getByRole("button", { name: /history/i }));
    fireEvent.pointerDown(screen.getByRole("button", { name: /history/i }));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
