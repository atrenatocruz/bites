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

  it("shows the Google account and signs out back to onboarding", async () => {
    const signOut = vi.fn(async () => {});
    useStore.setState({
      repo: Object.assign(Object.create(repo), {
        kind: "firebase" as const,
        currentUser: async () => ({ uid: "u1", email: "ana@example.com", name: "Ana Silva" }),
        signOut,
      }),
    });
    const onClose = vi.fn();
    render(<SettingsSheet open onClose={onClose} onRedo={() => {}} />);
    expect(await screen.findByText("Ana Silva")).toBeTruthy();
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.queryByText("Anonymous")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(useStore.getState().profile).toBeNull());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("hides the account section for the local repo", () => {
    renderSheet();
    expect(screen.queryByText("Sign in with Google")).toBeNull();
  });

  describe("plan and upgrade code", () => {
    const stubFetch = (handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) => {
      const fn = vi.fn(async (url: string, init?: RequestInit) => {
        const { status = 200, body } = handler(url, init);
        return new Response(JSON.stringify(body), { status });
      });
      vi.stubGlobal("fetch", fn);
      return fn;
    };
    afterEach(() => vi.unstubAllGlobals());

    it("shows the free plan with an upgrade-code field and unlocks premium with a valid code", async () => {
      let plan = { plan: "free", dailyLimit: 5, unlocked: false };
      const fetchFn = stubFetch((url) => (url.endsWith("/api/redeem") ? ((plan = { plan: "paid", dailyLimit: 30, unlocked: true }), { body: { ok: true, ...plan } }) : { body: plan }));
      renderSheet();
      expect(await screen.findByText("Basic AI · 5 scans a day")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Upgrade code"), { target: { value: "renatonaprozis" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(await screen.findByText("Best AI · 30 scans a day")).toBeTruthy();
      expect(screen.queryByLabelText("Upgrade code")).toBeNull();
      const redeem = fetchFn.mock.calls.find(([u]) => String(u).endsWith("/api/redeem"))!;
      expect(JSON.parse(String((redeem[1] as RequestInit).body))).toEqual({ code: "renatonaprozis" });
    });

    it("keeps the free plan after an invalid code", async () => {
      stubFetch((url) => (url.endsWith("/api/redeem") ? { status: 400, body: { error: "invalid_code" } } : { body: { plan: "free", dailyLimit: 5, unlocked: false } }));
      renderSheet();
      await screen.findByText("Basic AI · 5 scans a day");
      fireEvent.change(screen.getByLabelText("Upgrade code"), { target: { value: "wrong" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() => expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.getByLabelText("Upgrade code")).toBeTruthy();
      expect(screen.getByText("Basic AI · 5 scans a day")).toBeTruthy();
    });

    it("lets an unlocked user switch between free and premium with a toggle", async () => {
      let plan = { plan: "paid", dailyLimit: 30, unlocked: true };
      const fetchFn = stubFetch((url, init) => {
        if (url.endsWith("/api/plan") && init?.method === "POST") {
          const wanted = JSON.parse(String(init.body)).plan;
          plan = { ...plan, plan: wanted, dailyLimit: wanted === "paid" ? 30 : 5 };
        }
        return { body: plan };
      });
      renderSheet();
      const toggle = (await screen.findByRole("switch", { name: "Use Premium" })) as HTMLButtonElement;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(screen.queryByLabelText("Upgrade code")).toBeNull();

      fireEvent.click(toggle);
      expect(await screen.findByText("Basic AI · 5 scans a day")).toBeTruthy();
      expect(screen.getByRole("switch", { name: "Use Premium" }).getAttribute("aria-checked")).toBe("false");
      expect(screen.queryByLabelText("Upgrade code")).toBeNull();

      fireEvent.click(screen.getByRole("switch", { name: "Use Premium" }));
      expect(await screen.findByText("Best AI · 30 scans a day")).toBeTruthy();
      const posts = fetchFn.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST").map(([, i]) => JSON.parse(String((i as RequestInit).body)));
      expect(posts).toEqual([{ plan: "free" }, { plan: "paid" }]);
    });

    it("shows no toggle until Premium is unlocked", async () => {
      stubFetch(() => ({ body: { plan: "free", dailyLimit: 5, unlocked: false } }));
      renderSheet();
      await screen.findByText("Basic AI · 5 scans a day");
      expect(screen.queryByRole("switch")).toBeNull();
    });

    it("hides the plan section when the server can't be reached", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
      renderSheet();
      await waitFor(() => expect(screen.getByText("Daily target")).toBeTruthy());
      expect(screen.queryByText("Plan")).toBeNull();
    });
  });
});
