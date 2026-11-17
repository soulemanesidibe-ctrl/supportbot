// Écran de l'administrateur du client (docs/10 § 5.4 : « Mon support tient-il, et qui a accès à quoi ? »). État du support et
// qualité de Relève ; tout ce qui ouvre un accès à son organisation, révocable d'ici ; connecteurs ; niveaux d'autonomie (niveau 2 :
// n'existe pas) ; arrêt d'urgence. Les opérations passent par la fonction « admin » (rôle, journal, second facteur récent quand il
// faut l'élargir) ; restreindre (révoquer, geler, revenir au niveau 0) ne demande jamais de nouvelle vérification : l'urgence prime.
import { CheckCircle, LinkBreak, Plugs, ShieldSlash, Snowflake, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Dialog } from "../ui/Overlay.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import type { AccessOverview, AdminContext, AdminOp, DashboardApi, OrgSummary } from "../lib/api/dashboard-types.ts";
import { useLang, useT, type MessageKey } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";
import { QualityPanel } from "./QualityPanel.tsx";
import { StaffShell, TopBar, useSensitive } from "./StaffShell.tsx";
import { SupportSummary } from "./SupportSummary.tsx";

export default function AdminApp() {
  const t = useT();
  return <StaffShell title={t("dash.admin.title")} signIn={{ title: t("dash.admin.signin.title"), lede: t("dash.admin.signin.lede"), verify: t("dash.admin.signin.verify") }}>{(api, signOut) => <Admin api={api} onSignOut={signOut} />}</StaffShell>;
}

type Confirm = { title: string; body: string; action: string; op: AdminOp; done: string; tone?: "danger" | "primary" } | null;

