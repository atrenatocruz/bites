export type Plan = "free" | "paid";

/** The plan is stored in KV as `plan:<uid>`; anything other than "paid" is the free plan. */
export async function getPlan(kv: Pick<KVNamespace, "get">, uid: string): Promise<Plan> {
  return (await kv.get(`plan:${uid}`)) === "paid" ? "paid" : "free";
}

/** Premium is unlocked once a code was redeemed (`unlocked:<uid>`), or while the paid plan is active. */
export async function isUnlocked(kv: Pick<KVNamespace, "get">, uid: string, plan: Plan): Promise<boolean> {
  return plan === "paid" || (await kv.get(`unlocked:${uid}`)) === "1";
}

export const DEFAULT_PAID_LIMIT = 30;
export const DEFAULT_FREE_LIMIT = 5;

export function dailyLimit(plan: Plan, env: { DAILY_LIMIT?: string; FREE_DAILY_LIMIT?: string }): number {
  const raw = plan === "paid" ? env.DAILY_LIMIT : env.FREE_DAILY_LIMIT;
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : plan === "paid" ? DEFAULT_PAID_LIMIT : DEFAULT_FREE_LIMIT;
}
