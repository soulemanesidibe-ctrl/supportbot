// Moteur d'automatisations (spec § 12). Déterministe : des règles déclaratives, un contexte typé fixe, un ensemble FERMÉ d'actions.
// Ordre pour chaque règle d'un déclencheur :
//   lecture stricte de la règle → active ? → conditions → autonomie 1 seulement pour un client activé → action disponible et paramètres
//   valides → PLAFONDS appliqués par la base AVANT tout effet (une exécution par déclencheur, nombre par heure, délai par périmètre,
//   simulation) → effet → journal d'audit.
// Ce qui n'agit pas est inscrit au registre (automation_runs) avec sa raison, une fois. Organisation gelée : rien, sauf l'inscription.
// Le modèle de langage n'intervient nulle part. Les messages aux salariés sont des gabarits fixes ; le texte d'une alerte n'en sort jamais.
import { auditEvent } from "../audit.ts";
import { CallDeps, callSystemCapability } from "../capabilities/call.ts";
import { Connector } from "../capabilities/types.ts";
import { AuthContext, isAuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { AppError, Errors } from "../errors.ts";
import { log } from "../log.ts";
import { AlertContext, ALERT_FIELDS, effectiveRows, evaluate, FieldType, hasType, parseRule, Rule, RuleActionKind, RuleRow, TriggerKind } from "./rules.ts";
import { AUTOMATION_TEXTS, parentTicket } from "./templates.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlertTrigger =
  | { readonly kind: "alert.opened"; readonly alertId: string }
  | { readonly kind: "alert.source_silent"; readonly alertId: string }
  | { readonly kind: "alert.resolved"; readonly alertId: string; readonly incidentId: string };

export type ClaimDecision = "executed" | "dry_run" | "rate_limited" | "already" | "disabled";
export type RunDecision = ClaimDecision | "skipped" | "error";
export interface RunReport { readonly rule: string; readonly decision: RunDecision; readonly reason?: string }

export interface TicketRef { readonly id: string; readonly external_ref: string | null }
export interface GroupResult {
  readonly status: "grouped" | "not_eligible";
  readonly incidentId?: string;
  readonly created?: boolean;
  readonly parent?: TicketRef | null;
  readonly newChildren?: readonly TicketRef[];
  readonly notified?: number;
  readonly severity?: string;
  readonly category?: string | null;
}
export interface CloseOutResult {
  readonly status: "closed_out" | "incident_open";
  readonly notified?: number;
  readonly proposed?: readonly string[];
  readonly refused?: string | null;
  readonly childrenOpen?: number;
}

/** Accès à la base du moteur. Chaque méthode est limitée à l'organisation du contexte (la base le revérifie). */
export interface AutomationStore {
  rules(auth: AuthContext, trigger: TriggerKind): Promise<RuleRow[]>;
  alertContext(auth: AuthContext, alertId: string): Promise<AlertContext | null>;
  claim(auth: AuthContext, a: { ruleKey: string; triggerRef: string; scope: string | null; detail: Record<string, unknown> }): Promise<{ decision: ClaimDecision; maxItems: number }>;
  note(auth: AuthContext, a: { ruleKey: string; version: number; triggerRef: string; decision: "skipped" | "error"; detail: Record<string, unknown> }): Promise<void>;
  incidentGroup(auth: AuthContext, a: { alertId: string; maxItems: number; notice: string | null }): Promise<GroupResult>;
  incidentCloseOut(auth: AuthContext, a: { incidentId: string; maxItems: number; notice: string | null; propose: boolean }): Promise<CloseOutResult>;
  notifyOncall(auth: AuthContext, a: { kind: "incident_opened" | "incident_resolved" | "source_silent"; subjectType: "incident" | "alert"; subjectId: string; payload: Record<string, string | number | boolean> }): Promise<number>;
  recordParentRef(auth: AuthContext, a: { ticketId: string; ref: string; url: string; connectorId: string }): Promise<void>;
}

export interface EngineDeps {
  readonly store: AutomationStore;
  /** Connecteur de ticketing de l'organisation, ou null (le ticket local suffit alors). */
  readonly ticketing: { connectorFor(auth: AuthContext): Promise<Connector | null> };
  readonly call?: Omit<CallDeps, "connectorFor">;
  readonly db?: DbDeps;
}

/** Actions disponibles dans la démo, avec leurs déclencheurs et leurs paramètres ADMIS (valeurs fermées). */
const AVAILABLE: Partial<Record<RuleActionKind, { triggers: readonly TriggerKind[]; params: Readonly<Record<string, readonly string[]>> }>> = {
  group_into_incident: { triggers: ["alert.opened"], params: { notify_users: ["template", "none"], notify_oncall: ["yes", "no"] } },
  propose_close_children: { triggers: ["alert.resolved"], params: { notify_users: ["template", "none"] } },
  notify_oncall: { triggers: ["alert.source_silent"], params: { create_alert: ["yes", "no"] } },
};

function paramsValid(kind: RuleActionKind, params: Readonly<Record<string, string | number>>): boolean {
  const spec = AVAILABLE[kind];
  if (!spec) return false;
  return Object.entries(params).every(([k, v]) => Object.hasOwn(spec.params, k) && typeof v === "string" && spec.params[k].includes(v));
}

function assertSystem(auth: AuthContext): void {
  if (!isAuthContext(auth) || (auth.kind !== "cron" && auth.kind !== "source") || auth.orgId === null) throw Errors.forbidden();
}

function errorReason(e: unknown): string {
  return e instanceof AppError ? e.code : "erreur";
}

/** Exécute les règles d'un déclencheur « alerte » pour l'organisation du contexte. */
export async function runAlertTrigger(auth: AuthContext, trigger: AlertTrigger, deps: EngineDeps): Promise<RunReport[]> {
  assertSystem(auth);
  if (!UUID.test(trigger.alertId) || (trigger.kind === "alert.resolved" && !UUID.test(trigger.incidentId))) throw Errors.badRequest();
  const triggerRef = trigger.kind === "alert.resolved" ? trigger.incidentId : trigger.alertId;
  const rows = effectiveRows(await deps.store.rules(auth, trigger.kind), auth.orgId as string);
  if (rows.length === 0) return [];
  const reports: RunReport[] = [];
  const note = async (key: string, version: number, decision: "skipped" | "error", reason: string, extra: Record<string, unknown> = {}) => {
    reports.push({ rule: key, decision, reason });
    await deps.store.note(auth, { ruleKey: key, version, triggerRef, decision, detail: { reason, trigger: trigger.kind, ...extra } });
  };

  const parsed = rows.map((row) => ({ row, p: parseRule(row) }));
  // Arrêt d'urgence : aucune automatisation, seulement l'inscription de la raison.
  if (auth.frozen) {
    for (const { row, p } of parsed) {
      if (p.ok && !p.rule.enabled) continue;
      await note(String(row.key), typeof row.version === "number" ? row.version : 0, "skipped", "organisation_gelee");
    }
    return reports;
  }
  const ctx = await deps.store.alertContext(auth, trigger.alertId);
  if (!ctx) return reports; // alerte inconnue dans CETTE organisation : rien

  for (const { row, p } of parsed) {
    if (!p.ok) {
      await note(String(row.key).slice(0, 60), typeof row.version === "number" ? row.version : 0, "error", "regle_invalide", { detail: p.reason });
      continue;
    }
    const rule = p.rule;
    if (rule.trigger !== trigger.kind) continue;
    if (!rule.enabled) {
      reports.push({ rule: rule.key, decision: "disabled" });
      continue;
    }
    const ev = evaluate(rule, ctx);
    if (!ev.matched) {
      await note(rule.key, rule.version, "skipped", "conditions", { conditions: ev.failed });
      continue;
    }
    if (rule.autonomy === 1 && !auth.activated) {
      await note(rule.key, rule.version, "skipped", "client_non_active");
      continue;
    }
    const spec = AVAILABLE[rule.action.kind];
    if (!spec || !spec.triggers.includes(trigger.kind)) {
      await note(rule.key, rule.version, "skipped", "action_non_disponible", { action: rule.action.kind });
      continue;
    }
    if (!paramsValid(rule.action.kind, rule.action.params)) {
      await note(rule.key, rule.version, "error", "parametres_invalides");
      continue;
    }
    const scope = scopeOf(rule, trigger, ctx);
    const claim = await deps.store.claim(auth, { ruleKey: rule.key, triggerRef, scope, detail: { trigger: trigger.kind, action: rule.action.kind } });
    if (claim.decision !== "executed") {
      reports.push({ rule: rule.key, decision: claim.decision });
      continue;
    }
    const maxItems = Math.min(claim.maxItems, rule.limits.maxItemsPerRun);
    try {
      const detail = await perform(auth, rule, trigger, ctx, maxItems, deps);
      await auditEvent(auth, {
        event: "automation.executed",
        actorKind: "system",
        subjectType: trigger.kind === "alert.resolved" ? "incident" : "alert",
        subjectId: triggerRef,
        details: { rule: rule.key, version: rule.version, action: rule.action.kind, ...detail },
      }, deps.db);
      reports.push({ rule: rule.key, decision: "executed" });
    } catch (e) {
      log.warn("automatisation_en_echec", { rule: rule.key, requestId: auth.requestId, code: errorReason(e) });
      await note(rule.key, rule.version, "error", errorReason(e)).catch(() => {});
    }
  }
  return reports;
}

/** Périmètre du délai minimal entre deux exécutions : la catégorie pour un regroupement, la source muette, l'incident. */
function scopeOf(rule: Rule, trigger: AlertTrigger, ctx: AlertContext): string | null {
  switch (rule.action.kind) {
    case "group_into_incident":
      return typeof ctx["alert.category"] === "string" ? `categorie:${ctx["alert.category"]}` : null;
    case "propose_close_children":
      return trigger.kind === "alert.resolved" ? `incident:${trigger.incidentId}` : null;
    default:
      return `alerte:${trigger.alertId}`;
  }
}

async function perform(
  auth: AuthContext,
  rule: Rule,
  trigger: AlertTrigger,
  ctx: AlertContext,
  maxItems: number,
  deps: EngineDeps,
): Promise<Record<string, unknown>> {
  const params = rule.action.params;
  switch (rule.action.kind) {
    case "group_into_incident": {
      const notice = params.notify_users === "template" ? AUTOMATION_TEXTS.incidentOpened(ctx["alert.category"]) : null;
      const g = await deps.store.incidentGroup(auth, { alertId: trigger.alertId, maxItems, notice });
      if (g.status !== "grouped" || !g.incidentId) return { status: g.status };
      let oncall = 0;
      if (params.notify_oncall === "yes" && g.created) {
        oncall = await deps.store.notifyOncall(auth, {
          kind: "incident_opened", subjectType: "incident", subjectId: g.incidentId,
          payload: { severity: String(g.severity ?? ""), category: String(g.category ?? "") },
        });
      }
      const ticketing = await mirrorIncident(auth, g, deps);
      return { incident: g.incidentId, created: g.created === true, notified: g.notified ?? 0, oncall, ...ticketing };
    }
    case "propose_close_children": {
      if (trigger.kind !== "alert.resolved") throw Errors.badRequest();
      const notice = params.notify_users === "template" ? AUTOMATION_TEXTS.incidentResolved(ctx["alert.category"]) : null;
      const c = await deps.store.incidentCloseOut(auth, { incidentId: trigger.incidentId, maxItems, notice, propose: true });
      if (c.status !== "closed_out") return { status: c.status };
      const proposed = c.proposed?.length ?? 0;
      let oncall = 0;
      if (proposed > 0) {
        oncall = await deps.store.notifyOncall(auth, {
          kind: "incident_resolved", subjectType: "incident", subjectId: trigger.incidentId,
          payload: { proposals: proposed, children_open: c.childrenOpen ?? 0 },
        });
      }
      // La raison d'un refus de la base est rendue par un code, jamais par le message brut.
      const refused = c.refused ? (/niveau d'autonomie 0/i.test(c.refused) ? "niveau_0" : "refus_base") : null;
      return { incident: trigger.incidentId, notified: c.notified ?? 0, proposed, refused, oncall };
    }
    case "notify_oncall": {
      const n = await deps.store.notifyOncall(auth, { kind: "source_silent", subjectType: "alert", subjectId: trigger.alertId, payload: { severity: "major" } });
      return { oncall: n };
    }
    default:
      throw Errors.forbidden(); // inatteignable : les actions non disponibles sont écartées avant les plafonds
  }
}

/**
 * Copie de l'incident dans l'outil de ticketing (au mieux, jamais bloquante) : ticket parent créé une fois, tickets enfants déjà copiés
 * liés au parent. Passe par la porte des automatisations (liste fermée : créer un ticket, lier deux tickets).
 */
async function mirrorIncident(auth: AuthContext, g: GroupResult, deps: EngineDeps): Promise<Record<string, unknown>> {
  let connector: Connector | null;
  try {
    connector = await deps.ticketing.connectorFor(auth);
  } catch {
    connector = null;
  }
  if (!connector || !g.incidentId) return { ticketing: "aucun" };
  const callDeps: CallDeps = { connectorFor: () => Promise.resolve(connector as Connector), ...deps.call };
  const subject = { type: "incident" as const, id: g.incidentId };
  try {
    let parentRef = g.parent?.external_ref ?? null;
    if (!parentRef && g.parent) {
      const t = parentTicket({ category: g.category ?? null, severity: String(g.severity ?? ""), incidentId: g.incidentId });
      const created = await callSystemCapability(auth, "ticket.create", {
        title: t.title, body: t.body, category: g.category ?? "other", priority: "high", requesterRef: "Relève (automatisation)",
      }, subject, callDeps);
      await deps.store.recordParentRef(auth, { ticketId: g.parent.id, ref: created.ref, url: created.url, connectorId: connector.id });
      parentRef = created.ref;
    }
    if (!parentRef) return { ticketing: "sans_parent" };
    let linked = 0;
    let failed = 0;
    for (const child of g.newChildren ?? []) {
      if (!child.external_ref) continue;
      try {
        await callSystemCapability(auth, "ticket.link_parent", { parentRef, childRef: child.external_ref }, subject, callDeps);
        linked++;
      } catch {
        failed++;
      }
    }
    return { ticketing: "ok", linked, link_failures: failed };
  } catch (e) {
    return { ticketing: "echec", code: errorReason(e) };
  }
}

/** Même copie vers le ticketing, pour le suivi d'un incident déjà ouvert (tâche planifiée). */
export const mirrorIncidentForFollowUp = mirrorIncident;

// ---------------------------------------------------------------------------------------------------------------
// Accès à la base (fonctions SQL de la migration 15, réservées au service)
// ---------------------------------------------------------------------------------------------------------------
const CLAIMS: readonly ClaimDecision[] = ["executed", "dry_run", "rate_limited", "already", "disabled"];

function orgOf(auth: AuthContext): string {
  assertSystem(auth);
  return auth.orgId as string;
}

async function rpc(auth: AuthContext, fn: string, args: Record<string, unknown>, db?: DbDeps): Promise<unknown> {
  const { data, error } = await serviceClient(auth, db).rpc(fn, args);
  if (error) {
    const msg = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
    if (msg.includes("Organisation gelée")) throw Errors.orgFrozen();
    if (msg.includes("introuvable")) throw Errors.notFound();
    throw Errors.unavailable();
  }
  return data;
}

function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw Errors.unavailable();
  return v as Record<string, unknown>;
}

function ticketRef(v: unknown): TicketRef | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID.test(r.id)) return null;
  return { id: r.id, external_ref: typeof r.external_ref === "string" ? r.external_ref : null };
}

