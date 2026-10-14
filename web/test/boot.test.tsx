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
