import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-6 items-center rounded-md border border-border-strong px-1.5 font-mono text-xs text-soft", className)}>
      {children}
    </kbd>
  );
}
