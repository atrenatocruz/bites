import type { AnalyzeRequest } from "@bites/shared";
import { SYSTEM_PROMPT, buildUserText } from "./prompt";
import { MEAL_SCHEMA } from "./schema";
import type { Env } from "./env";

export type AiOutcome = { kind: "ok"; json: unknown } | { kind: "refusal" } | { kind: "truncated" };

export const FREE_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

// A normal answer takes 8-16 seconds, but about one request in eight stalls and never finishes.
// Workers AI has no abort option, so each attempt gets a deadline on our side and a stalled one is retried.
export const FREE_TEXT_ATTEMPT_MS = 22_000;
export const FREE_IMAGE_ATTEMPT_MS = 35_000;
export const FREE_ATTEMPTS = 2;
const FREE_MAX_TOKENS = 1400;
const COMPACT = "Reply with compact JSON. Keep every assumption and note under 8 words, and use null when there is nothing to add.";

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Workers AI timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export type FreeFormat = "schema" | "json_object" | "prompt";

const FORMAT_HINT = `Return only one JSON object, with no other text, matching this JSON schema: ${JSON.stringify(MEAL_SCHEMA)}`;

/** The first balanced JSON object in a reply, for models that wrap it in text or code fences. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object");
}

/** The free plan: an open model on Cloudflare Workers AI, same prompt and output schema as the paid model. */
export async function callWorkersAi(req: AnalyzeRequest, env: Env): Promise<AiOutcome> {
  if (!env.AI) throw new Error("Workers AI binding is not configured");
  const ai = env.AI as { run: (model: string, input: unknown) => Promise<unknown> };
  const content: unknown[] = [];
  if (req.image) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${req.image}` } });
  // Constrained "schema" decoding stalled about one request in four; plain JSON mode with the schema in the prompt is faster and steadier.
  const format: FreeFormat = env.FREE_AI_FORMAT === "schema" || env.FREE_AI_FORMAT === "prompt" ? env.FREE_AI_FORMAT : "json_object";
  content.push({ type: "text", text: `${buildUserText(req)}\n${COMPACT}${format === "schema" ? "" : `\n${FORMAT_HINT}`}` });

  const input = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    max_tokens: FREE_MAX_TOKENS,
    temperature: 0.2,
    ...(format === "schema" ? { response_format: { type: "json_schema", json_schema: MEAL_SCHEMA } } : format === "json_object" ? { response_format: { type: "json_object" } } : {}),
  };
  const attemptMs = env.FREE_AI_TIMEOUT_MS ? Number(env.FREE_AI_TIMEOUT_MS) : req.image ? FREE_IMAGE_ATTEMPT_MS : FREE_TEXT_ATTEMPT_MS;
  const attempts = env.FREE_AI_ATTEMPTS ? Math.max(1, Number(env.FREE_AI_ATTEMPTS)) : FREE_ATTEMPTS;

  let res: { response?: unknown } | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      res = (await withTimeout(ai.run(env.FREE_AI_MODEL || FREE_MODEL, input), attemptMs)) as { response?: unknown } | null;
      break;
    } catch (e) {
      lastError = e;
      console.error(`Workers AI attempt ${attempt}/${attempts} failed`, e);
    }
  }
  if (!res) throw lastError;

  const out = res.response;
  if (out && typeof out === "object") return { kind: "ok", json: out };
  if (typeof out !== "string") return { kind: "truncated" };
  try {
    return { kind: "ok", json: extractJson(out) };
  } catch {
    return { kind: "truncated" };
  }
}
