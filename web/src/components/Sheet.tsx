import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  snap?: "auto" | "full";
}

const SPRING = { type: "spring", stiffness: 400, damping: 34 } as const;

export default function Sheet({ open, onClose, children, snap = "auto" }: SheetProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const controls = useDragControls();
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-sheet bg-bg pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_rgba(0,0,0,0.12)] ${snap === "full" ? "h-[calc(100%-env(safe-area-inset-top)-16px)]" : "max-h-[92%]"}`}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={reduce ? { duration: 0.15 } : SPRING}
            drag={reduce ? false : "y"}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120) onClose();
            }}
          >
            <div className="flex shrink-0 justify-center pb-2 pt-2.5">
              <button
                type="button"
                onClick={(e) => {
                  const wasDrag = dragged.current;
                  dragged.current = false;
                  if (e.detail === 0 || !wasDrag) onClose();
                }}
                onPointerDown={(e) => {
                  pressAt.current = { x: e.clientX, y: e.clientY };
                  dragged.current = false;
                  controls.start(e);
                }}
                onPointerUp={(e) => {
                  const start = pressAt.current;
                  pressAt.current = null;
                  dragged.current = !!start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 6;
                }}
                onPointerCancel={() => {
                  pressAt.current = null;
                  dragged.current = false;
                }}
                aria-label={t("common.close")}
                className="h-5 w-16 cursor-grab touch-none"
              >
                <span className="mx-auto mt-2 block h-1 w-9 rounded-full bg-sep" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
