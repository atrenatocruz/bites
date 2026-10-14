import type { ButtonHTMLAttributes } from "react";

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "text";
}

const VARIANTS = {
  primary: "h-[52px] bg-accent px-8 text-white",
  secondary: "h-[52px] bg-elevated px-8 text-fg",
  text: "h-11 px-4 text-accent",
};

export default function PillButton({ variant = "primary", className = "", type = "button", ...rest }: PillButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-full text-headline transition-[transform,opacity] duration-150 active:scale-[0.97] active:opacity-80 disabled:opacity-40 disabled:active:scale-100 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
