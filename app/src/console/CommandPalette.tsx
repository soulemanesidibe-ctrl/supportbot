// Palette de commandes (Ctrl K ou Cmd K) : aller à un client, une demande, un incident, une validation ; changer le thème ou la
// densité. Tout au clavier (cmdk : flèches, Entrée, Échap).
import { Command } from "cmdk";
import { ArrowRight, Buildings, ListChecks, MagnifyingGlass, Moon, Rows, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ClientRef, ConsoleApi, QueueItem, SearchHit } from "../lib/api/console-types.ts";
import { useT } from "../lib/i18n/index.tsx";
import { useTheme } from "../lib/theme.tsx";
import type { QueueFilter } from "./Queue.tsx";

export function CommandPalette({
  api,
  open,
  onOpenChange,
  onTarget,
  onFilter,
  onAway,
  density,
  onDensity,
}: {
  api: ConsoleApi;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onTarget: (target: QueueItem["target"], client: ClientRef) => void;
  onFilter: (f: QueueFilter) => void;
  onAway: () => void;
  density: "comfortable" | "compact";
  onDensity: () => void;
}) {
  const t = useT();
  const { theme, toggle } = useTheme();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<readonly SearchHit[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      api.search(q).then((h) => alive && setHits(h), () => alive && setHits([]));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, q, open]);

  const run = (f: () => void) => {
    onOpenChange(false);
    setQ("");
    f();
  };
  const item = "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[0.9375rem] text-text data-[selected=true]:bg-surface-2";
  const group = "px-2 pb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-soft";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("console.palette.label")}
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-[var(--c-scrim)]"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-lift"
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <MagnifyingGlass size={18} className="text-soft" aria-hidden="true" />
        <Command.Input
          value={q}
          onValueChange={setQ}
          placeholder={t("console.palette.placeholder")}
          className="min-h-14 flex-1 bg-transparent text-[0.9375rem] text-text outline-none placeholder:text-soft"
        />
      </div>
      <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto py-2">
        <Command.Empty className="px-5 py-6 text-sm text-soft">{t("console.palette.empty")}</Command.Empty>
        {hits.length > 0 && (
          <Command.Group heading={t("console.palette.results")} className={group}>
            {hits.map((h) => (
              <Command.Item
                key={`${h.kind}:${h.label}:${h.hint}`}
                value={`${h.kind}:${h.label}:${h.hint}`}
                className={item}
                onSelect={() => run(() => (h.target && h.client ? onTarget(h.target, h.client) : onFilter("all")))}
              >
                {h.kind === "client" ? <Buildings size={18} className="text-soft" aria-hidden="true" /> : <ArrowRight size={18} className="text-soft" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{h.label}</span>
                <span className="shrink-0 text-[0.8125rem] text-soft">{h.hint}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading={t("console.palette.goto")} className={group}>
          <Command.Item value="absence" className={item} onSelect={() => run(onAway)}>
            <ListChecks size={18} className="text-soft" aria-hidden="true" />
            {t("console.palette.away")}
          </Command.Item>
          <Command.Item value="valider" className={item} onSelect={() => run(() => onFilter("approval"))}>
            <ArrowRight size={18} className="text-soft" aria-hidden="true" />
            {t("console.palette.approvals")}
          </Command.Item>
          <Command.Item value="incidents" className={item} onSelect={() => run(() => onFilter("incident"))}>
            <ArrowRight size={18} className="text-soft" aria-hidden="true" />
            {t("console.palette.incidents")}
          </Command.Item>
        </Command.Group>
        <Command.Group heading={t("console.palette.display")} className={group}>
          <Command.Item value="theme" className={item} onSelect={() => run(toggle)}>
            {theme === "dark" ? <Sun size={18} className="text-soft" aria-hidden="true" /> : <Moon size={18} className="text-soft" aria-hidden="true" />}
            {theme === "dark" ? t("common.theme.light") : t("common.theme.dark")}
          </Command.Item>
          <Command.Item value="densite" className={item} onSelect={() => run(onDensity)}>
            <Rows size={18} className="text-soft" aria-hidden="true" />
            {density === "compact" ? t("console.density.comfortable") : t("console.density.compact")}
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
