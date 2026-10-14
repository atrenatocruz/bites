import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  signInAnonymously,
  signInWithPopup,
  type Auth,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  initializeFirestore,
  limit as limitTo,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  where,
  writeBatch,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore";
import type { DaySummary, Meal, Profile, Totals } from "@bites/shared";
import type { AccountInfo, Repo } from "./types";

const BATCH_LIMIT = 400;

const neg = (t: Totals): Totals => ({ kcal: -t.kcal, protein: -t.protein, carbs: -t.carbs, fat: -t.fat });
const clean = (day: DaySummary): DaySummary => ({
  dayKey: day.dayKey,
  kcal: Math.max(0, Math.round(day.kcal)),
  protein: Math.max(0, Math.round(day.protein * 10) / 10),
  carbs: Math.max(0, Math.round(day.carbs * 10) / 10),
  fat: Math.max(0, Math.round(day.fat * 10) / 10),
  count: day.count,
});

export class FirebaseRepo implements Repo {
  readonly kind = "firebase" as const;
  private auth: Auth;
  private db: Firestore;
  private ready: Promise<User> | null = null;

  constructor() {
    const app = initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });
    this.auth = getAuth(app);
    this.db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  }

  private user(): Promise<User> {
    this.ready ??= (async () => {
      await this.auth.authStateReady();
      return this.auth.currentUser ?? (await signInAnonymously(this.auth)).user;
    })();
    this.ready.catch(() => {
      this.ready = null;
    });
    return this.ready;
  }

  private async refs() {
    const { uid } = await this.user();
    const root = `users/${uid}`;
    return {
      profile: doc(this.db, root),
      meal: (id: string) => doc(this.db, `${root}/meals/${id}`),
      day: (key: string) => doc(this.db, `${root}/days/${key}`),
      meals: collection(this.db, `${root}/meals`),
      days: collection(this.db, `${root}/days`),
    };
  }

  private async adjustDay(batch: WriteBatch, dayKey: string, delta: Totals, countDelta: number) {
    const { day } = await this.refs();
    const ref = day(dayKey);
    if (countDelta < 0) {
      const cur = (await getDoc(ref)).data() as DaySummary | undefined;
      if (!cur || cur.count + countDelta <= 0) {
        batch.delete(ref);
        return;
      }
    }
    batch.set(
      ref,
      { dayKey, kcal: increment(delta.kcal), protein: increment(delta.protein), carbs: increment(delta.carbs), fat: increment(delta.fat), count: increment(countDelta) },
      { merge: true },
    );
  }

  async getProfile() {
    const { profile } = await this.refs();
    const snap = await getDoc(profile);
    return snap.exists() ? (snap.data() as Profile) : null;
  }

  async saveProfile(p: Profile) {
    const { profile } = await this.refs();
    await setDoc(profile, p);
  }

  async addMeal(m: Omit<Meal, "id">) {
    const meal: Meal = { ...m, id: crypto.randomUUID() };
    const { meal: mealRef } = await this.refs();
    const batch = writeBatch(this.db);
    batch.set(mealRef(meal.id), meal);
    await this.adjustDay(batch, meal.dayKey, meal.totals, 1);
    await batch.commit();
    return meal;
  }

  async updateMeal(m: Meal) {
    const { meal: mealRef } = await this.refs();
    const snap = await getDoc(mealRef(m.id));
    const old = snap.exists() ? (snap.data() as Meal) : null;
    const batch = writeBatch(this.db);
    batch.set(mealRef(m.id), m);
    if (!old) await this.adjustDay(batch, m.dayKey, m.totals, 1);
    else if (old.dayKey === m.dayKey) {
      await this.adjustDay(
        batch,
        m.dayKey,
        { kcal: m.totals.kcal - old.totals.kcal, protein: m.totals.protein - old.totals.protein, carbs: m.totals.carbs - old.totals.carbs, fat: m.totals.fat - old.totals.fat },
        0,
      );
    } else {
      await this.adjustDay(batch, old.dayKey, neg(old.totals), -1);
      await this.adjustDay(batch, m.dayKey, m.totals, 1);
    }
    await batch.commit();
  }

  async deleteMeal(id: string) {
    const { meal: mealRef } = await this.refs();
    const snap = await getDoc(mealRef(id));
    if (!snap.exists()) return;
    const old = snap.data() as Meal;
    const batch = writeBatch(this.db);
    batch.delete(mealRef(id));
    await this.adjustDay(batch, old.dayKey, neg(old.totals), -1);
    await batch.commit();
  }

  async getMeal(id: string) {
    const { meal } = await this.refs();
    const snap = await getDoc(meal(id));
    return snap.exists() ? (snap.data() as Meal) : null;
  }

  async listMeals(opts: { limit?: number; before?: number } = {}) {
    const { meals } = await this.refs();
    const parts = [
      ...(opts.before === undefined ? [] : [where("createdAt", "<", opts.before)]),
      orderBy("createdAt", "desc"),
      ...(opts.limit === undefined ? [] : [limitTo(opts.limit)]),
    ];
    return (await getDocs(query(meals, ...parts))).docs.map((d) => d.data() as Meal);
  }

  async mealsForDay(dayKey: string) {
    const { meals } = await this.refs();
    const list = (await getDocs(query(meals, where("dayKey", "==", dayKey)))).docs.map((d) => d.data() as Meal);
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }

  async daysInRange(fromKey: string, toKey: string) {
    const { days } = await this.refs();
    const snap = await getDocs(query(days, where("dayKey", ">=", fromKey), where("dayKey", "<=", toKey), orderBy("dayKey")));
    return snap.docs.map((d) => d.data() as DaySummary).filter((d) => d.count > 0).map(clean);
  }

  async exportAll() {
    const { meals } = await this.refs();
    const list = (await getDocs(query(meals, orderBy("createdAt", "desc")))).docs.map((d) => d.data() as Meal);
    return { profile: await this.getProfile(), meals: list };
  }

  async clearAll() {
    const { profile, meals, days } = await this.refs();
    const refs = [...(await getDocs(meals)).docs, ...(await getDocs(days)).docs].map((d) => d.ref);
    for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(this.db);
      refs.slice(i, i + BATCH_LIMIT).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await deleteDoc(profile);
  }

  async getIdToken() {
    await this.user();
    return (await this.auth.currentUser?.getIdToken()) ?? null;
  }

  async getAccount(): Promise<AccountInfo> {
    const u = await this.user();
    return { anonymous: u.isAnonymous, email: u.email };
  }

  async signInWithGoogle() {
    const u = await this.user();
    const provider = new GoogleAuthProvider();
    if (!u.isAnonymous) return;
    try {
      await linkWithPopup(u, provider);
    } catch (e) {
      if ((e as { code?: string }).code !== "auth/credential-already-in-use") throw e;
      await signInWithPopup(this.auth, provider);
      this.ready = null;
    }
  }

  async signOut() {
    await this.auth.signOut();
    this.ready = null;
  }
}
