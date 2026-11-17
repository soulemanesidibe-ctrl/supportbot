// File unifiée : tout ce qui attend le technicien, tous ses clients assignés, du plus urgent au moins urgent. Clavier : flèches ou
// j / k pour se déplacer, Entrée pour ouvrir. Filtres par nature, avec leur effectif.
import { useMemo, useRef, type KeyboardEvent } from "react";
import { Skeleton } from "../ui/Skeleton.tsx";
import { cn } from "../ui/cn.ts";
import type { Priority, QueueItem, QueueKind } from "../lib/api/console-types.ts";
import { useT } from "../lib/i18n/index.tsx";
import { KindBadge, minutesUntil, Ref, Since } from "./parts.tsx";

export type QueueFilter = "all" | "approval" | "incident" | "request";
const FILTER_KINDS: Record<QueueFilter, readonly QueueKind[] | null> = {
  all: null,
  approval: ["approval"],
  incident: ["incident", "prevention"],
  request: ["escalation", "sla", "waiting"],
};
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const KIND_RANK: Record<QueueKind, number> = { incident: 0, sla: 1, approval: 2, escalation: 3, waiting: 4, prevention: 5 };

/** Ordre de la file : priorité, puis échéance la plus proche, puis nature, puis ancienneté. */
export function sortQueue(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p) return p;
    const sa = a.slaDueAt ? minutesUntil(a.slaDueAt) : Infinity;
    const sb = b.slaDueAt ? minutesUntil(b.slaDueAt) : Infinity;
    if (sa !== sb) return sa - sb;
    const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (k) return k;
    return a.since < b.since ? -1 : 1;
  });
}

export function filterQueue(items: readonly QueueItem[], f: QueueFilter): QueueItem[] {
  const kinds = FILTER_KINDS[f];
  return kinds ? items.filter((i) => kinds.includes(i.kind)) : [...items];
}

export function Queue({
  items,
  filter,
  onFilter,
  selected,
  onOpen,
  density,
}: {
  items: readonly QueueItem[] | null;
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  selected: string | null;
  onOpen: (item: QueueItem) => void;
  density: "comfortable" | "compact";
}) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);
  const sorted = useMemo(() => (items ? sortQueue(items) : null), [items]);
  const shown = useMemo(() => (sorted ? filterQueue(sorted, filter) : null), [sorted, filter]);
  const clients = useMemo(() => new Set((items ?? []).map((i) => i.client.id)).size, [items]);

  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 };
    const step = keys[e.key];
    if (!step || !list.current) return;
    const buttons = [...list.current.querySelectorAll<HTMLButtonElement>("button[data-queue-item]")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, i + step))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <section aria-labelledby="file-titre" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-4 pb-3 pt-5 sm:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 id="file-titre" className="text-lg font-semibold tracking-[-0.02em] text-text">
            {t("console.queue.title")}
          </h1>
          {items && (
            <span className="num text-[0.8125rem] text-soft">{t("console.queue.count", { clients, n: items.length })}</span>
          )}
        </div>
        <div role="group" aria-label={t("console.queue.filter")} className="flex gap-1 rounded-[var(--radius-control)] bg-surface-2 p-1">
          {(["all", "approval", "incident", "request"] as const).map((f) => {
            const n = sorted ? filterQueue(sorted, f).length : null;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => onFilter(f)}
                className={cn(
                  "inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-medium text-soft transition-colors duration-150",
                  "hover:text-text aria-pressed:bg-surface aria-pressed:text-text aria-pressed:shadow-sm",
                )}
              >
                {t(`console.filter.${f}`)}
                {n !== null && <span className="num text-xs text-soft">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {shown === null ? (
        <div role="status" className="flex flex-col">
          <span className="sr-only">{t("common.loading")}</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 border-b border-border px-5 py-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col gap-1 px-5 py-8">
          <p className="font-medium text-text">{t(filter === "all" ? "console.queue.emptyAll" : "console.queue.empty")}</p>
          <p className="text-sm text-soft">{t("console.queue.emptyBody")}</p>
        </div>
      ) : (
        <ul ref={list} onKeyDown={move} className="min-h-0 flex-1 overflow-y-auto" aria-label={t("console.queue.list")}>
          {shown.map((item) => (
            <li key={item.key} className="border-b border-border">
              <button
                type="button"
                data-queue-item
                aria-current={selected === item.key ? "true" : undefined}
                onClick={() => onOpen(item)}
                className={cn(
                  "group flex w-full flex-col text-left transition-colors duration-150 hover:bg-surface",
                  "aria-[current=true]:bg-surface-2 focus-visible:bg-surface",
                  density === "compact" ? "gap-1 px-4 py-2.5 sm:px-5" : "gap-1.5 px-4 py-3.5 sm:px-5",
                )}
              >
                <span className="flex items-center gap-2">
                  <KindBadge item={item} />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-soft">{item.client.name}</span>
                  <Since iso={item.since} className="shrink-0 text-xs text-soft" />
                </span>
                <span className="line-clamp-2 text-[0.9375rem] font-medium leading-snug text-text">{item.title}</span>
                {(item.detail || item.ticketRef) && density === "comfortable" && (
                  <span className="flex items-center gap-2 text-[0.8125rem] text-soft">
                    {item.ticketRef && <Ref>{item.ticketRef}</Ref>}
                    <span className="line-clamp-1 min-w-0">{item.detail}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