function Admin({ api, onSignOut }: { api: DashboardApi; onSignOut: () => void }) {
  const t = useT();
  const [lang] = useLang();
  const [ctx, setCtx] = useState<AdminContext | null | undefined>(undefined);
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [access, setAccess] = useState<AccessOverview | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { run, dialog } = useSensitive(api);

  const reload = useCallback(async (c: AdminContext) => {
    const [s, a] = await Promise.all([api.orgSummary(c.orgId, 30), api.access(c.orgId)]);
    setSummary(s);
    setAccess(a);
  }, [api]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const c = await api.admin();
        if (!alive) return;
        setCtx(c);
        if (c) {
          const [s, a] = await Promise.all([api.orgSummary(c.orgId, 30), api.access(c.orgId)]);
          if (alive) {
            setSummary(s);
            setAccess(a);
          }
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api]);

  const act = async (op: AdminOp, done: string) => {
    if (!ctx) return;
    setBusy(true);
    setNote(null);
    try {
      // Si le serveur exige un second facteur récent, useSensitive ouvre la vérification puis rejoue l'opération.
      await run(async () => {
        await api.adminOp(ctx.orgId, op);
        if (op.op === "org.freeze" || op.op === "org.unfreeze") setCtx({ ...ctx, frozen: op.op === "org.freeze" });
        await reload(ctx);
        setNote(done);
      });
      setConfirm(null);
    } catch {
      setNote(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const date = (iso: string) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short" }).format(new Date(iso));

  return (
    <div className="min-h-dvh bg-bg">
      <TopBar title={ctx ? ctx.orgName : t("dash.admin.title")} synthetic={ctx?.synthetic} onSignOut={onSignOut} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-8 sm:px-6">
        {failed ? (
          <p role="alert" className="text-text">{t("common.error")}</p>
        ) : ctx === null ? (
          <p className="max-w-prose text-text">{t("dash.admin.notAdmin")}</p>
        ) : !ctx || !summary || !access ? (
          <div role="status" className="flex flex-col gap-4"><span className="sr-only">{t("common.loading")}</span><Skeleton className="h-8 w-1/2" /><Skeleton className="h-28 w-full" /><Skeleton className="h-40 w-full" /></div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-[-0.025em] text-text">{t("dash.admin.greeting", { prenom: ctx.me.firstName })}</h1>
              <p className="text-[0.9375rem] text-soft">{t("dash.admin.lede", { org: ctx.orgName })}</p>
              {ctx.frozen && (
                <p role="status" className="mt-2 flex items-start gap-2 rounded-[var(--radius-card)] bg-danger-soft px-4 py-3 text-sm text-text">
                  <Snowflake size={18} weight="bold" className="mt-0.5 shrink-0 text-danger-ink" aria-hidden="true" />
                  {t("dash.admin.frozenBanner")}
                </p>
              )}
              {note && <p role="status" className="text-sm text-soft">{note}</p>}
            </div>

            <Section id="etat" title={t("dash.support.title", { n: summary.days })}>
              <SupportSummary s={summary.support} days={summary.days} />
            </Section>

            <Section id="qualite" title={t("dash.quality.title")}>
              <QualityPanel
                categories={summary.categories}
                busy={busy}
                onGate={(c, state) => {
                  const op: AdminOp = { op: "category.set_state", category: c.category, state };
                  const name = t(`category.${c.category}` as MessageKey);
                  // Ouvrir est une décision humaine, expliquée puis confirmée ; refermer (restreindre) est immédiat.
                  if (state === "direct") setConfirm({ title: t("dash.gate.openTitle", { cat: name }), body: t("dash.gate.openBody"), action: t("dash.gate.open"), op, done: t("dash.gate.opened"), tone: "primary" });
                  else void act(op, t("dash.gate.closed"));
                }}
              />
            </Section>

            <Section id="acces" title={t("dash.access.title")} hint={t("dash.access.hint")}>
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title={t("dash.access.relationship")}>
                  {access.relationship ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-[0.9375rem] text-text">
                        <span className="font-medium">{access.relationship.partnerName}</span>
                        {" · "}
                        {t(`dash.relStatus.${access.relationship.status}` as MessageKey)}
                        {" · "}
                        {t("dash.access.until", { date: date(access.relationship.expiresAt) })}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {access.relationship.approvedRoles.map((r) => <Badge key={r} tone="outline">{t(`dash.role.${r}` as MessageKey)}</Badge>)}
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        className="self-start"
                        onClick={() => setConfirm({ title: t("dash.access.revokeRel"), body: t("dash.access.revokeRelBody", { esn: access.relationship?.partnerName ?? "" }), action: t("dash.access.revokeRel"), op: { op: "relationship.revoke" }, done: t("dash.access.revoked") })}
                      >
                        <LinkBreak size={18} aria-hidden="true" />
                        {t("dash.access.revokeRel")}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-soft">{t("dash.access.noRel")}</p>
                  )}
                </Panel>

                <Panel title={t("dash.access.technicians")}>
                  {access.technicians.length === 0 ? (
                    <p className="text-sm text-soft">{t("dash.access.none")}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {access.technicians.map((x) => (
                        <li key={x.assignmentId} className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
                          <span className="text-text">{x.name}</span>
                          <span className="num text-[0.8125rem] text-soft">{t("dash.access.until", { date: date(x.until) })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-[0.8125rem] text-soft">{t("dash.access.techniciansHint")}</p>
                </Panel>

                <Panel title={t("dash.access.delegations")}>
                  {access.delegations.length === 0 ? (
                    <p className="text-sm text-soft">{t("dash.access.none")}</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {access.delegations.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[0.9375rem] text-text">{t("dash.access.delegation", { from: d.from, to: d.to, date: date(d.until) })}</span>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act({ op: "delegation.revoke", delegationId: d.id }, t("dash.access.revoked"))}>{t("dash.access.revoke")}</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title={t("dash.access.support")}>
                  {access.supportAccess.length === 0 ? (
                    <p className="text-sm text-soft">{t("dash.access.noSupport")}</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {access.supportAccess.map((g) => (
                        <li key={g.id} className="flex flex-col gap-2">
                          <span className="text-[0.9375rem] text-text">{g.reason}</span>
                          <span className="flex flex-wrap items-center gap-2">
                            {g.approved ? (
                              <Badge tone="relief">{t("dash.access.supportOpen", { heure: g.until ? hourLabel(g.until, lang) : "–" })}</Badge>
                            ) : (
                              <>
                                <Badge tone="outline">{t("dash.access.supportPending")}</Badge>
                                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act({ op: "support_access.approve", grantId: g.id }, t("dash.access.approved"))}>{t("dash.access.approve")}</Button>
                              </>
                            )}
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act({ op: "support_access.revoke", grantId: g.id }, t("dash.access.revoked"))}>
                              {g.approved ? t("dash.access.revoke") : t("dash.access.refuse")}
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </Section>

            <Section id="connecteurs" title={t("dash.conn.title")}>
              {access.connectors.length === 0 ? (
                <p className="text-sm text-soft">{t("dash.conn.none")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border border-y border-border">
                  {access.connectors.map((k) => (
                    <li key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                      <Plugs size={18} className="text-soft" aria-hidden="true" />
                      <span className="flex-1 text-[0.9375rem] text-text">{k.name}</span>
                      <ConnectorState status={k.status} />
                      <span className="num text-[0.8125rem] text-soft">{k.lastSyncAt ? t("dash.conn.sync", { heure: hourLabel(k.lastSyncAt, lang) }) : t("dash.conn.never")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section id="reglages" title={t("dash.settings.title")}>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-text">{t("dash.autonomy.title")}</h3>
                  <p className="max-w-[72ch] text-[0.8125rem] text-soft">{t("dash.autonomy.hint")}</p>
                  {(["accounts", "tickets"] as const).map((cat) => {
                    const level = access.autonomy.find((a) => a.category === cat)?.level ?? 0;
                    return (
                      <div key={cat} role="radiogroup" aria-label={t(`dash.autonomy.${cat}` as MessageKey)} className="flex flex-wrap items-center gap-3">
                        <span className="w-full text-[0.9375rem] text-text sm:w-56">{t(`dash.autonomy.${cat}` as MessageKey)}</span>
                        {([0, 1] as const).map((l) => (
                          <button
                            key={l}
                            type="button"
                            role="radio"
                            aria-checked={level === l}
                            disabled={busy || ctx.frozen}
                            onClick={() => level !== l && void act({ op: "autonomy.set", category: cat, level: l }, t("dash.autonomy.done"))}
                            className={cn(
                              "min-h-11 rounded-[var(--radius-control)] border border-border px-3 text-sm text-soft transition-colors duration-150",
                              "enabled:hover:text-text aria-checked:border-signal aria-checked:bg-signal-soft aria-checked:text-text disabled:opacity-60",
                            )}
                          >
                            {t(`dash.autonomy.level${l}` as MessageKey)}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-text">{t("dash.relief.title")}</h3>
                  {access.relief.length === 0 ? (
                    <p className="text-sm text-soft">{t("dash.relief.none")}</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {access.relief.map((r) => (
                        <li key={`${r.kind}${r.startsAt}`} className="text-[0.9375rem] text-text">
                          {t(`dash.relief.${r.kind}` as MessageKey)} · <span className="num">{date(r.startsAt)} {hourLabel(r.startsAt, lang)} → {date(r.endsAt)} {hourLabel(r.endsAt, lang)}</span>
                          {r.who ? ` · ${r.who}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-danger/40 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
                    <ShieldSlash size={18} weight="bold" className="text-danger-ink" aria-hidden="true" />
                    {t("dash.freeze.title")}
                  </h3>
                  <p className="max-w-[72ch] text-[0.8125rem] text-soft">{t("dash.freeze.hint")}</p>
                  {ctx.frozen ? (
                    <Button variant="secondary" className="self-start" disabled={busy} onClick={() => void act({ op: "org.unfreeze" }, t("dash.freeze.lifted"))}>{t("dash.freeze.lift")}</Button>
                  ) : (
                    <Button
                      variant="danger"
                      className="self-start"
                      onClick={() => setConfirm({ title: t("dash.freeze.title"), body: t("dash.freeze.confirmBody"), action: t("dash.freeze.do"), op: { op: "org.freeze" }, done: t("dash.freeze.done") })}
                    >
                      <Snowflake size={18} weight="bold" aria-hidden="true" />
                      {t("dash.freeze.do")}
                    </Button>
                  )}
                </div>
              </div>
            </Section>
          </>
        )}
      </main>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.body}>
        <div className="flex gap-2">
          <Button variant={confirm?.tone ?? "danger"} busy={busy} onClick={() => confirm && void act(confirm.op, confirm.done)}>{confirm?.action}</Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
        </div>
      </Dialog>
      {dialog}
    </div>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-titre`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-titre`} className="text-lg font-semibold tracking-[-0.02em] text-text">{title}</h2>
        {hint && <p className="max-w-[72ch] text-sm text-soft">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children}
    </div>
  );
}

function ConnectorState({ status }: { status: AccessOverview["connectors"][number]["status"] }) {
  const t = useT();
  if (status === "ok") return <Badge tone="signal" icon={<CheckCircle size={14} weight="fill" aria-hidden="true" />}>{t("dash.conn.ok")}</Badge>;
  if (status === "error") return <Badge tone="danger" icon={<Warning size={14} weight="fill" aria-hidden="true" />}>{t("dash.conn.error")}</Badge>;
  return <Badge tone="outline">{t(`dash.conn.${status}` as MessageKey)}</Badge>;
}
