import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type BadgeTone = "neutral" | "outline" | "signal" | "relief" | "danger" | "solid-relief" | "solid-danger";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-text",
  outline: "border border-border-strong text-soft",
  signal: "bg-signal-soft text-signal-ink",
  relief: "bg-relief-soft text-relief-ink",
  danger: "bg-danger-soft text-danger-ink",
  "solid-relief": "bg-relief text-on-relief",
  "solid-danger": "bg-danger text-on-danger",
};

/** Étiquette d'état. La couleur n'est jamais seule : le texte du badge porte l'information. */
export function Badge({ tone = "neutral", icon, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; icon?: ReactNode }) {
  return (
    <span
      className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[0.8125rem] font-medium leading-none", TONES[tone], className)}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
