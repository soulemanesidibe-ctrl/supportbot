// Tâche planifiée « alerts-tick » (chaque minute) : la base fait avancer l'état des alertes, puis le moteur exécute les règles.
//   1. confirmation à l'échéance (anti-battement : 3 minutes) et alertes confirmées encore sans incident → « alerte ouverte » ;
//   2. sources muettes → alerte « silence anormal » → « source muette » ;
//   3. incidents résolus depuis moins d'une heure → « alerte résolue » ;
//   4. suivi des incidents ouverts : demandes arrivées après l'ouverture, rattachées et prévenues (règle « incident-grouped »).
// Chaque organisation reçoit son propre contexte (scopeCronToOrg : état relu en base). Une erreur sur un élément n'arrête pas les autres.
// Budget de temps : au-delà, le reste attend la minute suivante (rien n'est perdu : tout est relu en base).
import { OrgStateRow, scopeCronToOrg } from "../auth.ts";
import { auditEvent } from "../audit.ts";
import { AuthContext, isAuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import { log } from "../log.ts";
import { EngineDeps, mirrorIncidentForFollowUp, runAlertTrigger } from "./engine.ts";
import { effectiveRows, parseRule } from "./rules.ts";
import { AUTOMATION_TEXTS } from "./templates.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AlertRef { readonly alertId: string; readonly orgId: string }
export interface IncidentRef { readonly incidentId: string; readonly alertId: string; readonly orgId: string }

/** Lectures de la tâche planifiée : fonctions SQL de la migration 15 (toutes organisations, bornées). */
export interface TickSql {
  confirmDue(cron: AuthContext): Promise<AlertRef[]>;
  awaitingGrouping(cron: AuthContext): Promise<AlertRef[]>;
  recordSilence(cron: AuthContext): Promise<AlertRef[]>;
  recentlyResolved(cron: AuthContext): Promise<IncidentRef[]>;
  openFollowups(cron: AuthContext): Promise<IncidentRef[]>;
  readOrg(cron: AuthContext, orgId: string): Promise<OrgStateRow | null>;
}

export interface TickDeps extends EngineDeps {
  readonly sql: TickSql;
  readonly nowMs: () => number;
  /** 50 secondes par défaut : la tâche suivante part une minute plus tard. */
  readonly budgetMs?: number;
}

export interface TickReport {
  confirmed: number;
  opened: number;
  silent: number;
  resolved: number;
  followups: number;
  executed: number;
  errors: number;
  deferred: number;
}

/** Suivi d'un incident ouvert : seulement si la règle « regroupement » effective est active et hors simulation. */
export async function followUpIncident(auth: AuthContext, ref: IncidentRef, deps: EngineDeps): Promise<boolean> {
  if (!isAuthContext(auth) || auth.kind !== "cron" || auth.orgId !== ref.orgId) throw Errors.forbidden();
  if (auth.frozen) return false;
  const rule = effectiveRows(await deps.store.rules(auth, "alert.opened"), ref.orgId)
    .map(parseRule)
    .map((p) => (p.ok ? p.rule : null))
    .find((r) => r !== null && r.enabled && !r.dryRun && r.action.kind === "group_into_incident");
  if (!rule) return false;
  const ctx = await deps.store.alertContext(auth, ref.alertId);
  if (!ctx || ctx["alert.incident"] !== ref.incidentId) return false;
  const notice = rule.action.params.notify_users === "template" ? AUTOMATION_TEXTS.incidentOpened(ctx["alert.category"]) : null;
  const g = await deps.store.incidentGroup(auth, { alertId: ref.alertId, maxItems: rule.limits.maxItemsPerRun, notice });
  if (g.status !== "grouped" || ((g.newChildren?.length ?? 0) === 0 && (g.notified ?? 0) === 0)) return false;
  const ticketing = await mirrorIncidentForFollowUp(auth, g, deps);
  await auditEvent(auth, {
    event: "automation.follow_up",
    actorKind: "system",
    subjectType: "incident",
    subjectId: ref.incidentId,
    details: { rule: rule.key, version: rule.version, notified: g.notified ?? 0, attached: g.newChildren?.length ?? 0, ...ticketing },
  }, deps.db);
  return true;
}

export async function alertsTick(cron: AuthContext, deps: TickDeps): Promise<TickReport> {
  if (!isAuthContext(cron) || cron.kind !== "cron" || cron.orgId !== null) throw Errors.forbidden();
  const start = deps.nowMs();
  const budget = deps.budgetMs ?? 50_000;
  const report: TickReport = { confirmed: 0, opened: 0, silent: 0, resolved: 0, followups: 0, executed: 0, errors: 0, deferred: 0 };
  const orgs = new Map<string, Promise<AuthContext | null>>();
  const orgCtx = (orgId: string): Promise<AuthContext | null> => {
    if (!orgs.has(orgId)) orgs.set(orgId, scopeCronToOrg(cron, orgId, (id) => deps.sql.readOrg(cron, id)).catch(() => null));
    return orgs.get(orgId) as Promise<AuthContext | null>;
  };
  const run = async (orgId: string, work: (auth: AuthContext) => Promise<number>) => {
    if (deps.nowMs() - start > budget) {
      report.deferred++;
      return;
    }
    const auth = await orgCtx(orgId);
    if (!auth) return; // organisation inconnue ou suspendue
    try {
      report.executed += await work(auth);
    } catch (e) {
      report.errors++;
      log.warn("tache_alertes_element_en_echec", { requestId: cron.requestId, code: e instanceof Error ? e.name : "inconnu" });
    }
  };
  const executedIn = (r: Awaited<ReturnType<typeof runAlertTrigger>>) => r.filter((x) => x.decision === "executed").length;

  // 1. Alertes ouvertes : confirmées à l'instant, ou confirmées et toujours sans incident (réévaluées : les demandes arrivent après).
  const confirmed = await deps.sql.confirmDue(cron);
  report.confirmed = confirmed.length;
  const opened = new Map<string, AlertRef>();
  for (const a of [...confirmed, ...(await deps.sql.awaitingGrouping(cron))]) if (UUID.test(a.alertId) && UUID.test(a.orgId)) opened.set(a.alertId, a);
  report.opened = opened.size;
  for (const a of opened.values()) await run(a.orgId, async (auth) => executedIn(await runAlertTrigger(auth, { kind: "alert.opened", alertId: a.alertId }, deps)));

  // 2. Sources muettes.
  const silent = await deps.sql.recordSilence(cron);
  report.silent = silent.length;
  for (const a of silent) {
    if (!UUID.test(a.alertId) || !UUID.test(a.orgId)) continue;
    await run(a.orgId, async (auth) => executedIn(await runAlertTrigger(auth, { kind: "alert.source_silent", alertId: a.alertId }, deps)));
  }

  // 3. Incidents résolus.
  const resolved = await deps.sql.recentlyResolved(cron);
  report.resolved = resolved.length;
  for (const i of resolved) {
    if (!UUID.test(i.alertId) || !UUID.test(i.incidentId) || !UUID.test(i.orgId)) continue;
    await run(i.orgId, async (auth) => executedIn(await runAlertTrigger(auth, { kind: "alert.resolved", alertId: i.alertId, incidentId: i.incidentId }, deps)));
  }

  // 4. Suivi des incidents ouverts.
  const followups = await deps.sql.openFollowups(cron);
  for (const i of followups) {
    if (!UUID.test(i.alertId) || !UUID.test(i.incidentId) || !UUID.test(i.orgId)) continue;
    await run(i.orgId, async (auth) => {
      const done = await followUpIncident(auth, i, deps);
      if (done) report.followups++;
      return 0;
    });
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------
// Lectures réelles (service, toutes organisations : réservées à un contexte de tâche planifiée)
// ---------------------------------------------------------------------------------------------------------------
async function rows(cron: AuthContext, fn: string, db?: DbDeps): Promise<Record<string, unknown>[]> {
  if (!isAuthContext(cron) || cron.kind !== "cron" || cron.orgId !== null) throw Errors.forbidden();
  const { data, error } = await serviceClient(cron, db).rpc(fn, { p_limit: 200 });
  if (error) throw Errors.unavailable();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

const alertRefs = (r: Record<string, unknown>[]): AlertRef[] =>
  r.filter((x) => typeof x.alert_id === "string" && typeof x.org_id === "string").map((x) => ({ alertId: x.alert_id as string, orgId: x.org_id as string }));
const incidentRefs = (r: Record<string, unknown>[]): IncidentRef[] =>
  r.filter((x) => typeof x.alert_id === "string" && typeof x.incident_id === "string" && typeof x.org_id === "string")
    .map((x) => ({ incidentId: x.incident_id as string, alertId: x.alert_id as string, orgId: x.org_id as string }));

export function supabaseTickSql(db?: DbDeps): TickSql {
  return {
    confirmDue: async (cron: AuthContext) => alertRefs(await rows(cron, "alerts_confirm_due", db)),
    awaitingGrouping: async (cron: AuthContext) => alertRefs(await rows(cron, "alerts_awaiting_grouping", db)),
    recordSilence: async (cron: AuthContext) => alertRefs(await rows(cron, "alerts_record_silence", db)),
    recentlyResolved: async (cron: AuthContext) => incidentRefs(await rows(cron, "incidents_recently_resolved", db)),
    openFollowups: async (cron: AuthContext) => incidentRefs(await rows(cron, "incidents_open_followup", db)),
    async readOrg(cron: AuthContext, orgId: string): Promise<OrgStateRow | null> {
      if (!isAuthContext(cron) || cron.kind !== "cron") throw Errors.forbidden();
      const { data, error } = await serviceClient(cron, db).from("organizations").select("state, frozen_at, activated_at").eq("id", orgId).maybeSingle();
      if (error) throw Errors.unavailable();
      if (!data) return null;
      const r = data as { state: string; frozen_at: string | null; activated_at: string | null };
      return { state: r.state, frozen: r.frozen_at !== null, activated: r.activated_at !== null };
    },
  };
}
