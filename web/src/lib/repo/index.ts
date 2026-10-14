import type { Repo } from "./types";
import { LocalRepo } from "./local";

export type { Repo, AuthUser } from "./types";

const forward =
  (load: () => Promise<Repo>, name: keyof Repo) =>
  async (...args: unknown[]) => {
    const repo = await load();
    const fn = repo[name] as ((...a: unknown[]) => unknown) | undefined;
    return fn?.apply(repo, args);
  };

export function lazyRepo(load: () => Promise<Repo>): Repo {
  let loading: Promise<Repo> | undefined;
  const once = () => {
    loading ??= load().catch((e) => {
      loading = undefined;
      throw e;
    });
    return loading;
  };
  const call = (name: keyof Repo) => forward(once, name);
  return {
    kind: "firebase",
    getProfile: call("getProfile") as Repo["getProfile"],
    saveProfile: call("saveProfile") as Repo["saveProfile"],
    addMeal: call("addMeal") as Repo["addMeal"],
    updateMeal: call("updateMeal") as Repo["updateMeal"],
    deleteMeal: call("deleteMeal") as Repo["deleteMeal"],
    getMeal: call("getMeal") as Repo["getMeal"],
    listMeals: call("listMeals") as Repo["listMeals"],
    mealsForDay: call("mealsForDay") as Repo["mealsForDay"],
    daysInRange: call("daysInRange") as Repo["daysInRange"],
    exportAll: call("exportAll") as Repo["exportAll"],
    clearAll: call("clearAll") as Repo["clearAll"],
    getIdToken: call("getIdToken") as Repo["getIdToken"],
    currentUser: call("currentUser") as Repo["currentUser"],
    signInWithGoogle: call("signInWithGoogle") as Repo["signInWithGoogle"],
    signOut: call("signOut") as Repo["signOut"],
  };
}

export function createRepo(): Repo {
  if (import.meta.env.VITE_FIREBASE_PROJECT_ID) {
    return lazyRepo(async () => new (await import("./firebase")).FirebaseRepo());
  }
  return new LocalRepo();
}
