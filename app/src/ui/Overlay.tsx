// Surcouches accessibles (Radix) : boîte de dialogue, info-bulle, onglets. Elles sortent de leur conteneur par un portail.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { useT } from "../lib/i18n/index.tsx";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[var(--c-scrim)]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
            "rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-lift",
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-lg font-semibold tracking-[-0.02em] text-text">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-sm text-soft">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-soft hover:bg-surface-2 hover:text-text"
              aria-label={t("common.close")}
            >
              <X size={18} weight="bold" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={300}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[0.8125rem] text-text shadow-lift"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <TabsPrimitive.List aria-label={label} className={cn("flex gap-1 rounded-[var(--radius-control)] bg-surface-2 p-1", className)}>
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-soft",
        "transition-colors duration-150 hover:text-text data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm",
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export const TabsContent = TabsPrimitive.Content;
