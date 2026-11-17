// Éléments communs de la console : nature d'un élément de la file (libellé + icône, jamais la couleur seule), heures et délais.
import { ArrowBendUpRight, CalendarCheck, Clock, Lightning, ShieldCheck, Timer } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../ui/Badge.tsx";
import type { QueueItem, QueueKind } from "../lib/api/console-types.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";

export const KIND_ICON: Record<QueueKind, (p: { size?: number; className?: string }) => ReactNode> = {
  incident: (p) => <Lightning weight="fill" aria-hidden="true" {...p} />,
  approval: (p) => <ShieldCheck weight="duotone" aria-hidden="true" {...p} />,
  escalation: (p) => <ArrowBendUpRight weight="bold" aria-hidden="true" {...p} />,
  sla: (p) => <Timer weight="bold" aria-hidden="true" {...p} />,
  waiting: (p) => <Clock weight="bold" aria-hidden="true" {...p} />,
  prevention: (p) => <CalendarCheck weight="duotone" aria-hidden="true" {...p} />,
};

const KIND_TONE: Record<QueueKind, BadgeTone> = {
  incident: "solid-danger",
  approval: "relief",
  escalation: "neutral",
  sla: "danger",
  waiting: "neutral",
  prevention: "outline",
};

/** Minutes avant une échéance (négatif : dépassée). */
export function minutesUntil(iso: string, now = Date.now()): number {
  return Math.round((new Date(iso).getTime() - now) / 60_000);
}

export function useDuration() {
  const t = useT();
  return (minutes: number): string => {
    const m = Math.abs(minutes);
    if (m < 60) return t("console.duration.min", { n: m });
    const h = Math.floor(m / 60);
    return m % 60 === 0 || h >= 10 ? t("console.duration.h", { n: h }) : t("console.duration.hmin", { h, m: m % 60 });
  };
}

export function KindBadge({ item }: { item: Pick<QueueItem, "kind" | "slaDueAt"> }) {
  const t = useT();
  const duration = useDuration();
  const Icon = KIND_ICON[item.kind];
  let label = t(`console.kind.${item.kind}` as MessageKey);
  if (item.kind === "sla" && item.slaDueAt) {
    const m = minutesUntil(item.slaDueAt);
    label = m >= 0 ? t("console.kind.slaIn", { duree: duration(m) }) : t("console.kind.slaLate", { duree: duration(m) });
  }
  return (
    <Badge tone={KIND_TONE[item.kind]} icon={<Icon size={14} />}>
      {label}
    </Badge>
  );
}

/** « 07:41 » aujourd'hui, « il y a 12 min » dans l'heure. Chiffres tabulaires. */
export function Since({ iso, className }: { iso: string; className?: string }) {
  const t = useT();
  const [lang] = useLang();
  const m = -minutesUntil(iso);
  const text = m < 1 ? t("common.justNow") : m < 60 ? t("common.minutesAgo", { n: m }) : hourLabel(iso, lang);
  return (
    <time dateTime={iso} className={["num", className].filter(Boolean).join(" ")}>
      {text}
    </time>
  );
}

export function Ref({ children }: { children: ReactNode }) {
  return <span className="shrink-0 whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-soft">{children}</span>;
}
