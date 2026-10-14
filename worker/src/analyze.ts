import { dayKey, type AnalyzeRequest } from "@bites/shared";
import { normalizeAiOutput, NormalizeError } from "./normalize";
import { checkAndCount } from "./ratelimit";
import { dailyLimit, getPlan } from "./plan";
import type { AiOutcome, callWorkersAi as CallWorkersAi } from "./workersai";
import { MOCK_RESULT } from "./mock";
import type { Env } from "./env";
import type { callClaude as CallClaude } from "./claude";
import type { verifyRequest as VerifyRequest } from "./auth";

export interface Deps { callClaude: typeof CallClaude; callWorkersAi: typeof CallWorkersAi; verifyRequest: typeof VerifyRequest; now: () => Date }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleAnalyze(req: Request, env: Env, deps: Deps): Promise<Response> {
  let body: AnalyzeRequest;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);
  if (body.hint !== undefined && typeof body.hint !== "string") return json({ error: "bad_request" }, 400);
  if (body.text !== undefined && typeof body.text !== "string") return json({ error: "bad_request" }, 400);
  if (body.localTime !== undefined && typeof body.localTime !== "string") return json({ error: "bad_request" }, 400);
  const hasImage = typeof body.image === "string" && body.image.length > 0;
  const hasText = typeof body.text === "string" && body.text.trim().length > 0;
  if ((!hasImage && !hasText) || (hasImage && body.image!.length > 2_000_000) || !["pt-PT", "en"].includes(body.locale))
    return json({ error: "bad_request" }, 400);
  if (!/^\d{2}:\d{2}$/.test(body.localTime ?? "")) body.localTime = "12:00";

  const uid = await deps.verifyRequest(req, env);
  if (!uid) return json({ error: "unauthorized" }, 401);
  const plan = await getPlan(env.RATE_KV, uid);
  if (!(await checkAndCount(env.RATE_KV, uid, dayKey(deps.now()), dailyLimit(plan, env))))
    return json({ error: "rate_limited", plan }, 429);

  if (env.MOCK_AI === "1") return json(MOCK_RESULT);

  let out: AiOutcome;
  try { out = plan === "paid" ? await deps.callClaude(body, env) : await deps.callWorkersAi(body, env); } catch (e) { console.error(e); return json({ error: "upstream" }, 502); }
  if (out.kind === "refusal") return json({ error: "refusal" }, 422);
  if (out.kind === "truncated") return json({ error: "bad_output" }, 422);
  try {
    const result = normalizeAiOutput(out.json);
    return result.isFood ? json(result) : json({ error: "not_food", result }, 422);
  } catch (e) {
    if (e instanceof NormalizeError) return json({ error: "bad_output" }, 422);
    throw e;
  }
}
