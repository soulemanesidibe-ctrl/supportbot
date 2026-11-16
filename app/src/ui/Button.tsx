import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
export type ButtonSize = "md" | "sm" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-border-strong bg-surface text-text hover:bg-surface-2",
  ghost: "text-text hover:bg-surface-2",
  quiet: "text-soft hover:bg-surface-2 hover:text-text",
  danger: "border border-danger/50 bg-danger-soft text-danger-ink hover:bg-danger hover:text-on-danger",
};
// Cible tactile d'au moins 44 px partout (ui-ux-pro-max) ; « sm » reste à 44 px de hauteur utile grâce au padding vertical.
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-sm",
  md: "min-h-11 px-4 text-[0.9375rem]",
  lg: "min-h-12 px-5 text-base",
  icon: "size-11 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Rend l'enfant (un lien par exemple) avec l'apparence d'un bouton. */
  asChild?: boolean;
  /** Action en cours : le bouton reste lisible, devient inactif et l'annonce aux lecteurs d'écran. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", asChild, busy, disabled, className, children, type, ...rest },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex select-none items-center gap-2 rounded-[var(--radius-control)] font-medium leading-none tracking-[-0.005em]",
        "transition-[background-color,color,opacity,transform] duration-150 ease-[var(--ease-out-expo)] active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
        "no-underline",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
});
