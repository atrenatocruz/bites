import { create } from "zustand";
import { dayKey, type Profile } from "@bites/shared";
import { createRepo, type Repo } from "./lib/repo";

export type Tab = "history" | "scan" | "diary";

interface AppState {
  tab: Tab;
  setTab: (t: Tab) => void;
  selectedDay: string;
  setSelectedDay: (d: string) => void;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
  repo: Repo;
  dataVersion: number;
  bump: () => void;
}

export const useStore = create<AppState>((set) => ({
  tab: "scan",
  setTab: (tab) => set({ tab }),
  selectedDay: dayKey(new Date()),
  setSelectedDay: (selectedDay) => set({ selectedDay }),
  profile: null,
  setProfile: (profile) => set({ profile }),
  repo: createRepo(),
  dataVersion: 0,
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));
