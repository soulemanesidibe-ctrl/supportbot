// Une action préparée par Relève, à valider ou refuser (niveau 1). Règles non négociables, rappelées à l'écran :
//  - l'identité du salarié est vérifiée PAR UN AUTRE MOYEN avant de valider (rappel, manager, en personne) ; la conversation seule
//    n'authentifie jamais une action sur un compte ;
//  - l'action s'exécute avec l'identité Microsoft du technicien qui valide (fenêtre Microsoft), jamais avec des droits de l'IA ;
//  - ce qui est validé est exactement ce qui est affiché (empreinte des paramètres vérifiée par le serveur).
import { CheckCircle, MicrosoftOutlookLogo, ShieldWarning, XCircle } from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import type { ApprovalDetail, ConsoleApi, ConsoleContext, IdentityMethod, RejectReason } from "../lib/api/console-types.ts";
import { CAPABILITY_TITLE } from "../lib/api/console-titles.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";
import { PaneSkeleton } from "./ConversationPane.tsx";
import { minutesUntil, useDuration } from "./parts.tsx";

const METHODS: readonly IdentityMethod[] = ["callback", "manager_confirmation", "in_person"];
const REASONS: readonly RejectReason[] = ["identite_non_confirmee", "mauvaise_cible", "mauvais_perimetre", "autre"];

export function ApprovalPane({
  api,
  ctx,
  clientId,
  id,
  onDone,
}: {
  api: ConsoleApi;
  ctx: ConsoleContext;
  clientId: string;
  id: string;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [lang] = useLang();
  const duration = useDuration();
  const name = useId();
  const [a, setA] = useState<ApprovalDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [method, setMethod] = useState<IdentityMethod | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>("identite_non_confirmee");
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.approval(clientId, id).then((x) => alive && setA(x), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api, clientId, id]);

  if (failed) return <p role="alert" className="p-6 text-text">{t("console.approval.gone")}</p>;
  if (!a) return <PaneSkeleton />;

  const acting = ctx.actingFor.find((d) => d.clientId === clientId);
  const title = CAPABILITY_TITLE[a.capability]?.(a.target) ?? a.capability;
  const expiresIn = minutesUntil(a.expiresAt);

  const approve = async () => {
    if (!method) return;
    setBusy("approve");
    setError(null);
    try {
      const r = await api.approve(clientId, a, method, acting?.delegationId);
      onDone(r.outcome === "succeeded" ? t("console.approval.done", { action: title }) : t("console.approval.sent", { action: title }));
    } catch {
      setError(t("console.approval.failed"));
    } finally {
      setBusy(null);
    }
  };
  const reject = async () => {
    setBusy("reject");
    setError(null);
    try {
      await api.reject(clientId, a.id, reason);
      onDone(t("console.approval.rejected", { action: title }));
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article aria-labelledby="action-titre" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-soft">
          <span className="font-medium text-text">{a.client.name}</span>
          <Badge tone="relief">{t("console.kind.approval")}</Badge>
          <span className="num">{t("console.approval.requested", { heure: hourLabel(a.requestedAt, lang) })}</span>
          <span className="num">{t("console.approval.expires", { duree: duration(expiresIn) })}</span>
        </div>
        <h2 id="action-titre" className="text-xl font-semibold leading-tight tracking-[-0.02em] text-text">{title}</h2>
        <p className="font-mono text-[0.8125rem] text-soft">{a.target}</p>
      </header>

      <div className="flex flex-col gap-6 px-5 py-5 sm:px-6">
        <section aria-labelledby="action-contexte" className="flex flex-col gap-2">
          <h3 id="action-contexte" className="text-sm font-semibold text-text">{t("console.approval.context")}</h3>
          <ul className="flex flex-col gap-1.5">
            {a.context.map((c) => (
              <li key={c} className="flex gap-2 text-[0.9375rem] text-text">
                <CheckCircle size={18} className="mt-0.5 shrink-0 text-signal" aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        </section>

        {a.riskFlags.length > 0 && (
          <section aria-labelledby="action-signaux" className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-danger-soft p-4">
            <h3 id="action-signaux" className="flex items-center gap-2 text-sm font-semibold text-danger-ink">
              <ShieldWarning size={18} weight="fill" aria-hidden="true" />
              {t("console.approval.flags")}
            </h3>
            <ul className="flex flex-col gap-1 text-[0.9375rem] text-text">
              {a.riskFlags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </section>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-text">{t("console.approval.identity")}</legend>
          <p className="mb-1 text-[0.8125rem] text-soft">{t("console.approval.identityHint")}</p>
          {METHODS.map((m) => (
            <label
              key={m}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-border px-3.5 text-[0.9375rem] text-text transition-colors duration-150",
                "hover:bg-surface-2 has-[:checked]:border-signal has-[:checked]:bg-signal-soft",
              )}
            >
              <input type="radio" name={name} value={m} checked={method === m} onChange={() => setMethod(m)} className="size-4 accent-[var(--c-signal)]" />
              {t(`console.identity.${m}` as MessageKey)}
            </label>
          ))}
        </fieldset>

        {acting && (
          <p className="rounded-[var(--radius-control)] bg-relief-soft px-3.5 py-2.5 text-sm text-text">
            {t("console.approval.acting", { qui: acting.forName })}
          </p>
        )}

        <p className="flex gap-2 text-[0.8125rem] leading-relaxed text-soft">
          <MicrosoftOutlookLogo size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("console.approval.microsoft")}
        </p>

        {error && <p role="alert" className="text-sm font-medium text-danger-ink">{error}</p>}

        {rejecting ? (
          <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-4">
            <label htmlFor="motif-refus" className="text-sm font-semibold text-text">{t("console.approval.reason")}</label>
            <select
              id="motif-refus"
              value={reason}
              onChange={(e) => setReason(e.target.value as RejectReason)}
              className="min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[0.9375rem] text-text"
            >
              {REASONS.map((r) => <option key={r} value={r}>{t(`console.reject.${r}` as MessageKey)}</option>)}
            </select>
            <div className="flex gap-2">
              <Button variant="danger" busy={busy === "reject"} onClick={() => void reject()}>
                <XCircle size={18} aria-hidden="true" />
                {t("console.approval.confirmReject")}
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>{t("common.cancel")}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" busy={busy === "approve"} disabled={!method || expiresIn <= 0} onClick={() => void approve()}>
              <CheckCircle size={20} aria-hidden="true" />
              {t("console.approval.approve")}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setRejecting(true)}>
              {t("console.approval.reject")}
            </Button>
          </div>
        )}
        {!method && !rejecting && <p className="text-[0.8125rem] text-soft">{t("console.approval.chooseFirst")}</p>}
      </div>
    </article>
  );
}
