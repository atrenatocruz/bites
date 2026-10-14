import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface LogoProps { size?: number; bitten?: boolean; className?: string }

export default function Logo({ size = 32, bitten = false, className }: LogoProps) {
  const id = useId();
  const reduce = useReducedMotion();
  const animated = bitten && !reduce;
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} role="img" aria-label="Bites">
      <mask id={id}>
        <rect width="512" height="512" fill="white" />
        <motion.circle
          cx="410"
          cy="120"
          fill="black"
          initial={{ r: animated ? 0 : 92 }}
          animate={{ r: 92 }}
          transition={{ type: "spring", stiffness: 400, damping: 34, delay: animated ? 0.25 : 0 }}
        />
      </mask>
      <circle cx="256" cy="256" r="216" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}
