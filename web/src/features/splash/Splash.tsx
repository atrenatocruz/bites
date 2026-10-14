import { useCallback, useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Logo from "../../components/Logo";

interface SplashProps { onDone: () => void }

const FULL_MS = 1000;
const REDUCED_MS = 500;
const BITE_MS = 400;

export default function Splash({ onDone }: SplashProps) {
  const reduce = useReducedMotion();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    doneRef.current();
  }, []);

  useEffect(() => {
    const timers = [setTimeout(finish, reduce ? REDUCED_MS : FULL_MS)];
    if (!reduce) timers.push(setTimeout(() => navigator.vibrate?.(10), BITE_MS));
    return () => timers.forEach(clearTimeout);
  }, [reduce, finish]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex cursor-default select-none flex-col items-center justify-center bg-bg text-accent"
      onPointerDown={finish}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <motion.div
        initial={{ scale: reduce ? 1 : 0.8, opacity: reduce ? 1 : 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
        <Logo size={120} bitten />
      </motion.div>
      <motion.span
        className="mt-5 text-[34px] font-bold leading-10 tracking-[-0.03em] text-fg"
        initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduce ? 0 : 0.7, duration: 0.3, ease: "easeOut" }}
      >
        Bites
      </motion.span>
    </motion.div>
  );
}
