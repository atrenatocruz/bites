import { create } from "zustand";
import { dayKey, type Profile } from "@bites/shared";
import type { PlanInfo } from "./lib/api";
import { createRepo, type Repo } from "./lib/repo";

export type Tab = "history" | "scan" | "diary";

interface AppState {
  tab: Tab;
  setTab: (t: Tab) => void;
  selectedDay: string;
  selectedDayPinned: boolean;
  setSelectedDay: (d: string) => void;
  rollDay: (previous: string, next: string) => void;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
  /** The signed-in user's plan, or null until the server has answered. */
  plan: PlanInfo | null;
  setPlanInfo: (p: PlanInfo | null) => void;
  repo: Repo;
  dataVersion: number;
  bump: () => void;
}

export const useStore = create<AppState>((set) => ({
  tab: "diary",
  setTab: (tab) => set({ tab }),
  selectedDay: dayKey(new Date()),
  selectedDayPinned: false,
  setSelectedDay: (selectedDay) => set({ selectedDay, selectedDayPinned: selectedDay !== dayKey(new Date()) }),
  rollDay: (previous, next) =>
    set((s) => ({ selectedDay: s.selectedDay === previous ? next : s.selectedDay, selectedDayPinned: false })),
  profile: null,
  setProfile: (profile) => set({ profile }),
  plan: null,
  setPlanInfo: (plan) => set({ plan }),
  repo: createRepo(),
  dataVersion: 0,
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));
