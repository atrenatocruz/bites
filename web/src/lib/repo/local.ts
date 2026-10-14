import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type { DaySummary, Meal, Profile, Totals } from "@bites/shared";
import type { Repo } from "./types";
import { applyDayDelta } from "./dayAggregate";

interface BitesDB extends DBSchema {
  profile: { key: string; value: Profile };
  meals: { key: string; value: Meal; indexes: { dayKey: string; createdAt: number } };
  days: { key: string; value: DaySummary };
}

type WriteTx = IDBPTransaction<BitesDB, ["meals", "days"], "readwrite">;

const neg = (t: Totals): Totals => ({ kcal: -t.kcal, protein: -t.protein, carbs: -t.carbs, fat: -t.fat });

async function adjustDay(tx: WriteTx, dayKey: string, delta: Totals, countDelta: number) {
  const next = applyDayDelta(await tx.objectStore("days").get(dayKey), dayKey, delta, countDelta);
  if (next) await tx.objectStore("days").put(next);
  else await tx.objectStore("days").delete(dayKey);
}

export class LocalRepo implements Repo {
  readonly kind = "local" as const;
  private dbp: Promise<IDBPDatabase<BitesDB>>;

  constructor(name = "bites") {
    this.dbp = openDB<BitesDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore("profile");
        const meals = db.createObjectStore("meals", { keyPath: "id" });
        meals.createIndex("dayKey", "dayKey");
        meals.createIndex("createdAt", "createdAt");
        db.createObjectStore("days", { keyPath: "dayKey" });
      },
    });
  }

  async getProfile() {
    return (await (await this.dbp).get("profile", "me")) ?? null;
  }

  async saveProfile(p: Profile) {
    await (await this.dbp).put("profile", p, "me");
  }

  async addMeal(m: Omit<Meal, "id">) {
    const meal: Meal = { ...m, id: crypto.randomUUID() };
    const tx = (await this.dbp).transaction(["meals", "days"], "readwrite");
    await tx.objectStore("meals").put(meal);
    await adjustDay(tx, meal.dayKey, meal.totals, 1);
    await tx.done;
    return meal;
  }

  async updateMeal(m: Meal) {
    const tx = (await this.dbp).transaction(["meals", "days"], "readwrite");
    const old = await tx.objectStore("meals").get(m.id);
    await tx.objectStore("meals").put(m);
    if (!old) await adjustDay(tx, m.dayKey, m.totals, 1);
    else if (old.dayKey === m.dayKey) {
      await adjustDay(tx, m.dayKey, {
        kcal: m.totals.kcal - old.totals.kcal,
        protein: m.totals.protein - old.totals.protein,
        carbs: m.totals.carbs - old.totals.carbs,
        fat: m.totals.fat - old.totals.fat,
      }, 0);
    } else {
      await adjustDay(tx, old.dayKey, neg(old.totals), -1);
      await adjustDay(tx, m.dayKey, m.totals, 1);
    }
    await tx.done;
  }

  async deleteMeal(id: string) {
    const tx = (await this.dbp).transaction(["meals", "days"], "readwrite");
    const old = await tx.objectStore("meals").get(id);
    if (old) {
      await tx.objectStore("meals").delete(id);
      await adjustDay(tx, old.dayKey, neg(old.totals), -1);
    }
    await tx.done;
  }

  async getMeal(id: string) {
    return (await (await this.dbp).get("meals", id)) ?? null;
  }

  async listMeals(opts: { limit?: number; before?: number } = {}) {
    const db = await this.dbp;
    const range = opts.before === undefined ? undefined : IDBKeyRange.upperBound(opts.before, true);
    const out: Meal[] = [];
    let cur = await db.transaction("meals").store.index("createdAt").openCursor(range, "prev");
    while (cur && (opts.limit === undefined || out.length < opts.limit)) {
      out.push(cur.value);
      cur = await cur.continue();
    }
    return out;
  }

  async mealsForDay(dayKey: string) {
    const meals = await (await this.dbp).getAllFromIndex("meals", "dayKey", dayKey);
    return meals.sort((a, b) => a.createdAt - b.createdAt);
  }

  async daysInRange(fromKey: string, toKey: string) {
    return (await this.dbp).getAll("days", IDBKeyRange.bound(fromKey, toKey));
  }

  async exportAll() {
    const db = await this.dbp;
    const meals = await db.getAll("meals");
    return { profile: await this.getProfile(), meals: meals.sort((a, b) => b.createdAt - a.createdAt) };
  }

  async clearAll() {
    const tx = (await this.dbp).transaction(["profile", "meals", "days"], "readwrite");
    await Promise.all([tx.objectStore("profile").clear(), tx.objectStore("meals").clear(), tx.objectStore("days").clear(), tx.done]);
  }

  async getIdToken() {
    return null;
  }
}