/** Contexte typé : on ne garde que les champs connus, avec leur type attendu (le reste est ignoré). */
export function typedContext(raw: unknown): AlertContext | null {
  if (raw === null || raw === undefined) return null;
  const r = obj(raw);
  const out: Record<string, string | number | boolean | null> = {};
  for (const [field, type] of Object.entries(ALERT_FIELDS) as Array<[string, FieldType]>) {
    const v = r[field];
    if (v === null) out[field] = null;
    else if (hasType(v, type)) out[field] = v;
  }
  return out as AlertContext;
}

export function supabaseAutomationStore(db?: DbDeps): AutomationStore {
  return {
    async rules(auth: AuthContext, trigger: TriggerKind): Promise<RuleRow[]> {
      const org = orgOf(auth);
      const { data, error } = await serviceClient(auth, db).from("automation_rules")
        .select("org_id, key, version, enabled, dry_run, autonomy, locked, trigger_kind, definition")
        .eq("trigger_kind", trigger).or(`org_id.eq.${org},org_id.is.null`);
      if (error) throw Errors.unavailable();
      return (data ?? []) as RuleRow[];
    },
    async alertContext(auth: AuthContext, alertId: string): Promise<AlertContext | null> {
      return typedContext(await rpc(auth, "automation_alert_context", { p_org: orgOf(auth), p_alert: alertId }, db));
    },
    async claim(auth: AuthContext, a): Promise<{ decision: ClaimDecision; maxItems: number }> {
      const r = obj(await rpc(auth, "automation_claim", { p_org: orgOf(auth), p_rule_key: a.ruleKey, p_trigger_ref: a.triggerRef, p_scope: a.scope, p_detail: a.detail }, db));
      if (typeof r.decision !== "string" || !(CLAIMS as readonly string[]).includes(r.decision)) throw Errors.unavailable();
      const max = typeof r.max_items === "number" && Number.isInteger(r.max_items) && r.max_items >= 1 ? Math.min(r.max_items, 500) : 1;
      return { decision: r.decision as ClaimDecision, maxItems: max };
    },
    async note(auth: AuthContext, a): Promise<void> {
      await rpc(auth, "automation_note", { p_org: orgOf(auth), p_rule_key: a.ruleKey, p_rule_version: a.version, p_trigger_ref: a.triggerRef, p_decision: a.decision, p_detail: a.detail }, db);
    },
    async incidentGroup(auth: AuthContext, a): Promise<GroupResult> {
      const r = obj(await rpc(auth, "incident_group", { p_org: orgOf(auth), p_alert: a.alertId, p_max: a.maxItems, p_notice: a.notice }, db));
      if (r.status !== "grouped") return { status: "not_eligible" };
      if (typeof r.incident_id !== "string" || !UUID.test(r.incident_id)) throw Errors.unavailable();
      return {
        status: "grouped",
        incidentId: r.incident_id,
        created: r.created === true,
        parent: ticketRef(r.parent),
        newChildren: Array.isArray(r.new_children) ? r.new_children.map(ticketRef).filter((x): x is TicketRef => x !== null) : [],
        notified: typeof r.notified === "number" ? r.notified : 0,
        severity: typeof r.severity === "string" ? r.severity : "",
        category: typeof r.category === "string" ? r.category : null,
      };
    },
    async incidentCloseOut(auth: AuthContext, a): Promise<CloseOutResult> {
      const r = obj(await rpc(auth, "incident_close_out", { p_org: orgOf(auth), p_incident: a.incidentId, p_max: a.maxItems, p_notice: a.notice, p_propose: a.propose }, db));
      if (r.status !== "closed_out") return { status: "incident_open" };
      return {
        status: "closed_out",
        notified: typeof r.notified === "number" ? r.notified : 0,
        proposed: Array.isArray(r.proposed) ? r.proposed.filter((x): x is string => typeof x === "string") : [],
        refused: typeof r.refused === "string" ? r.refused : null,
        childrenOpen: typeof r.children_open === "number" ? r.children_open : 0,
      };
    },
    async notifyOncall(auth: AuthContext, a): Promise<number> {
      const n = await rpc(auth, "notify_oncall", { p_org: orgOf(auth), p_kind: a.kind, p_subject_type: a.subjectType, p_subject_id: a.subjectId, p_payload: a.payload, p_max: 20 }, db);
      return typeof n === "number" ? n : 0;
    },
    async recordParentRef(auth: AuthContext, a): Promise<void> {
      // Écriture conditionnelle : seulement si le ticket parent n'a pas encore de référence externe.
      const { error } = await serviceClient(auth, db).from("tickets")
        .update({ external_ref: a.ref, external_url: a.url, connector_id: a.connectorId })
        .eq("id", a.ticketId).eq("org_id", orgOf(auth)).is("external_ref", null);
      if (error) throw Errors.unavailable();
    },
  };
}
