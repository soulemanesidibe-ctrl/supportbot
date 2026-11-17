// Vue incident : alertes de supervision et demandes des salariés sur une même ligne de temps (docs/08 § 3). Le texte d'une alerte
// est une DONNÉE (affiché tel quel, échappé par React), jamais une instruction.
import { Bell, ChatCircleText, CheckCircle, Lightning, PaperPlaneRight } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "../ui/Badge.tsx";
import type { ConsoleApi, IncidentDetail, TimelineEntry } from "../lib/api/console-types.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";
import { PaneSkeleton } from "./ConversationPane.tsx";
import { Since } from "./parts.tsx";

const ENTRY_ICON: Record<TimelineEntry["kind"], ReactNode> = {
  alert: <Bell size={16} weight="fill" aria-hidden="true" />,
  request: <ChatCircleText size={16} weight="fill" aria-hidden="true" />,
  notice: <PaperPlaneRight size={16} weight="fill" aria-hidden="true" />,
  action: <Lightning size={16} weight="fill" aria-hidden="true" />,
  resolution: <CheckCircle size={16} weight="fill" aria-hidden="true" />,
};

export function IncidentPane({ api, clientId, id }: { api: ConsoleApi; clientId: string; id: string }) {
  const t = useT();
  const [lang] = useLang();
  const [inc, setInc] = useState<IncidentDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.incident(clientId, id).then((x) => alive && setInc(x), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api, clientId, id]);

  if (failed) return <p role="alert" className="p-6 text-text">{t("common.error")}</p>;
  if (!inc) return <PaneSkeleton />;
  const grave = inc.severity === "major" || inc.severity === "critical";

  return (
    <article aria-labelledby="incident-titre" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-soft">
          <span className="font-medium text-text">{inc.client.name}</span>
          <Badge tone={grave ? "solid-danger" : "danger"} icon={<Lightning size={14} weight="fill" aria-hidden="true" />}>
            {t(`console.severity.${inc.severity}` as MessageKey)}
          </Badge>
          <span>{t(`console.incidentState.${inc.state}` as MessageKey)}</span>
        </div>
        <h2 id="incident-titre" className="text-xl font-semibold leading-tight tracking-[-0.02em] text-text">{inc.title}</h2>
        <p className="text-sm text-soft">
          {t("console.incident.since", { heure: hourLabel(inc.openedAt, lang) })} · <Since iso={inc.openedAt} />
          {" · "}
          <span className="num">{t("console.incident.requests", { n: inc.requests })}</span>
        </p>
      </header>
      <section aria-labelledby="incident-chrono" className="flex flex-col gap-3 px-5 py-5 sm:px-6">
        <h3 id="incident-chrono" className="text-sm font-semibold text-text">{t("console.incident.timeline")}</h3>
        {inc.timeline.length === 0 ? (
          <p className="text-sm text-soft">{t("console.incident.noTimeline")}</p>
        ) : (
          <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[4.6rem] before:top-2 before:w-px before:bg-border">
            {inc.timeline.map((e) => (
              <li key={`${e.at}-${e.text}`} className="relative grid grid-cols-[4rem_1.25rem_1fr] items-start gap-x-2">
                <time dateTime={e.at} className="num pt-0.5 text-right font-mono text-[0.8125rem] text-soft">{hourLabel(e.at, lang)}</time>
                <span className="relative z-10 mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-bg text-soft">{ENTRY_ICON[e.kind]}</span>
                <p className="text-[0.9375rem] leading-snug text-text">
                  <span className="sr-only">{t(`console.timeline.${e.kind}` as MessageKey)} : </span>
                  {e.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
