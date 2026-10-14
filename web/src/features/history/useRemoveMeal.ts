import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Meal } from "@bites/shared";
import { toast } from "../../components/Toast";
import { useStore } from "../../store";

export function useRemoveMeal(onStart: () => void) {
  const { t } = useTranslation();
  const repo = useStore((s) => s.repo);
  const pending = useRef(new Set<string>());

  return useCallback(
    async (meal: Meal) => {
      const { id, ...data } = meal;
      onStart();
      if (pending.current.has(id)) return;
      pending.current.add(id);
      try {
        await repo.deleteMeal(id);
      } catch {
        toast(t("errors.generic"));
        return;
      } finally {
        pending.current.delete(id);
      }
      useStore.getState().bump();
      let undone = false;
      toast(t("history.deleted"), {
        label: t("common.undo"),
        onClick: () => {
          if (undone) return;
          undone = true;
          void repo.addMeal(data).then(() => useStore.getState().bump());
        },
      });
    },
    [repo, t, onStart],
  );
}
