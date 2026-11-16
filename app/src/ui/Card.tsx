import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn.ts";

/** Surface de premier niveau. Jamais une carte dans une carte : à l'intérieur, utiliser des séparateurs ou surface-2. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { as?: "div" | "section" | "article" | "aside" }>(
  function Card({ as: As = "div", className, ...rest }, ref) {
    return <As ref={ref} className={cn("rounded-[var(--radius-card)] border border-border bg-surface", className)} {...rest} />;
  },
);
