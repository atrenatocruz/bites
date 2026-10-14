export interface Env {
  ANTHROPIC_API_KEY: string;
  AI_MODEL?: string;
  MOCK_AI?: string;
  AUTH_MODE?: "firebase" | "off";
  FIREBASE_PROJECT_ID?: string;
  /** Daily scans on the paid plan (Claude). */
  DAILY_LIMIT?: string;
  /** Daily scans on the free plan (Workers AI). */
  FREE_DAILY_LIMIT?: string;
  FREE_AI_MODEL?: string;
  /** How long one attempt of the free model may take (default 22000 for text, 35000 for photos). */
  FREE_AI_TIMEOUT_MS?: string;
  /** How many times a stalled free-model request is tried (default 2). */
  FREE_AI_ATTEMPTS?: string;
  /** How the free model is asked for JSON: "schema" (default), "json_object" or "prompt". */
  FREE_AI_FORMAT?: string;
  /** Comma-separated SHA-256 hashes of upgrade codes that unlock the paid plan. */
  REDEEM_CODE_HASHES?: string;
  AI?: Ai;
  ALLOWED_ORIGINS?: string;
  RATE_KV: KVNamespace;
}
