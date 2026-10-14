import Anthropic from "@anthropic-ai/sdk";
import type { AnalyzeRequest } from "@bites/shared";
import { SYSTEM_PROMPT, buildUserText } from "./prompt";
import { MEAL_SCHEMA } from "./schema";
import type { Env } from "./env";

export async function callClaude(req: AnalyzeRequest, env: Env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: req.image } });
  content.push({ type: "text", text: buildUserText(req) });

  const res = await client.beta.messages.create({
    model: env.AI_MODEL || "claude-sonnet-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: MEAL_SCHEMA } },
  });

  console.log("usage", {
    input_tokens: res.usage.input_tokens,
    cache_read_input_tokens: res.usage.cache_read_input_tokens,
    output_tokens: res.usage.output_tokens,
  });

  if (res.stop_reason === "refusal") return { kind: "refusal" } as const;
  if (res.stop_reason === "max_tokens") return { kind: "truncated" } as const;
  const block = res.content.find((b) => b.type === "text");
  try { return { kind: "ok", json: JSON.parse(block && block.type === "text" ? block.text : "") } as const; }
  catch { return { kind: "truncated" } as const; }
}
