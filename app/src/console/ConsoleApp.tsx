// Console du technicien (thème sombre par défaut) : « Quoi faire maintenant ? » (docs/10 § 5.3). File unifiée à gauche, élément
// ouvert à droite ; sans élément ouvert, la passation « Pendant votre absence ». Sur téléphone, une colonne à la fois.
import { ArrowLeft, MagnifyingGlass, Moon, SignOut, Sun } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Kbd } from "../ui/Kbd.tsx";
import { Logo } from "../ui/Logo.tsx";
import { Tooltip } from "../ui/Overlay.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { consoleApi } from "../lib/api/index.tsx";
import type { ClientRef, ConsoleApi, ConsoleContext, QueueItem, StaffAuthApi } from "../lib/api/console-types.ts";
import { useLang, useT } from "../lib/i18n/index.tsx";
import { readPref, writePref } from "../lib/prefs.ts";
import { useTheme } from "../lib/theme.tsx";
import { hourLabel } from "../lib/time.ts";
import { ApprovalPane } from "./ApprovalPane.tsx";
import { AwayBriefing } from "./AwayBriefing.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { ConversationPane } from "./ConversationPane.tsx";
import { IncidentPane } from "./IncidentPane.tsx";
import { Queue, type QueueFilter } from "./Queue.tsx";
import { StaffSignIn } from "./StaffSignIn.tsx";

type Api = ConsoleApi & StaffAuthApi;
type Open = { key: string; target: QueueItem["target"]; client: ClientRef } | null;
const REFRESH_MS = 30_000;

export default function ConsoleApp() {
  const t = useT();
  const [api, setApi] = useState<Api | null>(null);
  const [auth, setAuth] = useState<"checking" | "out" | "in">("checking");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    consoleApi().then(
      async (a) => {
        if (!alive) return;
        setApi(a);
        const ok = await a.resume().catch(() => false);
        if (alive) setAuth(ok ? "in" : "out");
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-5">
        <p role="alert" className="text-text">{t("console.unavailable")}</p>
      </main>
    );
  }
  if (!api || auth === "checking") return <div role="status" className="min-h-dvh bg-bg"><span className="sr-only">{t("common.loading")}</span></div>;
  if (auth === "out") return <StaffSignIn api={api} onSignedIn={() => setAuth("in")} />;
  return <Shell api={api} onSignedOut={() => setAuth("out")} />;
}

