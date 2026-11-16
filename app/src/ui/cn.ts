import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Assemble des classes Tailwind ; la dernière gagne en cas de conflit (px-4 puis px-2 : px-2). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
