import type { AnalyzeError, AnalyzeRequest, AnalyzeResult } from "@bites/shared";

export class ApiError extends Error {
  constructor(public code: AnalyzeError | "offline", public result?: AnalyzeResult) {
    super(code);
    this.name = "ApiError";
  }
}

const BASE = import.meta.env.VITE_API_URL ?? "";
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
  try {
    res = await fetch(`${BASE}/api/analyze`, { method: "POST", headers, body: JSON.stringify(req) });
  } catch {
    throw new ApiError("offline");
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
