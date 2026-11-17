// Écran de l'ESN (docs/10 § 5.2 : « Lequel de mes clients a besoin de moi maintenant ? ») : tous les clients sur une ligne chacun,
// triés par urgence, filtres par étiquette, zoom sur un client (état du support, qualité de Relève, rapport mensuel), opportunités et
// revenu (docs/11 § 3). Aucun contenu de conversation : seulement des comptes (SEC-26). Prix et marge : visibles de l'ESN seulement.
import { ArrowRight, CalendarX, Lifebuoy, Lightning, Plugs, Printer, ShieldCheck, Timer, TrendUp } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Skeleton } from "../ui/Skeleton.tsx";
import type { DashboardApi, OrgSummary, PartnerClientRow, PartnerContext } from "../lib/api/dashboard-types.ts";
import { useLang, useT } from "../lib/i18n/index.tsx";
import { hourLabel } from "../lib/time.ts";
import { pct } from "./charts.tsx";
import { QualityPanel } from "./QualityPanel.tsx";
import { StaffShell, TopBar } from "./StaffShell.tsx";
import { SupportSummary } from "./SupportSummary.tsx";

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const daysUntil = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

/** Ordre d'urgence : incident majeur, SLA en danger, connecteur en erreur, action à valider, attente d'un technicien. */
export function urgency(c: PartnerClientRow): number {
  return c.majorIncidents * 1000 + c.slaAtRisk * 300 + c.connectorsInError * 200 + c.pendingActions * 50 + c.waitingTechnician * 10 + c.openIncidents;
}

export interface Opportunity {
  readonly client: PartnerClientRow;
  readonly kind: "relief" | "pilot" | "proof";
}

/** Opportunités pour l'ESN (docs/11 § 3) : relève à proposer, pilote qui se termine, résultats à montrer. Règles simples, explicables. */
export function opportunities(clients: readonly PartnerClientRow[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const c of clients) {
    if (!c.reliefActive && c.absences90d >= 2) out.push({ client: c, kind: "relief" });
    if (c.orgState === "pilot" && daysUntil(c.relationshipExpiresAt) <= 60) out.push({ client: c, kind: "pilot" });
    if (c.conversations30d >= 50 && c.resolvedByReleve30d / c.conversations30d >= 0.25 && (c.satisfactionAvg30d ?? 0) >= 4.3 && c.satisfactionN30d >= 10) {
      out.push({ client: c, kind: "proof" });
    }
  }
  return out;
}

export default function EsnApp() {
  const t = useT();
  return (
    <StaffShell title={t("dash.esn.title")} signIn={{ title: t("dash.esn.signin.title"), lede: t("dash.esn.signin.lede"), verify: t("dash.esn.signin.verify") }}>
      {(api, signOut) => <Esn api={api} onSignOut={signOut} />}
    </StaffShell>
  );
}

