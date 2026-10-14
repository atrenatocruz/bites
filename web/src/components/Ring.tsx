import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface RingProps {
  value: number;
  max: number;
  size: number;
  stroke: number;
  color: string;
  children?: ReactNode;
  animate?: boolean;
  label?: string;
}

export default function Ring({ value, max, size, stroke, color, children, animate = true, label }: RingProps) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const dash = `${circ * ratio} ${circ - circ * ratio}`;
  const common = {
    cx: size / 2,
    cy: size / 2,
    r,
    fill: "none",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  };
  return (
    <div className="relative inline-flex items-center justify-center" role={label ? "img" : undefined} aria-label={label} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle {...common} stroke="var(--separator)" opacity={0.6} />
        {ratio > 0 &&
          (animate ? (
            <motion.circle
              {...common}
              data-arc=""
              stroke={color}
              initial={{ strokeDasharray: `0 ${circ}` }}
              animate={{ strokeDasharray: dash }}
              transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }}
            />
          ) : (
            <circle {...common} data-arc="" stroke={color} strokeDasharray={dash} />
          ))}
      </svg>
      {children && <div aria-hidden={label ? true : undefined} className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>}
    </div>
  );
}
