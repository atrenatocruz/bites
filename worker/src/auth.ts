import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export async function verifyRequest(req: Request, env: Env): Promise<string | null> {
  if (env.AUTH_MODE === "off") return req.headers.get("x-device-id")?.slice(0, 64) || "anon";
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !env.FIREBASE_PROJECT_ID) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID, algorithms: ["RS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}
