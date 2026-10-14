import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface ToastAction { label: string; onClick: () => void }
interface ToastItem { id: number; message: string; action?: ToastAction }

let nextId = 1;
let current: ToastItem | null = null;
const listeners = new Set<(item: ToastItem | null) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function publish(item: ToastItem | null) {
  current = item;
  listeners.forEach((l) => l(item));
}

export function toast(message: string, action?: ToastAction) {
  clearTimeout(timer);
  publish({ id: nextId++, message, action });
  timer = setTimeout(() => publish(null), action ? 5000 : 2500);
}

export function Toaster() {
  const [item, setItem] = useState<ToastItem | null>(current);
  useEffect(() => {
    listeners.add(setItem);
    return () => {
      listeners.delete(setItem);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+104px)] z-50 flex justify-center px-5" role="status" aria-live="polite">
      <AnimatePresence>
        {item && (
          <motion.div
            key={item.id}
            className="pointer-events-auto flex items-center gap-4 rounded-full bg-fg px-5 py-3 text-subhead text-bg shadow-lg"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
          >
            <span>{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="font-semibold text-accent-inverse"
                onClick={() => {
                  item.action!.onClick();
                  clearTimeout(timer);
                  publish(null);
                }}
              >
                {item.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
