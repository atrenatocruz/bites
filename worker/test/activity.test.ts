import { describe, it, expect } from "vitest";
import { handleCreateKey, handleDeleteKey } from "../src/activity";
import { sha256Hex } from "../src/redeem";
import type { Env } from "../src/env";
import { memKv } from "./memkv";

const NOW = new Date("2026-10-14T20:00:00Z");
const setup = (uid: string | null = "u1") => {
  const { store, kv } = memKv();
  const env = { ANTHROPIC_API_KEY: "k", RATE_KV: kv } as Env;
  const deps = { verifyRequest: async () => uid, now: () => NOW };
  return { store, env, deps };
};
const req = (path: string, init: RequestInit = {}) => new Request(`https://api.test${path}`, init);

describe("activity keys", () => {
  it("creates a key and stores only its hash", async () => {
    const { store, env, deps } = setup();
    const res = await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps);
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = await sha256Hex(key);
    expect(store.get(`actkey:${hash}`)).toBe("u1");
    expect(store.get("actkeyof:u1")).toBe(hash);
    expect([...store.values()]).not.toContain(key);
  });

  it("replaces the previous key so the old one stops working", async () => {
    const { store, env, deps } = setup();
    const first = ((await (await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps)).json()) as { key: string }).key;
    const second = ((await (await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps)).json()) as { key: string }).key;
    expect(second).not.toBe(first);
    expect(store.has(`actkey:${await sha256Hex(first)}`)).toBe(false);
    expect(store.get(`actkey:${await sha256Hex(second)}`)).toBe("u1");
  });

  it("deletes the key", async () => {
    const { store, env, deps } = setup();
    await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps);
    const res = await handleDeleteKey(req("/api/activity/key", { method: "DELETE" }), env, deps);
    expect(res.status).toBe(200);
    expect([...store.keys()].filter((k) => k.startsWith("actkey"))).toEqual([]);
  });

  it("requires a signed-in user", async () => {
    const { env, deps } = setup(null);
    expect((await handleCreateKey(req("/api/activity/key", { method: "POST" }), env, deps)).status).toBe(401);
    expect((await handleDeleteKey(req("/api/activity/key", { method: "DELETE" }), env, deps)).status).toBe(401);
  });
});
