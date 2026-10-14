import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  snap?: "auto" | "full";
}

const stack: symbol[] = [];

const SPRING = { type: "spring", stiffness: 400, damping: 34 } as const;

export default function Sheet({ open, onClose, children, snap = "auto" }: SheetProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const controls = useDragControls();
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const [keyboard, setKeyboard] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol("sheet");
    stack.push(id);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  // On iOS the keyboard covers the page instead of resizing it, so lift the sheet by the covered height.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!open || !vv) return;
    const update = () => setKeyboard(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setKeyboard(0);
    };
  }, [open]);

  const keepFieldVisible = (e: FocusEvent<HTMLDivElement>) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    // Wait for the keyboard animation, then scroll only the sheet's own content.
    window.setTimeout(() => el.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 320);
  };

  // In a standalone PWA there is no browser chrome, so pulling down on the content at the top closes the sheet.
  useEffect(() => {
    const el = scroller.current;
    if (!open || !el) return;
    let startY = 0;
    let pulling = false;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0]!.clientY;
      pulling = false;
    };
    const onMove = (e: TouchEvent) => {
      const dy = e.touches[0]!.clientY - startY;
      if (!pulling) {
        if (el.scrollTop > 0 || dy <= 6) return;
        pulling = true;
      }
      if (e.cancelable) e.preventDefault();
      y.set(Math.max(0, dy - 6) * 0.8);
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      if (y.get() > 100) close.current();
      else void animate(y, 0, SPRING);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [open, y]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 overscroll-none">
          <motion.div
            className="absolute inset-0 touch-none bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className={`absolute outline-none inset-x-0 bottom-0 flex flex-col rounded-t-sheet bg-bg pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_rgba(0,0,0,0.12)] ${snap === "full" ? "h-[calc(100%-env(safe-area-inset-top)-16px)]" : "max-h-[92%]"}`}
            style={{ y, bottom: keyboard, maxHeight: keyboard ? `calc(100% - ${keyboard}px - env(safe-area-inset-top) - 8px)` : undefined }}
            onFocusCapture={keepFieldVisible}
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
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