function Esn({ api, onSignOut }: { api: DashboardApi; onSignOut: () => void }) {
  const t = useT();
  const [ctx, setCtx] = useState<PartnerContext | null | undefined>(undefined);
  const [clients, setClients] = useState<readonly PartnerClientRow[] | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [zoom, setZoom] = useState<PartnerClientRow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await api.partner();
        if (!alive) return;
        setCtx(p);
        if (p) {
          const c = await api.partnerClients(p.partnerId);
          if (alive) setClients(c);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [api]);

  const sorted = useMemo(() => (clients ? [...clients].sort((a, b) => urgency(b) - urgency(a) || a.name.localeCompare(b.name, "fr")) : null), [clients]);
  const labels = useMemo(() => [...new Set((clients ?? []).flatMap((c) => c.labels))].sort((a, b) => a.localeCompare(b, "fr")), [clients]);
  const shown = useMemo(() => (sorted ? sorted.filter((c) => !label || c.labels.includes(label)) : null), [sorted, label]);
  const totals = useMemo(() => (clients ?? []).reduce(
    (s, c) => ({ incidents: s.incidents + c.openIncidents, approve: s.approve + c.pendingActions, waiting: s.waiting + c.waitingTechnician }),
    { incidents: 0, approve: 0, waiting: 0 },
  ), [clients]);

  return (
    <div className="min-h-dvh bg-bg">
      <TopBar title={ctx ? ctx.partnerName : t("dash.esn.title")} synthetic={ctx?.synthetic} onSignOut={onSignOut} />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 py-8 sm:px-6">
        {failed ? (
          <p role="alert" className="text-text">{t("common.error")}</p>
        ) : ctx === null ? (
          <p className="max-w-prose text-text">{t("dash.esn.notPartner")}</p>
        ) : (
          <>
            <section aria-labelledby="clients-titre" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h1 id="clients-titre" className="text-2xl font-semibold tracking-[-0.025em] text-text">
                    {ctx ? t("dash.esn.greeting", { prenom: ctx.me.firstName }) : t("dash.esn.title")}
                  </h1>
                  {clients && (
                    <p className="text-[0.9375rem] text-soft">
                      {t("dash.esn.summary", { n: clients.length, incidents: totals.incidents, approve: totals.approve, waiting: totals.waiting })}
                    </p>
                  )}
                </div>
                {labels.length > 0 && (
                  <div role="group" aria-label={t("dash.esn.filter")} className="flex flex-wrap gap-1.5">
                    {[null, ...labels].map((l) => (
                      <button
                        key={l ?? "tous"}
                        type="button"
                        aria-pressed={label === l}
                        onClick={() => setLabel(l)}
                        className="min-h-11 rounded-full border border-border px-3 text-[0.8125rem] text-soft transition-colors duration-150 hover:text-text aria-pressed:border-transparent aria-pressed:bg-surface-3 aria-pressed:text-text"
                      >
                        {l ?? t("dash.esn.allLabels")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!shown ? (
                <TableSkeleton />
              ) : (
                <>
                  <ClientList clients={shown} selected={zoom?.orgId ?? null} onZoom={setZoom} />
                  <ClientTable clients={shown} selected={zoom?.orgId ?? null} onZoom={setZoom} />
                </>
              )}
            </section>

            {zoom && <Zoom key={zoom.orgId} api={api} client={zoom} onClose={() => setZoom(null)} />}

            {clients && (
              <div className="grid gap-12 lg:grid-cols-2">
                <Opportunities list={opportunities(clients)} onZoom={setZoom} />
                <Revenue clients={clients} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Count({ n, tone, icon, label }: { n: number; tone: "danger" | "relief" | "neutral"; icon?: ReactNode; label: string }) {
  if (n === 0) return <span className="num text-soft" aria-label={`${label} : 0`}>0</span>;
  const cls = tone === "danger" ? "text-danger-ink" : tone === "relief" ? "text-relief-ink" : "text-text";
  return (
    <span className={cn("num inline-flex items-center gap-1.5 font-medium", cls)} aria-label={`${label} : ${n}`}>
      {icon}
      {n}
    </span>
  );
}

function ClientTable({ clients, selected, onZoom }: { clients: readonly PartnerClientRow[]; selected: string | null; onZoom: (c: PartnerClientRow) => void }) {
  const t = useT();
  const [lang] = useLang();
  const th = "px-3 py-2.5 text-left text-xs font-medium text-soft first:pl-4 last:pr-4";
  const td = "px-3 py-3 align-middle first:pl-4 last:pr-4";
  return (
    <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface md:block">
      <table className="w-full min-w-[60rem] border-collapse text-[0.9375rem]">
        <caption className="sr-only">{t("dash.esn.tableCaption")}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>{t("dash.col.client")}</th>
            <th scope="col" className={th}>{t("dash.col.relief")}</th>
            <th scope="col" className={th}>{t("dash.col.incidents")}</th>
            <th scope="col" className={th}>{t("dash.col.approve")}</th>
            <th scope="col" className={th}>{t("dash.col.waiting")}</th>
            <th scope="col" className={th}>{t("dash.col.sla")}</th>
            <th scope="col" className={th}>{t("dash.col.connectors")}</th>
            <th scope="col" className={cn(th, "text-right")}>{t("dash.col.releve30")}</th>
            <th scope="col" className={cn(th, "text-right")}>{t("dash.col.satisfaction")}</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.orgId} className={cn("border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-surface-2", selected === c.orgId && "bg-surface-2")}>
              <th scope="row" className={cn(td, "text-left font-normal")}>
                <button type="button" onClick={() => onZoom(c)} className="group flex min-h-11 flex-col items-start justify-center text-left" aria-expanded={selected === c.orgId}>
                  <span className="flex items-center gap-2 font-medium text-text">
                    {c.name}
                    {c.frozen && <Badge tone="solid-danger">{t("dash.esn.frozen")}</Badge>}
                    {c.orgState === "pilot" && <Badge tone="outline">{t("dash.esn.pilot")}</Badge>}
                  </span>
                  {c.labels.length > 0 && <span className="text-xs text-soft">{c.labels.join(" · ")}</span>}
                </button>
              </th>
              <td className={td}>
                {c.reliefActive && c.reliefUntil ? (
                  <Badge tone="relief">{t("common.relief.until", { heure: hourLabel(c.reliefUntil, lang) })}</Badge>
                ) : (
                  <span className="whitespace-nowrap text-soft">{t("dash.esn.teamPresent")}</span>
                )}
              </td>
              <td className={td}>
                <Count n={c.openIncidents} tone={c.majorIncidents > 0 ? "danger" : "neutral"} icon={c.majorIncidents > 0 ? <Lightning size={16} weight="fill" aria-hidden="true" /> : undefined} label={t("dash.col.incidents")} />
                {c.majorIncidents > 0 && <span className="ml-1.5 whitespace-nowrap text-xs text-danger-ink">{t("dash.esn.major", { n: c.majorIncidents })}</span>}
              </td>
              <td className={td}><Count n={c.pendingActions} tone="relief" icon={<ShieldCheck size={16} weight="duotone" aria-hidden="true" />} label={t("dash.col.approve")} /></td>
              <td className={td}><Count n={c.waitingTechnician} tone="neutral" label={t("dash.col.waiting")} /></td>
              <td className={td}><Count n={c.slaAtRisk} tone="danger" icon={<Timer size={16} weight="bold" aria-hidden="true" />} label={t("dash.col.sla")} /></td>
              <td className={td}>
                {c.connectorsInError > 0 ? (
                  <Count n={c.connectorsInError} tone="danger" icon={<Plugs size={16} weight="bold" aria-hidden="true" />} label={t("dash.col.connectors")} />
                ) : (
                  <span className="whitespace-nowrap text-soft">{t("dash.esn.connectorsOk")}</span>
                )}
              </td>
              <td className={cn(td, "num text-right text-text")}>
                {c.conversations30d > 0 ? pct(c.resolvedByReleve30d, c.conversations30d) : "–"}
                <span className="block whitespace-nowrap text-xs text-soft">{t("dash.esn.ofRequests", { n: c.conversations30d })}</span>
              </td>
              <td className={cn(td, "num text-right text-text")}>
                {c.satisfactionAvg30d === null ? "–" : dec.format(c.satisfactionAvg30d)}
                <span className="block whitespace-nowrap text-xs text-soft">{t("dash.basis.ratings", { n: c.satisfactionN30d })}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Sur téléphone, une ligne par client avec seulement les signaux non nuls, dans le même ordre d'urgence que le tableau : le tableau
 * entier ne tiendrait pas, et ce qui compte (incident, SLA, validation) serait hors de l'écran.
 */
function ClientList({ clients, selected, onZoom }: { clients: readonly PartnerClientRow[]; selected: string | null; onZoom: (c: PartnerClientRow) => void }) {
  const t = useT();
  const [lang] = useLang();
  return (
    <ul aria-label={t("dash.esn.tableCaption")} className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface md:hidden">
      {clients.map((c) => {
        const signals: { key: string; text: string; tone: string; icon: ReactNode }[] = [];
        if (c.openIncidents > 0) {
          signals.push({
            key: "inc", tone: c.majorIncidents > 0 ? "text-danger-ink" : "text-text", icon: <Lightning size={16} weight="fill" aria-hidden="true" />,
            text: t("dash.m.incidents", { n: c.openIncidents }) + (c.majorIncidents > 0 ? ` ${t("dash.esn.major", { n: c.majorIncidents })}` : ""),
          });
        }
        if (c.slaAtRisk > 0) signals.push({ key: "sla", tone: "text-danger-ink", icon: <Timer size={16} weight="bold" aria-hidden="true" />, text: t("dash.m.sla", { n: c.slaAtRisk }) });
        if (c.connectorsInError > 0) signals.push({ key: "con", tone: "text-danger-ink", icon: <Plugs size={16} weight="bold" aria-hidden="true" />, text: t("dash.m.connectors", { n: c.connectorsInError }) });
        if (c.pendingActions > 0) signals.push({ key: "val", tone: "text-relief-ink", icon: <ShieldCheck size={16} weight="duotone" aria-hidden="true" />, text: t("dash.m.approve", { n: c.pendingActions }) });
        if (c.waitingTechnician > 0) signals.push({ key: "att", tone: "text-text", icon: null, text: t("dash.m.waiting", { n: c.waitingTechnician }) });
        return (
          <li key={c.orgId} className={cn(selected === c.orgId && "bg-surface-2")}>
            <button type="button" onClick={() => onZoom(c)} aria-expanded={selected === c.orgId} className="flex min-h-11 w-full flex-col items-start gap-2 px-4 py-3.5 text-left">
              <span className="flex w-full flex-wrap items-center gap-2">
                <span className="font-medium text-text">{c.name}</span>
                {c.frozen && <Badge tone="solid-danger">{t("dash.esn.frozen")}</Badge>}
                {c.orgState === "pilot" && <Badge tone="outline">{t("dash.esn.pilot")}</Badge>}
                {c.reliefActive && c.reliefUntil && <Badge tone="relief">{t("common.relief.until", { heure: hourLabel(c.reliefUntil, lang) })}</Badge>}
              </span>
              {signals.length > 0 ? (
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
                  {signals.map((x) => <span key={x.key} className={cn("num inline-flex items-center gap-1.5", x.tone)}>{x.icon}{x.text}</span>)}
                </span>
              ) : (
                <span className="text-[0.8125rem] text-soft">{t("dash.m.calm")}</span>
              )}
              <span className="num text-xs text-soft">
                {t("dash.m.results", { p: c.conversations30d > 0 ? pct(c.resolvedByReleve30d, c.conversations30d) : "–", n: c.conversations30d })}
                {c.satisfactionAvg30d !== null && ` · ${t("dash.m.satisfaction", { s: dec.format(c.satisfactionAvg30d) })}`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TableSkeleton() {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <span className="sr-only">{t("common.loading")}</span>
      {[0, 1, 2, 3].map((i) => <div key={i} className="px-4 py-4"><Skeleton className="h-5 w-full" /></div>)}
    </div>
  );
}

function Zoom({ api, client, onClose }: { api: DashboardApi; client: PartnerClientRow; onClose: () => void }) {
  const t = useT();
  const [s, setS] = useState<OrgSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView?.({ behavior: still ? "auto" : "smooth", block: "start" });
    let alive = true;
    api.orgSummary(client.orgId, 30).then((x) => alive && setS(x), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api, client.orgId]);
  return (
    <section ref={ref} aria-labelledby="zoom-titre" className="flex scroll-mt-20 flex-col gap-8 rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="zoom-titre" className="text-xl font-semibold tracking-[-0.02em] text-text">{client.name}</h2>
          <p className="text-sm text-soft">{t("dash.esn.zoomHint")}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to={`/esn/rapport/${client.orgId}`}>
              <Printer size={18} aria-hidden="true" />
              {t("dash.report.open")}
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
      {failed ? (
        <p role="alert" className="text-text">{t("common.error")}</p>
      ) : !s ? (
        <div role="status" className="flex flex-col gap-3"><span className="sr-only">{t("common.loading")}</span><Skeleton className="h-16 w-full" /><Skeleton className="h-8 w-full" /></div>
      ) : (
        <>
          <section aria-labelledby="zoom-support" className="flex flex-col gap-4">
            <h3 id="zoom-support" className="text-base font-semibold text-text">{t("dash.support.title", { n: s.days })}</h3>
            <SupportSummary s={s.support} days={s.days} />
          </section>
          <section aria-labelledby="zoom-qualite" className="flex flex-col gap-4">
            <h3 id="zoom-qualite" className="text-base font-semibold text-text">{t("dash.quality.title")}</h3>
            <QualityPanel categories={s.categories} />
          </section>
        </>
      )}
    </section>
  );
}

const OPP_ICON = { relief: <Lifebuoy size={18} weight="bold" aria-hidden="true" />, pilot: <CalendarX size={18} weight="bold" aria-hidden="true" />, proof: <TrendUp size={18} weight="bold" aria-hidden="true" /> };

function Opportunities({ list, onZoom }: { list: readonly Opportunity[]; onZoom: (c: PartnerClientRow) => void }) {
  const t = useT();
  const [lang] = useLang();
  const date = (iso: string) => new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long" }).format(new Date(iso));
  return (
    <section aria-labelledby="opp-titre" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="opp-titre" className="text-lg font-semibold tracking-[-0.02em] text-text">{t("dash.opp.title")}</h2>
        <p className="text-sm text-soft">{t("dash.opp.hint")}</p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-soft">{t("dash.opp.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {list.map((o) => (
            <li key={`${o.kind}:${o.client.orgId}`}>
              <button type="button" onClick={() => onZoom(o.client)} className="group flex min-h-14 w-full items-start gap-3 py-3 text-left">
                <span className="mt-0.5 text-signal">{OPP_ICON[o.kind]}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium text-text">{o.client.name}</span>
                  <span className="text-sm text-soft">
                    {o.kind === "relief"
                      ? t("dash.opp.relief", { n: o.client.absences90d })
                      : o.kind === "pilot"
                        ? t("dash.opp.pilot", { date: date(o.client.relationshipExpiresAt) })
                        : t("dash.opp.proof", { p: pct(o.client.resolvedByReleve30d, o.client.conversations30d), s: dec.format(o.client.satisfactionAvg30d ?? 0), n: o.client.satisfactionN30d })}
                  </span>
                </span>
                <ArrowRight size={18} className="mt-1 text-soft transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Revenue({ clients }: { clients: readonly PartnerClientRow[] }) {
  const t = useT();
  const priced = clients.filter((c) => c.clientPriceCents !== null && c.partnerPriceCents !== null);
  const sum = (k: "clientPriceCents" | "partnerPriceCents") => priced.reduce((s, c) => s + (c[k] ?? 0), 0);
  const billed = sum("clientPriceCents");
  const cost = sum("partnerPriceCents");
  return (
    <section aria-labelledby="revenu-titre" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="revenu-titre" className="text-lg font-semibold tracking-[-0.02em] text-text">{t("dash.rev.title")}</h2>
        <p className="text-sm text-soft">{t("dash.rev.private")}</p>
      </div>
      {priced.length === 0 ? (
        <p className="text-sm text-soft">{t("dash.rev.empty")}</p>
      ) : (
        <table className="w-full text-[0.9375rem]">
          <caption className="sr-only">{t("dash.rev.title")}</caption>
          <thead>
            <tr className="border-b border-border text-xs text-soft">
              <th scope="col" className="py-2 text-left font-medium">{t("dash.col.client")}</th>
              <th scope="col" className="py-2 text-right font-medium">{t("dash.rev.billed")}</th>
              <th scope="col" className="py-2 text-right font-medium">{t("dash.rev.cost")}</th>
              <th scope="col" className="py-2 text-right font-medium">{t("dash.rev.margin")}</th>
            </tr>
          </thead>
          <tbody className="num">
            {priced.map((c) => (
              <tr key={c.orgId} className="border-b border-border text-text">
                <th scope="row" className="py-2.5 text-left font-normal">{c.name}</th>
                <td className="py-2.5 text-right">{euros.format((c.clientPriceCents ?? 0) / 100)}</td>
                <td className="py-2.5 text-right text-soft">{euros.format((c.partnerPriceCents ?? 0) / 100)}</td>
                <td className="py-2.5 text-right">{euros.format(((c.clientPriceCents ?? 0) - (c.partnerPriceCents ?? 0)) / 100)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="num">
            <tr className="text-text">
              <th scope="row" className="pt-3 text-left font-semibold">{t("dash.rev.total")}</th>
              <td className="pt-3 text-right font-semibold">{euros.format(billed / 100)}</td>
              <td className="pt-3 text-right text-soft">{euros.format(cost / 100)}</td>
              <td className="pt-3 text-right font-semibold">{euros.format((billed - cost) / 100)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {priced.length > 0 && <p className="text-[0.8125rem] text-soft">{t("dash.rev.note", { p: pct(billed - cost, billed) })}</p>}
    </section>
  );
}
