import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "idle" | "starting" | "ready" | "denied" | "unavailable";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const attempt = useRef(0);
  const wanted = useRef(false);
  const [status, setStatus] = useState<CameraStatus>("idle");

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    attempt.current++;
    release();
    setStatus((s) => (s === "denied" || s === "unavailable" ? s : "idle"));
  }, [release]);

  const start = useCallback(async () => {
    wanted.current = true;
    if (streamRef.current) return;
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    const mine = ++attempt.current;
    setStatus("starting");
    try {
      const stream = await media.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (mine !== attempt.current || !wanted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      if (mine === attempt.current) setStatus("ready");
    } catch (e) {
      if (mine !== attempt.current) return;
      release();
      const name = (e as { name?: string })?.name;
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }, [release]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        const resume = wanted.current;
        stop();
        wanted.current = resume;
      } else if (wanted.current) {
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [start, stop]);

  return { videoRef, status, start, stop };
}
