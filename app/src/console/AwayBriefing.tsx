// « Pendant votre absence » : la passation de garde à la manière d'un briefing (docs/08 § 3). Des phrases avec leur nombre, pas
// un mur de compteurs : ce qui a été résolu, ce qui attend, ce qui a été escaladé, ce qu'il faut surveiller.
import { ArrowRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { SignalLine } from "../ui/SignalLine.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import type { AwaySummary, ClientRef, ConsoleApi, ConsoleContext, QueueItem } from "../lib/api/console-types.ts";
import { useLang, useT } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";

export function AwayBriefing({ api, ctx, onOpen }: { api: ConsoleApi; ctx: ConsoleContext; onOpen: (target: QueueItem["target"], client: ClientRef) => void }) {
  const t = useT();
  const [lang] = useLang();
  const [s, setS] = useState<AwaySummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.away().then((x) => alive && setS(x), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api]);

  return (
    <section aria-labelledby="absence-titre" className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <SignalLine state="settled" className="h-5 w-8 text-signal" />
        <h2 id="absence-titre" className="text-2xl font-semibold tracking-[-0.025em] text-text">
          {t("console.away.title", { prenom: ctx.me.firstName })}
        </h2>
        {s && <p className="text-[0.9375rem] text-soft">{t("console.away.since", { heure: hourLabel(s.since, lang) })}</p>}
      </div>
      {failed ? (
        <p role="alert" className="text-text">{t("common.error")}</p>
      ) : !s ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">{t("common.loading")}</span>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-3/4" />)}
        </div>
      ) : (
        <>
          <dl className="flex flex-col divide-y divide-border border-y border-border">
            {(
              [
                ["resolvedByReleve", s.resolvedByReleve],
                ["resolvedByTeam", s.resolvedByTeam],
                ["toApprove", s.toApprove],
                ["escalated", s.escalated],
              ] as const
            ).map(([k, n]) => (
              <div key={k} className="flex items-baseline gap-4 py-3">
                <dt className="sr-only">{t(`console.away.${k}`)}</dt>
                <dd className="num w-12 shrink-0 text-right text-2xl font-semibold tracking-[-0.02em] text-text">{n}</dd>
                <dd className="text-[0.9375rem] text-text">{t(`console.away.${k}`)}</dd>
              </div>
            ))}
          </dl>
          {s.watch.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-text">{t("console.away.watch")}</h3>
              <ul className="flex flex-col gap-1">
                {s.watch.map((w) => (
                  <li key={`${w.target.type}:${w.target.id}`}>
                    <button
                      type="button"
                      onClick={() => onOpen(w.target, w.client)}
                      className="group flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left hover:bg-surface"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[0.9375rem] font-medium text-text">{w.title}</span>
                        <span className="text-[0.8125rem] text-soft">{w.client.name}</span>
                      </span>
                      <ArrowRight size={18} className="text-soft transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[0.8125rem] text-soft">{t("console.away.hint")}</p>
        </>
      )}
    </section>
  );
}
