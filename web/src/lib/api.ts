import type { AnalyzeError, AnalyzeRequest, AnalyzeResult } from "@bites/shared";

export class ApiError extends Error {
  constructor(public code: AnalyzeError | "offline", public result?: AnalyzeResult) {
    super(code);
    this.name = "ApiError";
  }
}

const BASE = import.meta.env.VITE_API_URL ?? "";
/** A scan that takes longer than this is treated as failed, so the app never waits forever. */
export const ANALYZE_TIMEOUT_MS = 75_000;
const DEVICE_KEY = "bites.device";

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

const KNOWN: AnalyzeError[] = ["not_food", "refusal", "bad_output", "rate_limited", "unauthorized", "bad_request", "upstream"];

export async function analyze(req: AnalyzeRequest, token: string | null): Promise<AnalyzeResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ApiError("offline");
  const headers: Record<string, string> = { "content-type": "application/json", "x-device-id": deviceId() };
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
  try {
    res = await fetch(`${BASE}/api/analyze`, { method: "POST", headers, body: JSON.stringify(req), signal: controller.signal });
  } catch (e) {
    throw new ApiError((e as { name?: string })?.name === "AbortError" ? "upstream" : "offline");
  } finally {
    clearTimeout(timer);
  }

  let body: { error?: string; result?: AnalyzeResult } | AnalyzeResult | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok) {
    if (!body) throw new ApiError("bad_output");
    return body as AnalyzeResult;
  }
  const err = body as { error?: string; result?: AnalyzeResult } | null;
  const code = KNOWN.includes(err?.error as AnalyzeError) ? (err!.error as AnalyzeError) : res.status === 422 ? "bad_output" : "upstream";
  throw new ApiError(code, err?.result);
}

export function errorKey(e: unknown): string {
  return e instanceof ApiError ? `errors.${e.code}` : "errors.generic";
}

export interface PlanInfo { plan: "free" | "paid"; dailyLimit: number; unlocked: boolean }

async function authedJson<T>(path: string, init: RequestInit, token: string | null): Promise<{ ok: boolean; status: number; body: (T & { error?: string }) | null }> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-device-id": deviceId() };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  let body: (T & { error?: string }) | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/** The signed-in user's plan, or null when the server can't be reached. */
export async function getPlan(token: string | null): Promise<PlanInfo | null> {
  try {
    const r = await authedJson<PlanInfo>("/api/plan", { method: "GET" }, token);
    return r.ok && r.body && (r.body.plan === "free" || r.body.plan === "paid") ? r.body : null;
  } catch {
    return null;
  }
}

/** Switch plan. Going paid works only once Premium is unlocked. */
export async function setPlan(plan: "free" | "paid", token: string | null): Promise<PlanInfo | null> {
  try {
    const r = await authedJson<PlanInfo>("/api/plan", { method: "POST", body: JSON.stringify({ plan }) }, token);
    return r.ok && r.body && (r.body.plan === "free" || r.body.plan === "paid") ? r.body : null;
  } catch {
    return null;
  }
}

export type RedeemResult = { ok: true; plan: PlanInfo } | { ok: false; reason: "invalid" | "limited" | "failed" };

export async function redeemCode(code: string, token: string | null): Promise<RedeemResult> {
  try {
    const r = await authedJson<PlanInfo>("/api/redeem", { method: "POST", body: JSON.stringify({ code }) }, token);
    if (r.ok && r.body) return { ok: true, plan: r.body };
    if (r.status === 429) return { ok: false, reason: "limited" };
    return { ok: false, reason: r.body?.error === "invalid_code" ? "invalid" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
