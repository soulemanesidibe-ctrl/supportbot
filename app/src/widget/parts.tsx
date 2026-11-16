// Éléments du widget salarié : en-tête, bandeaux de relève et d'incident, badges d'état, bulles de messages.
import { Info, Lightning, ShieldCheck, UserCircle } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../ui/Badge.tsx";
import { cn } from "../ui/cn.ts";
import { Logo } from "../ui/Logo.tsx";
import { Tooltip } from "../ui/Overlay.tsx";
import { SignalLine } from "../ui/SignalLine.tsx";
import type { ChatMessage, OngoingIncident, RequestStatus, WidgetContext } from "../lib/api/types.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";

export const STATUS_TONE: Record<RequestStatus, BadgeTone> = {
  open: "neutral",
  waiting_user: "signal",
  waiting_technician: "neutral",
  pending_approval: "relief",
  resolved: "signal",
  closed: "outline",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}` as MessageKey)}</Badge>;
}

/** « Assistant IA » : visible en permanence (AI Act, art. 50) ; l'info-bulle dit ce que cela implique. */
export function AiBadge() {
  const t = useT();
  return (
    <Tooltip label={t("common.ai.explain")}>
      <button type="button" className="rounded-md">
        <Badge tone="outline" className="cursor-help">
          {t("common.ai")}
        </Badge>
        <span className="sr-only">{t("common.ai.explain")}</span>
      </button>
    </Tooltip>
  );
}

export function WidgetHeader({ ctx, right }: { ctx: WidgetContext | null; right?: ReactNode }) {
  const t = useT();
  const [lang] = useLang();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
        <Logo size="sm" />
        {ctx && (
          <span className="hidden truncate border-l border-border pl-3 text-sm text-soft sm:inline">{t("widget.supportOf", { org: ctx.orgName })}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {ctx?.relief.active && ctx.relief.until && (
            <Tooltip label={t("common.relief.explain", { heure: hourLabel(ctx.relief.until, lang) })}>
              <button type="button" className="rounded-md">
                <Badge tone="solid-relief" className="cursor-help">
                  {t("common.relief")}
                </Badge>
              </button>
            </Tooltip>
          )}
          <AiBadge />
          {right}
        </div>
      </div>
    </header>
  );
}

/** L'équipe est absente : on dit à quoi s'attendre, avec l'heure de retour d'un humain. */
export function ReliefPanel({ until }: { until: string }) {
  const t = useT();
  const [lang] = useLang();
  return (
    <section aria-labelledby="releve-titre" className="flex gap-3 rounded-[var(--radius-card)] bg-relief-soft p-4 text-text">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-relief text-on-relief" aria-hidden="true">
        <SignalLine state="settled" className="h-4 w-5 text-on-relief" />
      </span>
      <div className="flex flex-col gap-0.5">
        <h2 id="releve-titre" className="text-[0.9375rem] font-semibold">
          {t("widget.relief.title")}
        </h2>
        <p className="text-sm text-text/80">{t("widget.relief.body", { heure: hourLabel(until, lang) })}</p>
      </div>
    </section>
  );
}

export function IncidentBanner({ incident }: { incident: OngoingIncident }) {
  const t = useT();
  const [lang] = useLang();
  const service = t(`category.${incident.category}` as MessageKey);
  return (
    <section role="status" className="flex gap-3 rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft p-4">
      <Lightning size={22} weight="fill" className="mt-0.5 shrink-0 text-danger-ink" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[0.9375rem] font-semibold text-text">{t("widget.incident.title", { service })}</h2>
        <p className="text-sm text-text/80">{t("widget.incident.body", { service, heure: hourLabel(incident.since, lang) })}</p>
      </div>
    </section>
  );
}

/** Une bulle du fil. Chaque auteur se reconnaît sans la couleur : libellé, alignement et icône. */
export function MessageBubble({ m }: { m: ChatMessage }) {
  const t = useT();
  const [lang] = useLang();
  const reduce = useReducedMotion();
  const time = hourLabel(m.at, lang);
  const enter = reduce ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const } };

  if (m.role === "user") {
    return (
      <motion.li {...enter} className="flex justify-end pl-10 sm:pl-24">
        <div className="flex max-w-full flex-col items-end gap-1">
          <p className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-text px-4 py-2.5 text-[0.9375rem] leading-relaxed text-bg">
            <span className="sr-only">{t("chat.you")} : </span>
            {m.content}
          </p>
          <span className="text-xs text-soft">{time}</span>
        </div>
      </motion.li>
    );
  }

  if (m.role === "notice") {
    return (
      <motion.li {...enter} className="flex gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
        <Info size={18} className="mt-0.5 shrink-0 text-soft" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-soft">{t("chat.notice")}</span>
          <p className="text-[0.9375rem] leading-relaxed text-text">{m.content}</p>
        </div>
      </motion.li>
    );
  }

  const human = m.role === "technician";
  return (
    <motion.li {...enter} className="flex gap-3 pr-6 sm:pr-20">
      <span
        className={cn(
          "mt-6 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
          human ? "bg-surface-3 text-text" : "bg-text text-bg",
        )}
        aria-hidden="true"
      >
        {human ? <UserCircle size={20} weight="fill" /> : <SignalLine state="settled" className="h-3.5 w-4 text-bg" />}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2 text-xs font-medium text-soft">
          {human ? t("chat.technician", { nom: m.authorName ?? "" }) : `${t("chat.assistant")} · ${t("common.ai")}`}
          <span className="font-normal">{time}</span>
        </span>
        <p
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl rounded-tl-md px-4 py-2.5 text-[0.9375rem] leading-relaxed text-text",
            human ? "border border-border bg-surface" : "bg-surface-2",
          )}
        >
          {m.content}
        </p>
      </div>
    </motion.li>
  );
}

/** Relève prépare une réponse : la ligne de signal se trace. Annoncé une fois aux lecteurs d'écran. */
export function TypingRow() {
  const t = useT();
  return (
    <li className="flex items-center gap-3" aria-live="polite">
      <span className="inline-flex size-8 items-center justify-center rounded-full bg-text text-bg" aria-hidden="true">
        <SignalLine state="working" className="h-3.5 w-4 text-bg" />
      </span>
      <span className="text-sm text-soft">{t("chat.typing")}</span>
    </li>
  );
}

/** État d'une demande d'action sur le compte. Le message automatique explique déjà la vérification d'identité. */
export function AccountActionCard() {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <ShieldCheck size={22} weight="duotone" className="shrink-0 text-signal" aria-hidden="true" />
      <h3 className="flex-1 text-[0.9375rem] font-semibold text-text">{t("chat.account.title")}</h3>
      <Badge tone="relief">{t("chat.account.state")}</Badge>
    </li>
  );
}
