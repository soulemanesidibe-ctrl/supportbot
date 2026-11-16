// Accueil du salarié : à quoi s'attendre (relève, incident en cours), puis ses demandes, puis les deux gestes possibles :
// décrire un nouveau problème ou parler à un technicien.
import { CaretRight, ChatCircleDots, Headset } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "../ui/Button.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import type { RequestSummary, WidgetContext } from "../lib/api/types.ts";
import { useLang, useT } from "../lib/i18n/index.tsx";
import { relativeLabel } from "../lib/time.ts";
import { Composer } from "./Composer.tsx";
import { IncidentBanner, ReliefPanel, StatusBadge } from "./parts.tsx";

export function Home({
  ctx,
  requests,
  onOpen,
  onStart,
  onTalk,
}: {
  ctx: WidgetContext;
  requests: readonly RequestSummary[] | null;
  onOpen: (id: string) => void;
  /** Le premier message d'une nouvelle demande, écrit directement depuis l'accueil. */
  onStart: (text: string) => void;
  onTalk: () => void;
}) {
  const t = useT();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-6 px-4 pb-28 pt-8 sm:px-6 sm:pb-12">
        <h1 className="text-[1.875rem] font-semibold leading-tight tracking-[-0.03em] text-text">
          {t("widget.home.greeting", { prenom: ctx.user.firstName })}
        </h1>

        <section aria-labelledby="nouvelle-demande" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="nouvelle-demande" className="text-lg font-semibold tracking-[-0.02em] text-text">
              {t("widget.home.ask")}
            </h2>
            <Button variant="secondary" size="sm" onClick={onTalk} className="hidden sm:inline-flex">
              <Headset size={18} aria-hidden="true" />
              {t("common.talkToTech")}
            </Button>
          </div>
          <Composer id="releve-nouvelle" labelledBy="nouvelle-demande" placeholder={t("widget.home.askPlaceholder")} onSend={onStart} />
        </section>

        {(ctx.relief.active && ctx.relief.until) || ctx.incidents.length > 0 ? (
          <div className="flex flex-col gap-3">
            {ctx.incidents.map((i) => (
              <IncidentBanner key={i.id} incident={i} />
            ))}
            {ctx.relief.active && ctx.relief.until && <ReliefPanel until={ctx.relief.until} />}
          </div>
        ) : null}

        <section aria-labelledby="mes-demandes" className="flex flex-col gap-3">
          <h2 id="mes-demandes" className="text-lg font-semibold tracking-[-0.02em] text-text">
            {t("widget.home.title")}
          </h2>
          {requests === null ? (
            <RequestsSkeleton />
          ) : requests.length === 0 ? (
            <EmptyRequests />
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              {requests.map((r, i) => (
                <li key={r.id} className={i > 0 ? "border-t border-border" : undefined}>
                  <RequestRow r={r} onOpen={() => onOpen(r.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Sur téléphone, « Parler à un technicien » reste sous le pouce. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
        <div className="px-4 py-3">
          <Button variant="secondary" size="lg" onClick={onTalk} className="w-full justify-center">
            <Headset size={18} aria-hidden="true" />
            {t("common.talkToTech")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RequestRow({ r, onOpen }: { r: RequestSummary; onOpen: () => void }) {
  const t = useT();
  const [lang] = useLang();
  const rel = relativeLabel(r.updatedAt, lang);
  const when = rel.key === "justNow" ? t("common.justNow") : rel.key === "minutesAgo" ? t("common.minutesAgo", { n: rel.n ?? 0 }) : rel.text;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:bg-surface-2 sm:px-5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-medium text-text">{r.title}</span>
          <StatusBadge status={r.status} />
        </div>
        <p className="line-clamp-1 text-sm text-soft">{r.lastLine}</p>
      </div>
      <span className="shrink-0 text-[0.8125rem] text-soft">{when}</span>
      <CaretRight size={16} className="shrink-0 text-soft transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
    </button>
  );
}

function RequestsSkeleton() {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <span className="sr-only">{t("common.loading")}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 px-5 py-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}

function EmptyRequests(): ReactNode {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-2 rounded-[var(--radius-card)] border border-dashed border-border-strong p-6">
      <ChatCircleDots size={28} className="text-soft" aria-hidden="true" />
      <h3 className="font-semibold text-text">{t("widget.home.empty.title")}</h3>
      <p className="max-w-prose text-sm leading-relaxed text-soft">{t("widget.home.empty.body")}</p>
    </div>
  );
}
