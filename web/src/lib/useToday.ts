import { useEffect, useRef, useState } from "react";
import { dayKey } from "@bites/shared";

function msToMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function useToday(onRollover?: (previous: string, next: string) => void): string {
  const [today, setToday] = useState(() => dayKey(new Date()));
  const current = useRef(today);
  const callback = useRef(onRollover);
  callback.current = onRollover;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const next = dayKey(new Date());
      if (next !== current.current) {
        const previous = current.current;
        current.current = next;
        setToday(next);
        callback.current?.(previous, next);
      }
      clearTimeout(timer);
      timer = setTimeout(refresh, msToMidnight(new Date()));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(refresh, msToMidnight(new Date()));
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
    };
  }, []);

  return today;
}
