import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, configure } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { macroTargets, type Profile } from "@bites/shared";
import App from "../src/App";
import { lazyRepo, type Repo } from "../src/lib/repo";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

configure({ asyncUtilTimeout: 5000 });

const profile: Profile = {
  sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain",
  kcalTarget: 2760, macroTargets: macroTargets(2760, 80, "maintain"), locale: "en", units: "kcal", createdAt: 1,
};

describe("App boot", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ profile: null });
  });
  afterEach(cleanup);

  it("shows a retry state, not onboarding, when the profile fails to load, and enters the app on retry", async () => {
    const repo = new LocalRepo("bites-boot-1");
    const get = vi.spyOn(repo, "getProfile").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(profile);
    useStore.setState({ repo });
    render(<App skipSplash />);
    expect(await screen.findByText("Couldn't load your data")).toBeTruthy();
    expect(screen.queryByText("Point. Snap. Know.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Scan" })).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("goes to onboarding when there is no profile", async () => {
    useStore.setState({ repo: new LocalRepo("bites-boot-2") });
    render(<App skipSplash />);
    expect(await screen.findByText("Point. Snap. Know.")).toBeTruthy();
  });
});

describe("App boot with Google sign-in", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({ profile: null });
  });
  afterEach(cleanup);

  const fake = (name: string, user: { uid: string; email: string | null; name: string | null } | null) => {
    const repo = new LocalRepo(name);
    const getProfile = vi.fn(async () => profile);
    const fakeRepo = Object.assign(Object.create(repo), { kind: "firebase" as const, currentUser: async () => user, getProfile });
    return { fakeRepo: fakeRepo as Repo, getProfile };
  };

  it("shows onboarding without loading a profile when signed out", async () => {
    const { fakeRepo, getProfile } = fake("bites-boot-3", null);
    useStore.setState({ repo: fakeRepo });
    render(<App skipSplash />);
    expect(await screen.findByText("Point. Snap. Know.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Already have an account? Sign in" })).toBeTruthy();
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("loads the profile and enters the app when signed in", async () => {
    const { fakeRepo, getProfile } = fake("bites-boot-4", { uid: "u1", email: "a@b.c", name: "Ana" });
    useStore.setState({ repo: fakeRepo });
    render(<App skipSplash />);
    expect(await screen.findByRole("button", { name: "Scan" })).toBeTruthy();
    expect(getProfile).toHaveBeenCalledTimes(1);
  });
});

describe("lazyRepo", () => {
  it("retries the loader after a failure", async () => {
    const real = new LocalRepo("bites-lazy");
    const load = vi.fn<() => Promise<Repo>>().mockRejectedValueOnce(new Error("chunk")).mockResolvedValue(real);
    const repo = lazyRepo(load);
    await expect(repo.getProfile()).rejects.toThrow("chunk");
    expect(await repo.getProfile()).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
