import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import CameraScreen from "../src/features/onboarding/CameraScreen";
import Onboarding from "../src/features/onboarding/Onboarding";
import { cameraDismissed, cameraPermission, requestCameraAccess, shouldOfferCamera } from "../src/lib/camera";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

const stubMedia = (getUserMedia: (c: unknown) => Promise<MediaStream>) => Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
const stubPermission = (state: string | Error) =>
  Object.defineProperty(navigator, "permissions", {
    value: { query: async () => (state instanceof Error ? Promise.reject(state) : { state }) },
    configurable: true,
  });
const fakeStream = () => {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
};
const denied = () => Object.assign(new Error("no"), { name: "NotAllowedError" });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";

const reset = () => {
  localStorage.clear();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  delete (navigator as { permissions?: unknown }).permissions;
};

describe("camera helpers", () => {
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("reads the permission without prompting, and falls back to unknown", async () => {
    stubPermission("granted");
    expect(await cameraPermission()).toBe("granted");
    stubPermission("prompt");
    expect(await cameraPermission()).toBe("prompt");
    stubPermission(new Error("unsupported"));
    expect(await cameraPermission()).toBe("unknown");
  });

  it("asks once and releases the camera straight away", async () => {
    const { stream, stop } = fakeStream();
    stubMedia(async () => stream);
    expect(await requestCameraAccess()).toBe("granted");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("reports denied and unavailable", async () => {
    stubMedia(async () => Promise.reject(denied()));
    expect(await requestCameraAccess()).toBe("denied");
    stubMedia(async () => Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" })));
    expect(await requestCameraAccess()).toBe("unavailable");
    reset();
    expect(await requestCameraAccess()).toBe("unavailable");
  });

  it("is offered only where video capture exists and Not now was not chosen", () => {
    expect(shouldOfferCamera()).toBe(false);
    stubMedia(async () => fakeStream().stream);
    expect(shouldOfferCamera()).toBe(true);
    localStorage.setItem("bites.camera.dismissed", "1");
    expect(cameraDismissed()).toBe(true);
    expect(shouldOfferCamera()).toBe(false);
  });
});

describe("CameraScreen", () => {
  beforeEach(async () => {
    reset();
    await i18n.changeLanguage("en");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("asks for the camera and continues when allowed, with the Safari tip on iPhone", async () => {
    stubPermission("prompt");
    const { stream, stop } = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    stubMedia(getUserMedia);
    const done = vi.fn();
    render(<CameraScreen platform="ios" onDone={done} />);
    expect(await screen.findByText("Allow camera access")).toBeTruthy();
    expect(screen.getByText(/set Camera to Allow/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow camera" }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  it("skips straight through when the camera is already allowed", async () => {
    stubPermission("granted");
    stubMedia(async () => fakeStream().stream);
    const done = vi.fn();
    render(<CameraScreen platform="android" onDone={done} />);
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Allow camera access")).toBeNull();
  });

  it("explains how to unblock it when the camera is denied", async () => {
    stubPermission("prompt");
    stubMedia(async () => Promise.reject(denied()));
    const done = vi.fn();
    render(<CameraScreen platform="ios" onDone={done} />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow camera" }));
    expect(await screen.findByText("Camera is blocked")).toBeTruthy();
    expect(screen.getByText(/Reload the page afterwards/)).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("shows the blocked help right away when the permission is already denied", async () => {
    stubPermission("denied");
    stubMedia(async () => fakeStream().stream);
    render(<CameraScreen platform="android" onDone={() => {}} />);
    expect(await screen.findByText("Camera is blocked")).toBeTruthy();
    expect(screen.getByText(/Tap the lock icon/)).toBeTruthy();
  });

  it("remembers Not now", async () => {
    stubPermission("prompt");
    stubMedia(async () => fakeStream().stream);
    const done = vi.fn();
    render(<CameraScreen platform="android" onDone={done} />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(done).toHaveBeenCalledTimes(1);
    expect(cameraDismissed()).toBe(true);
  });
});

describe("Onboarding with the camera step", () => {
  let n = 0;
  beforeEach(async () => {
    reset();
    await i18n.changeLanguage("en");
    useStore.setState({ repo: new LocalRepo(`bites-camera-${++n}`), profile: null, dataVersion: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("goes install, then camera, then slides on an iPhone in the browser", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);
    stubPermission("prompt");
    stubMedia(async () => fakeStream().stream);
    render(<Onboarding onDone={() => {}} />);
    expect(screen.getByText("Add Bites to your home screen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I've added it" }));
    expect(await screen.findByText("Allow camera access")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByText("Point. Snap. Know.")).toBeTruthy();
  });

  it("goes straight to the camera step when the app is already installed", async () => {
    stubPermission("prompt");
    stubMedia(async () => fakeStream().stream);
    render(<Onboarding onDone={() => {}} />);
    expect(await screen.findByText("Allow camera access")).toBeTruthy();
  });

  it("skips the camera step when there is no camera support or the camera was already allowed", async () => {
    render(<Onboarding onDone={() => {}} />);
    expect(screen.getByText("Point. Snap. Know.")).toBeTruthy();
    cleanup();
    stubPermission("granted");
    stubMedia(async () => fakeStream().stream);
    render(<Onboarding onDone={() => {}} />);
    expect(await screen.findByText("Point. Snap. Know.")).toBeTruthy();
  });

  it("never shows it when redoing the questions from Settings", () => {
    stubPermission("prompt");
    stubMedia(async () => fakeStream().stream);
    const initial = { sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain", kcalTarget: 2760, macroTargets: { protein: 128, carbs: 300, fat: 85 }, locale: "en", units: "kcal", createdAt: 1 } as const;
    render(<Onboarding initial={initial} onDone={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Allow camera access")).toBeNull();
    expect(screen.getByText("What's your goal?")).toBeTruthy();
  });
});
