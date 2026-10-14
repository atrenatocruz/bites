import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "../src/i18n";
import ScanScreen from "../src/features/scan/ScanScreen";
import * as api from "../src/lib/api";
import { Toaster } from "../src/components/Toast";
import { useStore } from "../src/store";

function mockCamera(impl: (() => Promise<MediaStream>) | undefined) {
  Object.defineProperty(navigator, "mediaDevices", { value: impl ? { getUserMedia: impl } : undefined, configurable: true });
}

describe("ScanScreen camera states", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the calm fallback when the camera is denied", async () => {
    mockCamera(async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); });
    render(<ScanScreen />);
    expect(await screen.findByRole("button", { name: "Choose photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Type it" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
  });

  it("shows the fallback when there is no camera API", async () => {
    mockCamera(undefined);
    render(<ScanScreen />);
    expect(await screen.findByRole("button", { name: "Choose photo" })).toBeTruthy();
  });

  it("stops the camera tracks on unmount", async () => {
    const stop = vi.fn();
    mockCamera(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { unmount } = render(<ScanScreen />);
    await screen.findByRole("button", { name: "Take photo" });
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("shows a friendly error with retry when text analysis is rejected", async () => {
    mockCamera(undefined);
    useStore.setState({ repo: { getIdToken: async () => null } as never });
    vi.spyOn(api, "analyze").mockRejectedValue(new api.ApiError("upstream"));
    render(<ScanScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Type it" }));
    fireEvent.change(screen.getByPlaceholderText(/Describe your meal/), { target: { value: "soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() => expect(screen.getByText(/having a moment/)).toBeTruthy());
  });

  it("stops the camera tracks when the document becomes hidden", async () => {
    const stop = vi.fn();
    mockCamera(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    render(<ScanScreen />);
    await screen.findByRole("button", { name: "Take photo" });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stop).toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("does not call the API from the shutter while offline", async () => {
    mockCamera(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const analyze = vi.spyOn(api, "analyze");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<><ScanScreen /><Toaster /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Take photo" }));
    expect(await screen.findByText(/scanning needs internet/)).toBeTruthy();
    expect(analyze).not.toHaveBeenCalled();
  });
});
