import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, configure, waitFor, within } from "@testing-library/react";
import "../src/i18n";
import i18n from "../src/i18n";
import { macroTargets, type Profile } from "@bites/shared";
import SettingsSheet from "../src/features/settings/SettingsSheet";
import { LocalRepo } from "../src/lib/repo/local";
import { useStore } from "../src/store";

configure({ asyncUtilTimeout: 5000 });

let n = 0;
let repo: LocalRepo;

const base: Profile = {
  sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain",
  kcalTarget: 2760, macroTargets: macroTargets(2760, 80, "maintain"), locale: "system", units: "kcal", createdAt: 1,
};

const renderSheet = () => render(<SettingsSheet open onClose={() => {}} onRedo={() => {}} />);

describe("SettingsSheet", () => {
  beforeEach(async () => {
    repo = new LocalRepo(`bites-set-${++n}`);
    await i18n.changeLanguage("en");
    await repo.saveProfile(base);
    useStore.setState({ repo, profile: base, dataVersion: 0 });
  });
  afterEach(cleanup);

  const commitTarget = (value: string) => {
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  };

  it("recomputes macros when the target changes and they were not edited", async () => {
    renderSheet();
    commitTarget("2200");
    await waitFor(() => expect(useStore.getState().profile?.kcalTarget).toBe(2200));
    expect(useStore.getState().profile?.macroTargets).toEqual(macroTargets(2200, 80, "maintain"));
    expect((await repo.getProfile())?.kcalTarget).toBe(2200);
  });

  it("keeps macros the user edited by hand", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Increase Protein" }));
    const edited = { ...base.macroTargets, protein: base.macroTargets.protein + 5 };
    await waitFor(() => expect(useStore.getState().profile?.macroTargets).toEqual(edited));
    commitTarget("2200");
    await waitFor(() => expect(useStore.getState().profile?.kcalTarget).toBe(2200));
    expect(useStore.getState().profile?.macroTargets).toEqual(edited);
  });

  it("switches the language", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Português" }));
    await waitFor(() => expect(i18n.language).toBe("pt-PT"));
    expect(useStore.getState().profile?.locale).toBe("pt-PT");
    expect(await screen.findByText("Definições")).toBeTruthy();
  });

  it("exports CSV through a Blob URL", async () => {
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("deletes everything only after confirming, then clears the profile", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Delete all data" }));
    expect(await repo.getProfile()).not.toBeNull();
    const dialog = (await screen.findByText("Delete everything?")).closest("[role=dialog]") as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(useStore.getState().profile).toBeNull());
    expect(await repo.getProfile()).toBeNull();
  });

  it("hides the account section for the local repo", () => {
    renderSheet();
    expect(screen.queryByText("Sign in with Google")).toBeNull();
  });
});
