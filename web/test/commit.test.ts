import { describe, it, expect, afterEach, vi } from "vitest";
import { commitLocal } from "../src/lib/repo/commit";

describe("commitLocal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves immediately when offline and warns about a later failure", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail!: (e: Error) => void;
    const pending = new Promise<void>((_, rej) => { fail = rej; });
    await expect(commitLocal(pending)).resolves.toBeUndefined();
    fail(new Error("late"));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });

  it("resolves on the server ack when online", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await expect(commitLocal(Promise.resolve())).resolves.toBeUndefined();
  });

  it("resolves after the timeout when the ack never arrives", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.useFakeTimers();
    let done = false;
    void commitLocal(new Promise<void>(() => {})).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(3900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });

  it("rejects on a prompt error while online", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await expect(commitLocal(Promise.reject(new Error("denied")))).rejects.toThrow("denied");
  });
});
