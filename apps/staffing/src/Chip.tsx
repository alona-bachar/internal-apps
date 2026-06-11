import type { ReactNode } from "react";

export type ChipTone = "success" | "warning" | "danger" | "neutral";

type ChipProps = {
  tone?: ChipTone;
  children: ReactNode;
  ariaLabel?: string;
};

export function Chip({ tone = "neutral", children, ariaLabel }: ChipProps) {
  return (
    <span className={`chip ${tone}`} aria-label={ariaLabel}>
      {children}
    </span>
  );
}
