import type { ReactNode } from "react";
import Ring from "../../components/Ring";
import type { DayStatus } from "../../lib/stats";

const COLOR: Record<DayStatus, string> = {
  empty: "var(--separator)",
  under: "var(--accent)",
  good: "var(--good)",
  over: "var(--over)",
};

interface MiniRingProps {
  kcal: number | undefined;
  target: number;
  status: DayStatus;
  size: number;
  stroke: number;
  filled?: boolean;
  children?: ReactNode;
}

export default function MiniRing({ kcal, target, status, size, stroke, filled, children }: MiniRingProps) {
  return (
    <div className="relative inline-flex">
      {filled && <span className="absolute rounded-full bg-fg" style={{ inset: stroke + 1 }} aria-hidden="true" />}
      <Ring value={kcal ?? 0} max={target} size={size} stroke={stroke} color={COLOR[status]} animate={false}>
        {children}
      </Ring>
    </div>
  );
}
