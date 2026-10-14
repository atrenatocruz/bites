import { handleAnalyze } from "./analyze";
import { callClaude } from "./claude";
import { verifyRequest } from "./auth";
import type { Env } from "./env";

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin) && !origin.startsWith("http://localhost")) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization, x-device-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method === "GET" && pathname === "/api/health") return Response.json({ ok: true });
  if (req.method === "POST" && pathname === "/api/analyze")
    return handleAnalyze(req, env, { callClaude, verifyRequest, now: () => new Date() });
  return Response.json({ error: "not_found" }, { status: 404 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await route(req, env);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders(req, env))) out.headers.set(k, v);
    return out;
  },
};
