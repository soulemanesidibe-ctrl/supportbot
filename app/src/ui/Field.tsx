import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn.ts";

const CONTROL =
  "w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3.5 text-[0.9375rem] text-text placeholder:text-soft " +
  "transition-[border-color,box-shadow] duration-150 hover:border-soft/60 focus-visible:border-focus focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-focus/35 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(CONTROL, "min-h-11", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(CONTROL, "min-h-11 resize-none py-3 leading-relaxed", className)} {...rest} />;
});

/** Champ étiqueté : libellé, aide et erreur reliés au contrôle pour les lecteurs d'écran. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-aide` : undefined;
  const errorId = error ? `${id}-erreur` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-[0.8125rem] text-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[0.8125rem] font-medium text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
