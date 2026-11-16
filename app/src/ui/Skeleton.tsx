import { cn } from "./cn.ts";

/** Squelette de chargement (jamais une roue au milieu du contenu). Caché des lecteurs d'écran : l'état est annoncé ailleurs. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-surface-2", className)} />;
}
