import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Sheet from "../../components/Sheet";
import { AnalyzingDots, FreeModeHint } from "../../components/Analyzing";
import PillButton from "../../components/PillButton";
import { focusWithoutScroll } from "../../lib/keyboard";
import { errorKey } from "../../lib/api";

interface TextEntryProps {
  open: boolean;
  mode: "new" | "add";
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

export default function TextEntry({ open, mode, onClose, onSubmit }: TextEntryProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (e) {
      setError(t(errorKey(e)));
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-5 pb-5 pt-2">
        <h2 className="text-title">{mode === "add" ? t("result.addItemTitle") : t("scan.describeTitle")}</h2>
        <textarea
          ref={focusWithoutScroll}
          rows={3}
          maxLength={500}
          enterKeyHint="enter"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("scan.describePlaceholder")}
          className="w-full resize-none rounded-card bg-elevated p-4 text-body outline-none focus-visible:ring-2 focus-visible:ring-accent placeholder:text-fg-2"
        />
        {error && (
          <p role="alert" className="text-subhead text-fg-2">
            {error}
          </p>
        )}
        <PillButton onClick={() => void submit()} disabled={busy || !text.trim()} className="gap-3">
          {busy && <AnalyzingDots size={8} />}
          {busy ? t("scan.analyzing") : t("scan.analyze")}
        </PillButton>
        {busy && <FreeModeHint className="-mt-1" />}
      </div>
    </Sheet>
  );
}
