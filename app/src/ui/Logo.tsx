import { cn } from "./cn.ts";

/**
 * Symbole « Signal » : une ligne de signal qui se stabilise, point vert en bout de ligne. Logotype « relève. » en minuscules,
 * Geist 600, point final vert (docs/04 § 3). Dessin vectoriel exact, jamais une image.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <rect width="32" height="32" rx="8" className="fill-[var(--c-text)]" />
      <path
        d="M5.5 16.5h4.2l2.3-5.2 3.6 10.4 2.9-7.6 1.6 2.4h3.2"
        fill="none"
        className="stroke-[var(--c-bg)]"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25.6" cy="16.5" r="2.2" className="fill-[var(--c-mark-dot)]" />
    </svg>
  );
}

export function Logo({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const text = size === "lg" ? "text-[1.75rem]" : size === "sm" ? "text-[1.0625rem]" : "text-xl";
  const mark = size === "lg" ? "size-10" : size === "sm" ? "size-6" : "size-7";
  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-label="Relève">
      <LogoMark className={mark} />
      <span aria-hidden="true" className={cn("font-semibold leading-none tracking-[-0.035em] text-text", text)}>
        relève<span className="text-mark-dot">.</span>
      </span>
    </span>
  );
}
