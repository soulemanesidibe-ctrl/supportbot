// La ligne de signal de la marque, dessinée en mouvement : moment signature de Relève. Pendant qu'une réponse se prépare, la
// ligne se trace en boucle et le point clignote ; au repos, c'est le signal du logo, entier, point allumé. Animation de tracé
// seulement (longueur du trait et opacité), coupée si la personne a demandé moins de mouvement.
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./cn.ts";

const PULSE = "M2 12h6l3-7 4.5 14 3.5-10 2 3h5";

export function SignalLine({ state, className }: { state: "working" | "settled"; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 32 24" className={cn("h-5 w-7 shrink-0", className)} aria-hidden="true">
      <motion.path
        d={PULSE}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={
          state === "working" && !reduce
            ? { pathLength: [0.15, 1, 1], pathOffset: [0, 0, 1], opacity: [0.6, 1, 0.6] }
            : { pathLength: 1, pathOffset: 0, opacity: 1 }
        }
        transition={state === "working" && !reduce ? { duration: 1.4, ease: [0.16, 1, 0.3, 1], repeat: Infinity } : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.circle
        cx="29"
        cy="12"
        r="2.2"
        className="fill-[var(--c-mark-dot)]"
        initial={false}
        animate={{ opacity: state === "settled" ? 1 : reduce ? 0.6 : [0.25, 0.9, 0.25], scale: state === "settled" ? 1 : 0.85 }}
        transition={state === "working" && !reduce ? { duration: 1.4, repeat: Infinity } : { duration: 0.25 }}
      />
    </svg>
  );
}
