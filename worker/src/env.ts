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
  /** Comma-separated SHA-256 hashes of upgrade codes that unlock the paid plan. */
  REDEEM_CODE_HASHES?: string;
  AI?: Ai;
  ALLOWED_ORIGINS?: string;
  RATE_KV: KVNamespace;
}
