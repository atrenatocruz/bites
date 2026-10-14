import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ImageIcon, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AnalyzeRequest, AnalyzeResult } from "@bites/shared";
import PillButton from "../../components/PillButton";
import { useStore } from "../../store";
import { resolveLocale } from "../../i18n";
import { analyze, ApiError, errorKey } from "../../lib/api";
import { compressImage } from "../../lib/image";
import { useCamera } from "./useCamera";
import ResultSheet from "./ResultSheet";
import TextEntry from "./TextEntry";

type Phase = "live" | "analyzing" | "result" | "error";
type Capture = { image?: string; text?: string };

export default function ScanScreen() {
  const { t, i18n } = useTranslation();
  const repo = useStore((s) => s.repo);
  const { videoRef, status } = useCamera();

  const [phase, setPhase] = useState<Phase>("live");
  const [frame, setFrame] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [source, setSource] = useState<"photo" | "text">("photo");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [resultKey, setResultKey] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [hint, setHint] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [typing, setTyping] = useState(false);

  const captureRef = useRef<Capture>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const hintRef = useRef(hint);
  hintRef.current = hint;

  useEffect(() => {
    return () => {
      if (frame) URL.revokeObjectURL(frame);
    };
  }, [frame]);

  const call = useCallback(
    async (capture: Capture, extraHint?: string): Promise<AnalyzeResult> => {
      const token = await repo.getIdToken().catch(() => null);
      const req: AnalyzeRequest = {
        ...capture,
        locale: resolveLocale(i18n.language),
        localTime: format(new Date(), "HH:mm"),
      };
      const h = extraHint ?? hintRef.current.trim();
      if (h) req.hint = h;
      return analyze(req, token);
    },
    [repo, i18n.language],
  );

  const run = useCallback(
    async (capture: Capture) => {
      captureRef.current = capture;
      setPhase("analyzing");
      setError(null);
      try {
        const next = await call(capture);
        if (!next.isFood || next.items.length === 0) throw new ApiError("not_food", next);
        setResult(next);
        setResultKey((k) => k + 1);
        setPhase("result");
      } catch (e) {
        setError(e);
        setPhase("error");
      }
    },
    [call],
  );

  const resume = useCallback(() => {
    setPhase("live");
    setError(null);
    setFrame(null);
    setHint("");
    setDetailOpen(false);
    void videoRef.current?.play().catch(() => {});
  }, [videoRef]);

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (phase !== "live" || status !== "ready" || !video) return;
    navigator.vibrate?.(10);
    captureRef.current = {};
    video.pause();
    setSource("photo");
    setPhase("analyzing");
    try {
      const { base64, thumb: small } = await compressImage(video);
      setThumb(small);
      await run({ image: base64 });
    } catch (e) {
      setError(e);
      setPhase("error");
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    captureRef.current = {};
    videoRef.current?.pause();
    setSource("photo");
    setFrame(URL.createObjectURL(file));
    setPhase("analyzing");
    try {
      const { base64, thumb: small } = await compressImage(file);
      setThumb(small);
      await run({ image: base64 });
    } catch (e) {
      setError(e);
      setPhase("error");
    }
  };

  const submitText = async (text: string) => {
    const capture = { text };
    const next = await call(capture, "");
    if (!next.isFood || next.items.length === 0) throw new ApiError("not_food", next);
    captureRef.current = capture;
    setSource("text");
    setThumb(null);
    setFrame(null);
    setResult(next);
    setResultKey((k) => k + 1);
    setPhase("result");
    setTyping(false);
  };

  const fallback = status === "denied" || status === "unavailable";
  const showCameraUi = !fallback && phase !== "error";
  const hasFrame = phase !== "live" && (frame !== null || status === "ready");

  const errorCode = error instanceof ApiError ? error.code : null;
  const canRetry = errorCode !== "not_food" && Object.keys(captureRef.current).length > 0;
  const errorTitle = errorCode === "not_food" ? t("result.notFoodTitle") : null;
  const errorBody = errorCode === "not_food" ? ((error as ApiError).result?.notes ?? t("result.notFoodBody")) : t(errorKey(error));

  return (
    <div className={`relative h-full w-full overflow-hidden ${fallback && !frame ? "bg-bg text-fg" : "bg-black text-white"}`}>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${status === "ready" && !frame ? "opacity-100" : "opacity-0"}`}
      />
      {frame && <img src={frame} alt="" className="absolute inset-0 h-full w-full object-cover" />}

      {showCameraUi && phase === "live" && status === "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="aspect-square w-[72%] max-w-[360px] rounded-[32px] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      )}

      {fallback && !frame && phase === "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <h1 className="text-title">{t("scan.denied.title")}</h1>
          <p className="max-w-xs text-subhead text-fg-2">{status === "denied" ? t("errors.camera_denied") : t("scan.denied.body")}</p>
          <div className="mt-4 flex w-full max-w-xs flex-col gap-2">
            <PillButton onClick={() => fileRef.current?.click()}>{t("scan.denied.choosePhoto")}</PillButton>
            <PillButton variant="secondary" onClick={() => setTyping(true)}>
              {t("scan.denied.typeIt")}
            </PillButton>
          </div>
        </div>
      )}

      {phase === "live" && !fallback && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 bg-gradient-to-t from-black/60 to-transparent px-5 pb-8 pt-16">
          <p className="text-center text-subhead text-white/90">{t("scan.scaleHint")}</p>
          {detailOpen ? (
            <input
              autoFocus
              value={hint}
              maxLength={200}
              onChange={(e) => setHint(e.target.value)}
              onBlur={() => setDetailOpen(false)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder={t("scan.detailPlaceholder")}
              className="h-9 w-72 max-w-full rounded-full bg-white/90 px-4 text-subhead text-black outline-none placeholder:text-black/50"
            />
          ) : (
            <span className="flex items-center rounded-full bg-white/20 backdrop-blur-[0px]">
              <button type="button" onClick={() => setDetailOpen(true)} className="h-9 px-4 text-subhead font-medium">
                {hint || t("scan.addDetail")}
              </button>
              {hint && (
                <button type="button" onClick={() => setHint("")} aria-label={t("scan.detailClear")} className="flex h-9 w-9 items-center justify-center">
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </span>
          )}
          <div className="flex w-full max-w-sm items-center justify-between">
            <button type="button" onClick={() => fileRef.current?.click()} aria-label={t("scan.gallery")} className="flex size-12 items-center justify-center rounded-full bg-white/20 active:scale-95">
              <ImageIcon size={24} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void capturePhoto()}
              disabled={status !== "ready"}
              aria-label={t("scan.shutter")}
              className="flex size-[76px] items-center justify-center rounded-full border-4 border-white transition-transform active:scale-95 disabled:opacity-50"
            >
              <span className="size-[58px] rounded-full bg-white" />
            </button>
            <button type="button" onClick={() => setTyping(true)} aria-label={t("scan.type")} className="flex size-12 items-center justify-center rounded-full bg-white/20 active:scale-95">
              <Pencil size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {phase === "analyzing" && hasFrame && (
        <div className="absolute inset-0 overflow-hidden" role="status" aria-live="polite">
          <div className="shimmer absolute inset-0" />
          <div className="absolute inset-x-0 bottom-10 flex justify-center">
            <span className="rounded-full bg-black/50 px-5 py-2 text-headline text-white">{t("scan.analyzing")}</span>
          </div>
        </div>
      )}
      {phase === "analyzing" && !hasFrame && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg text-fg" role="status" aria-live="polite">
          <span className="text-headline">{t("scan.analyzing")}</span>
        </div>
      )}

      {phase === "error" && (
        <div className={`absolute inset-0 flex items-end justify-center px-5 pb-8 ${frame || status === "ready" ? "bg-black/50" : "bg-bg"}`}>
          <div role="alert" className="w-full max-w-sm rounded-card bg-bg p-6 text-center text-fg shadow-xl">
            <h2 className="text-title">{errorTitle ?? t("scan.errorTitle")}</h2>
            <p className="mt-2 text-subhead text-fg-2">{errorBody}</p>
            <div className="mt-5 flex flex-col items-center gap-1">
              {canRetry ? (
                <>
                  <PillButton className="w-full" onClick={() => void run(captureRef.current)}>
                    {t("common.retry")}
                  </PillButton>
                  <PillButton variant="text" onClick={resume}>
                    {t("result.retake")}
                  </PillButton>
                </>
              ) : (
                <PillButton className="w-full" onClick={resume}>
                  {t("common.retry")}
                </PillButton>
              )}
            </div>
          </div>
        </div>
      )}

      {result && (
        <ResultSheet
          key={resultKey}
          open={phase === "result"}
          result={result}
          source={source}
          thumb={thumb}
          hint={source === "photo" ? hint.trim() : ""}
          onClose={resume}
          onRetake={resume}
          onSaved={resume}
          reanalyze={(h) => call(captureRef.current, h)}
          analyzeText={(text) => call({ text }, "")}
        />
      )}

      <TextEntry open={typing} mode="new" onClose={() => setTyping(false)} onSubmit={submitText} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void pickFile(file);
        }}
      />
    </div>
  );
}
