import { handleAnalyze } from "./analyze";
import { callClaude } from "./claude";
import { callWorkersAi } from "./workersai";
import { handlePlan, handleRedeem, handleSetPlan } from "./redeem";
import { verifyRequest } from "./auth";
import type { Env } from "./env";

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin) && !LOCAL_ORIGIN.test(origin)) return {};
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
    return handleAnalyze(req, env, { callClaude, callWorkersAi, verifyRequest, now: () => new Date() });
  const planDeps = { verifyRequest, now: () => new Date() };
  if (req.method === "GET" && pathname === "/api/plan") return handlePlan(req, env, planDeps);
  if (req.method === "POST" && pathname === "/api/plan") return handleSetPlan(req, env, planDeps);
  if (req.method === "POST" && pathname === "/api/redeem") return handleRedeem(req, env, planDeps);
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
