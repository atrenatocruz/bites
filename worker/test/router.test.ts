import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

const env = { ANTHROPIC_API_KEY: "x", ALLOWED_ORIGINS: "https://bites.example.com, https://b2.example.com" } as unknown as Env;
const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://api.test${path}`, init), env);
const withOrigin = (origin: string) => call("/api/health", { headers: { origin } });

describe("router", () => {
  it("answers preflight with 204", async () => {
    const res = await call("/api/analyze", { method: "OPTIONS", headers: { origin: "https://bites.example.com" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://bites.example.com");
  });

  it("serves health", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 for unknown paths", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("reflects allowed and local origins", async () => {
    for (const origin of ["https://b2.example.com", "http://localhost", "http://localhost:5173", "http://127.0.0.1:8787"]) {
      expect((await withOrigin(origin)).headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("does not reflect lookalike or unknown origins", async () => {
    for (const origin of ["http://localhost.evil.com", "http://localhost:5173.evil.com", "https://localhost", "https://evil.com", "http://127.0.0.1.evil.com"]) {
      expect((await withOrigin(origin)).headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("adds no CORS headers without an origin", async () => {
    expect((await call("/api/health")).headers.get("access-control-allow-origin")).toBeNull();
  });
});
