import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import InstallScreen from "../src/features/onboarding/InstallScreen";
import Onboarding from "../src/features/onboarding/Onboarding";
import { detectPlatform, installDismissed, isStandalone, shouldOfferInstall } from "../src/lib/install";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

const setUA = (ua: string) => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
const setStandalone = (on: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("standalone"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

let n = 0;

describe("install helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    setStandalone(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("detects the platform", () => {
    setUA(ANDROID);
    expect(detectPlatform()).toBe("android");
    vi.restoreAllMocks();
    setUA(IPHONE);
    expect(detectPlatform()).toBe("ios");
    vi.restoreAllMocks();
    setUA(DESKTOP);
    expect(detectPlatform()).toBe("other");
  });

  it("offers the screen on phones in the browser only", () => {
    setUA(ANDROID);
    expect(shouldOfferInstall()).toBe(true);
    setStandalone(true);
    expect(isStandalone()).toBe(true);
    expect(shouldOfferInstall()).toBe(false);
  });

  it("does not offer it on desktop", () => {
    setUA(DESKTOP);
    expect(shouldOfferInstall()).toBe(false);
  });

  it("treats iOS standalone (navigator.standalone) as installed", () => {
    setUA(IPHONE);
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    try {
      expect(isStandalone()).toBe(true);
      expect(shouldOfferInstall()).toBe(false);
    } finally {
      delete (navigator as { standalone?: boolean }).standalone;
    }
  });
});

describe("InstallScreen", () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("en");
  });
  afterEach(cleanup);

  it("shows the three Safari steps on iOS and continues with the button", () => {
    const done = vi.fn();
    render(<InstallScreen platform="ios" onDone={done} />);
    expect(screen.getByText("Add Bites to your home screen")).toBeTruthy();
    expect(screen.getByText("Tap the Share button in Safari")).toBeTruthy();
    expect(screen.getByText("Scroll down and tap Add to Home Screen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I've added it" }));
    expect(done).toHaveBeenCalledTimes(1);
    expect(installDismissed()).toBe(false);
  });

  it("shows manual steps on Android when the browser gave no install prompt", () => {
    render(<InstallScreen platform="android" onDone={() => {}} />);
    expect(screen.getByText("Choose Install app or Add to Home screen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add to home screen" })).toBeNull();
  });

  it("installs straight away on Android when the browser offers the prompt", async () => {
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    window.dispatchEvent(event);
    const done = vi.fn();
    render(<InstallScreen platform="android" onDone={done} />);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Add to home screen" }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("stays on the screen when the install dialog is dismissed", async () => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: "dismissed" as const }) });
    window.dispatchEvent(event);
    const done = vi.fn();
    render(<InstallScreen platform="android" onDone={done} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to home screen" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add to home screen" })).toBeNull());
    expect(done).not.toHaveBeenCalled();
  });

  it("remembers Not now so it does not nag on every launch", () => {
    const done = vi.fn();
    render(<InstallScreen platform="ios" onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(done).toHaveBeenCalledTimes(1);
    expect(installDismissed()).toBe(true);
  });
});

describe("Onboarding with the install screen", () => {
  beforeEach(async () => {
    localStorage.clear();
    setStandalone(false);
    await i18n.changeLanguage("en");
    useStore.setState({ repo: new LocalRepo(`bites-install-${++n}`), profile: null, dataVersion: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the install screen first on an iPhone, then the slides", () => {
    setUA(IPHONE);
    render(<Onboarding onDone={() => {}} />);
    expect(screen.getByText("Add Bites to your home screen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I've added it" }));
    expect(screen.getByText("Point. Snap. Know.")).toBeTruthy();
  });

  it("skips it when the app is already on the home screen", () => {
    setUA(IPHONE);
    setStandalone(true);
    render(<Onboarding onDone={() => {}} />);
    expect(screen.queryByText("Add Bites to your home screen")).toBeNull();
    expect(screen.getByText("Point. Snap. Know.")).toBeTruthy();
  });

  it("skips it on desktop and for people who chose Not now", () => {
    setUA(DESKTOP);
    render(<Onboarding onDone={() => {}} />);
    expect(screen.getByText("Point. Snap. Know.")).toBeTruthy();
    cleanup();
    vi.restoreAllMocks();
    setUA(ANDROID);
    localStorage.setItem("bites.install.dismissed", "1");
    render(<Onboarding onDone={() => {}} />);
    expect(screen.getByText("Point. Snap. Know.")).toBeTruthy();
  });

  it("never shows it when redoing the questions from Settings", () => {
    setUA(IPHONE);
    const initial = { sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain", kcalTarget: 2760, macroTargets: { protein: 128, carbs: 300, fat: 85 }, locale: "en", units: "kcal", createdAt: 1 } as const;
    render(<Onboarding initial={initial} onDone={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Add Bites to your home screen")).toBeNull();
    expect(screen.getByText("What's your goal?")).toBeTruthy();
  });
});
