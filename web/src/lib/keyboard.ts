import type { FocusEvent } from "react";

/** iOS only selects the text if it happens after the focus has settled. */
export function selectAllOnFocus(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>): void {
  const el = e.currentTarget;
  requestAnimationFrame(() => {
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      // type="number" inputs don't support selection ranges.
      el.select();
    }
  });
}

/**
 * Stable ref callback that focuses an input as it mounts without scrolling the page.
 * It runs inside the tap that opened the field, which is the only moment iOS shows the keyboard,
 * and preventScroll stops Safari from jumping the page while a sheet is still sliding in.
 */
export function focusWithoutScroll(el: HTMLInputElement | HTMLTextAreaElement | null): void {
  el?.focus({ preventScroll: true });
}

/** Keeps digits and one decimal point. Phones in Portuguese type a comma, which counts as the point. */
export function sanitizeDecimal(raw: string, maxLength = 6): string {
  const cleaned = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  const single = dot === -1 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
  return single.slice(0, maxLength);
}

const INTERACTIVE = "input, textarea, select, label, button, a, summary, [role='button'], [role='switch'], [contenteditable='true']";

/**
 * The iOS number pads have no Return key, so there is no way to close the keyboard.
 * Tapping empty space now closes it. Taps on controls are left alone so the layout does not
 * shift under a button between the press and the release.
 */
export function installKeyboardDismiss(): () => void {
  const onPointerDown = (e: PointerEvent) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    active.blur();
  };
  document.addEventListener("pointerdown", onPointerDown);
  return () => document.removeEventListener("pointerdown", onPointerDown);
}