function Shell({ api, onSignedOut }: { api: Api; onSignedOut: () => void }) {
  const t = useT();
  const [lang] = useLang();
  const { theme, toggle } = useTheme();
  const [ctx, setCtx] = useState<ConsoleContext | null>(null);
  const [items, setItems] = useState<readonly QueueItem[] | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [open, setOpen] = useState<Open>(null);
  // Sur téléphone, une colonne à la fois : la passation s'ouvre comme un élément.
  const [away, setAway] = useState(false);
  const [palette, setPalette] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [density, setDensity] = useState<"comfortable" | "compact">(() => (readPref("density") === "compact" ? "compact" : "comfortable"));
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await api.queue());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const c = await api.context();
        if (!alive) return;
        setCtx(c);
        const q = await api.queue();
        if (alive) setItems(q);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const openTarget = (target: QueueItem["target"], client: ClientRef, key = `${target.type}:${target.id}`) => {
    setAway(false);
    setOpen({ key, target, client });
  };
  const detailShown = open !== null || away;
  const done = (message: string) => {
    setToast(message);
    setOpen(null);
    void refresh();
  };
  const signOut = async () => {
    await api.signOut().catch(() => {});
    onSignedOut();
  };
  const switchDensity = () =>
    setDensity((d) => {
      const next = d === "compact" ? "comfortable" : "compact";
      writePref("density", next);
      return next;
    });

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
        <Logo size="sm" />
        <span className="hidden border-l border-border pl-3 text-sm text-soft sm:inline">{t("console.title")}</span>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="ml-2 hidden min-h-10 w-72 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-bg px-3 text-sm text-soft transition-colors duration-150 hover:border-border-strong hover:text-text md:inline-flex"
        >
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span className="flex-1 text-left">{t("console.search")}</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {ctx?.me.onCallUntil && (
            <Badge tone="signal" className="hidden sm:inline-flex">{t("console.onCall", { heure: hourLabel(ctx.me.onCallUntil, lang) })}</Badge>
          )}
          {ctx?.synthetic && <Badge tone="outline">{t("common.synthetic")}</Badge>}
          <Button variant="quiet" size="icon" className="md:hidden" aria-label={t("console.search")} onClick={() => setPalette(true)}>
            <MagnifyingGlass size={20} aria-hidden="true" />
          </Button>
          <Tooltip label={t("common.theme.toggle")}>
            <Button variant="quiet" size="icon" aria-label={t("common.theme.toggle")} onClick={toggle}>
              {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
            </Button>
          </Tooltip>
          <Tooltip label={t("common.signOut")}>
            <Button variant="quiet" size="icon" aria-label={t("common.signOut")} onClick={() => void signOut()}>
              <SignOut size={20} aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(22rem,27rem)_1fr]">
        <aside className={cn("min-h-0 flex-col border-border lg:flex lg:border-r", detailShown ? "hidden" : "flex")}>
          <div className="border-b border-border px-2 py-1 lg:hidden">
            <Button variant="quiet" size="sm" onClick={() => setAway(true)}>
              {t("console.palette.away")}
            </Button>
          </div>
          {failed && !items ? (
            <div className="flex flex-col items-start gap-3 p-5">
              <p role="alert" className="text-text">{t("common.error")}</p>
              <Button size="sm" onClick={() => void refresh()}>{t("common.retry")}</Button>
            </div>
          ) : (
            <Queue items={items} filter={filter} onFilter={setFilter} selected={open?.key ?? null} onOpen={(i) => openTarget(i.target, i.client, i.key)} density={density} />
          )}
        </aside>

        <main className={cn("min-h-0 flex-col bg-surface lg:flex", detailShown ? "flex" : "hidden")} aria-label={t("console.detail")}>
          {detailShown && (
            <div className="border-b border-border px-2 py-1 lg:hidden">
              <Button variant="quiet" size="sm" onClick={() => { setOpen(null); setAway(false); }}>
                <ArrowLeft size={18} aria-hidden="true" />
                {t("console.backToQueue")}
              </Button>
            </div>
          )}
          {!ctx ? (
            <div className="flex flex-col gap-4 p-8"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-40 w-full" /></div>
          ) : !open ? (
            <div className="min-h-0 flex-1 overflow-y-auto"><AwayBriefing api={api} ctx={ctx} onOpen={(target, client) => openTarget(target, client)} /></div>
          ) : open.target.type === "conversation" ? (
            <ConversationPane key={open.key} api={api} clientId={open.client.id} id={open.target.id} onChanged={() => void refresh()} />
          ) : open.target.type === "approval" ? (
            <ApprovalPane key={open.key} api={api} ctx={ctx} clientId={open.client.id} id={open.target.id} onDone={done} />
          ) : (
            <IncidentPane key={open.key} api={api} clientId={open.client.id} id={open.target.id} />
          )}
        </main>
      </div>

      <CommandPalette
        api={api}
        open={palette}
        onOpenChange={setPalette}
        onTarget={(target, client) => openTarget(target, client)}
        onFilter={(f) => {
          setFilter(f);
          setOpen(null);
          setAway(false);
        }}
        onAway={() => {
          setOpen(null);
          setAway(true);
        }}
        density={density}
        onDensity={switchDensity}
      />

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-30 max-w-sm rounded-[var(--radius-card)] border border-border bg-surface-2 px-4 py-3 text-sm text-text shadow-lift">
          {toast}
        </div>
      )}
    </div>
  );
}
