import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import HealthSection from "../src/features/settings/HealthSection";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

let n = 0;
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ios = (extra: Record<string, unknown> = {}) => vi.stubGlobal("navigator", { ...navigator, userAgent: "iPhone", onLine: true, clipboard: undefined, ...extra });
const notConnected = (url: string) => (String(url).includes("/key") ? answer({ key: "KEY123" }) : answer({ days: {}, lastSync: null, hasKey: false }));

describe("HealthSection", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ repo: new LocalRepo(`bites-health-${++n}`) });
    vi.stubEnv("VITE_HEALTH_SHORTCUT_URL", "https://www.icloud.com/shortcuts/abc");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("says it is iPhone-only elsewhere", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "Android" });
    render(<HealthSection />);
    expect(screen.getByText("Apple Health is only available on iPhone for now.")).toBeTruthy();
  });

  it("connects: copies the key from the tap and shows the Shortcut link", async () => {
    let copied = "";
    const write = vi.fn(async (items: { getType: (t: string) => Promise<Blob> }[]) => {
      copied = await (await items[0]!.getType("text/plain")).text();
    });
    ios({ clipboard: { write } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(private data: Record<string, Promise<Blob>>) {}
        getType(t: string) {
          return this.data[t];
        }
      },
    );
    vi.stubGlobal("fetch", vi.fn(notConnected));
    render(<HealthSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Apple Health" }));
    expect(write).toHaveBeenCalledTimes(1); // started synchronously inside the tap
    expect(await screen.findByText("Key copied ✓ Paste it when the Shortcut asks.")).toBeTruthy();
    expect(copied).toBe("KEY123");
    expect(screen.getByRole("link", { name: "Add the Shortcut" }).getAttribute("href")).toBe("https://www.icloud.com/shortcuts/abc");
    expect(screen.getByRole("link", { name: "Sync now" }).getAttribute("href")).toBe("shortcuts://run-shortcut?name=Bites%20Health");
  });

  it("shows the key on screen when the clipboard is unavailable", async () => {
    ios();
    vi.stubGlobal("fetch", vi.fn(notConnected));
    render(<HealthSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Apple Health" }));
    expect(await screen.findByText("KEY123")).toBeTruthy();
    expect(screen.getByText("Copy this key, then paste it when the Shortcut asks:")).toBeTruthy();
  });

  it("lets the person copy the shown key with a fresh tap", async () => {
    const writeText = vi.fn(async () => {});
    ios({ clipboard: { writeText } });
    vi.stubGlobal("fetch", vi.fn(notConnected));
    render(<HealthSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Apple Health" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("KEY123");
    expect(await screen.findByText("Key copied ✓ Paste it when the Shortcut asks.")).toBeTruthy();
  });

  it("shows the connected state and disconnects", async () => {
    ios();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? answer({ ok: true }) : answer({ days: {}, lastSync: { syncedAt: Date.now(), tz: "UTC" }, hasKey: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<HealthSection />);
    expect(await screen.findByText(/Last synced/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up nightly sync" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show my key again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Apple Health" })).toBeTruthy());
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith("/api/activity/key") && (i as RequestInit).method === "DELETE")).toBe(true);
  });

  it("guides someone who has a key but has not synced yet", async () => {
    ios();
    vi.stubGlobal("fetch", vi.fn(async () => answer({ days: {}, lastSync: null, hasKey: true })));
    render(<HealthSection />);
    expect(await screen.findByText("Then tap Sync now and allow access to Health.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sync now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show my key again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up nightly sync" })).toBeNull();
  });

  it("hides Connect until the Shortcut link is configured", async () => {
    ios();
    vi.stubEnv("VITE_HEALTH_SHORTCUT_URL", "");
    vi.stubGlobal("fetch", vi.fn(async () => answer({ days: {}, lastSync: null, hasKey: false })));
    render(<HealthSection />);
    expect(await screen.findByText(/See your workouts/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Apple Health" })).toBeNull();
  });
});
