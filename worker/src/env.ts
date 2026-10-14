export interface Env {
  ANTHROPIC_API_KEY: string;
  AI_MODEL?: string;
  MOCK_AI?: string;
  AUTH_MODE?: "firebase" | "off";
  FIREBASE_PROJECT_ID?: string;
  DAILY_LIMIT?: string;
  ALLOWED_ORIGINS?: string;
  RATE_KV: KVNamespace;
}
