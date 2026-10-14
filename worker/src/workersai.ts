import type { AnalyzeRequest } from "@bites/shared";
import { SYSTEM_PROMPT, buildUserText } from "./prompt";
import { MEAL_SCHEMA } from "./schema";
import type { Env } from "./env";

export type AiOutcome = { kind: "ok"; json: unknown } | { kind: "refusal" } | { kind: "truncated" };

export const FREE_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
/** Workers AI has no abort option, so give up on our side instead of leaving the app waiting. */
export const FREE_TIMEOUT_MS = 40_000;
const FREE_MAX_TOKENS = 1400;
const COMPACT = "Reply with compact JSON. Keep every assumption and note under 8 words, and use null when there is nothing to add.";

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Workers AI timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The free plan: an open model on Cloudflare Workers AI, same prompt and output schema as the paid model. */
export async function callWorkersAi(req: AnalyzeRequest, env: Env): Promise<AiOutcome> {
  if (!env.AI) throw new Error("Workers AI binding is not configured");
  const content: unknown[] = [];
  if (req.image) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${req.image}` } });
  content.push({ type: "text", text: `${buildUserText(req)}
${COMPACT}` });

  const run = (env.AI as { run: (model: string, input: unknown) => Promise<unknown> }).run(env.FREE_AI_MODEL || FREE_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    max_tokens: FREE_MAX_TOKENS,
    temperature: 0.2,
    response_format: { type: "json_schema", json_schema: MEAL_SCHEMA },
  });
  const res = (await withTimeout(run, env.FREE_AI_TIMEOUT_MS ? Number(env.FREE_AI_TIMEOUT_MS) : FREE_TIMEOUT_MS)) as { response?: unknown } | null;

  const out = res?.response;
  if (out && typeof out === "object") return { kind: "ok", json: out };
  if (typeof out !== "string") return { kind: "truncated" };
  try {
    return { kind: "ok", json: JSON.parse(out) };
  } catch {
    return { kind: "truncated" };
  }
}
