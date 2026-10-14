import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import Sheet from "../src/components/Sheet";
import Onboarding from "../src/features/onboarding/Onboarding";
import TextEntry from "../src/features/scan/TextEntry";
import { installKeyboardDismiss, sanitizeDecimal } from "../src/lib/keyboard";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

describe("sanitizeDecimal", () => {
  it("turns the comma of a Portuguese keyboard into the decimal point", () => expect(sanitizeDecimal("72,5")).toBe("72.5"));
  it("keeps only digits and a single point", () => {
    expect(sanitizeDecimal("7a2.5.1")).toBe("72.51");
    expect(sanitizeDecimal("1,2,3")).toBe("1.23");
    expect(sanitizeDecimal("-5e")).toBe("5");
  });
  it("limits the length", () => expect(sanitizeDecimal("1234567890", 4)).toBe("1234"));
});

describe("keyboard dismiss", () => {
  let remove: () => void;
  beforeEach(() => {
    remove = installKeyboardDismiss();
  });
  afterEach(() => {
    remove();
    cleanup();
  });

  it("closes the keyboard when tapping empty space but not when tapping a control", () => {
    render(
      <div data-testid="empty">
        <input aria-label="field" />
        <button type="button">Go</button>
        <p>text</p>
      </div>,
    );
    const field = screen.getByLabelText("field") as HTMLInputElement;
    field.focus();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Go" }));
    expect(document.activeElement).toBe(field);
    fireEvent.pointerDown(field);
    expect(document.activeElement).toBe(field);
    fireEvent.pointerDown(screen.getByText("text"));
    expect(document.activeElement).not.toBe(field);
  });
});

describe("onboarding number fields", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ repo: new LocalRepo(`bites-kb-${Math.random()}`), profile: null, dataVersion: 0 });
  });
  afterEach(cleanup);

  const toBody = () => {
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Maintain weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Male" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  };

  it("uses the decimal keypad for height and weight and accepts a comma", () => {
    render(<Onboarding onDone={() => {}} />);
    toBody();
    const weight = screen.getByLabelText("Weight (kg)") as HTMLInputElement;
    expect(weight.getAttribute("inputmode")).toBe("decimal");
    fireEvent.change(weight, { target: { value: "72,5" } });
    expect(weight.value).toBe("72.5");
    expect(screen.getByText(/BMI/)).toBeTruthy();
  });

  it("focuses the field when tapping anywhere in its box", () => {
    render(<Onboarding onDone={() => {}} />);
    toBody();
    const height = screen.getByLabelText("Height (cm)") as HTMLInputElement;
    fireEvent.click(height.parentElement!);
    expect(document.activeElement).toBe(height);
  });
});

describe("Sheet and the iOS keyboard", () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
  afterEach(() => {
    cleanup();
    if (original) Object.defineProperty(window, "visualViewport", original);
    else delete (window as { visualViewport?: unknown }).visualViewport;
  });

  it("lifts the sheet by the height the keyboard covers", async () => {
    const listeners = new Map<string, () => void>();
    const vv = { height: 800, offsetTop: 0, addEventListener: (t: string, l: () => void) => listeners.set(t, l), removeEventListener: (t: string) => listeners.delete(t) };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    render(
      <Sheet open onClose={() => {}}>
        <p>content</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.bottom).toBe("0px");
    vv.height = 500;
    act(() => listeners.get("resize")!());
    await waitFor(() => expect(dialog.style.bottom).toBe("300px"));
    expect(dialog.style.maxHeight).toMatch(/^calc\(100% - /);
    vv.height = 800;
    act(() => listeners.get("resize")!());
    await waitFor(() => expect(dialog.style.bottom).toBe("0px"));
  });
});

describe("TextEntry focus", () => {
  afterEach(cleanup);
  it("focuses the description without scrolling the page", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<TextEntry open mode="new" onClose={() => {}} onSubmit={async () => {}} />);
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(area.maxLength).toBe(500);
    expect(focus.mock.calls.some(([opts]) => (opts as FocusOptions | undefined)?.preventScroll === true)).toBe(true);
    focus.mockRestore();
  });
});
