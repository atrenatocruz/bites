import { describe, it, expect } from "vitest";
import { checkAndCount } from "../src/ratelimit";

function kvStub() {
  const store = new Map<string, string>();
  return { store, get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } };
}

describe("checkAndCount", () => {
  it("allows limit calls then refuses", async () => {
    const kv = kvStub() as never;
    expect(await checkAndCount(kv, "u1", "2026-10-14", 2)).toBe(true);
    expect(await checkAndCount(kv, "u1", "2026-10-14", 2)).toBe(true);
    expect(await checkAndCount(kv, "u1", "2026-10-14", 2)).toBe(false);
  });
  it("keeps days and users independent", async () => {
    const kv = kvStub() as never;
    expect(await checkAndCount(kv, "u1", "2026-10-14", 1)).toBe(true);
    expect(await checkAndCount(kv, "u1", "2026-10-15", 1)).toBe(true);
    expect(await checkAndCount(kv, "u2", "2026-10-14", 1)).toBe(true);
    expect(await checkAndCount(kv, "u1", "2026-10-14", 1)).toBe(false);
  });
});
