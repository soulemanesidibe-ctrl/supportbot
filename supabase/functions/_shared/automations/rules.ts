// Règles d'automatisation (spec § 12) : lecture STRICTE de la définition stockée et évaluation DÉTERMINISTE des conditions.
// Les conditions portent sur un contexte typé et fixe (champs de l'alerte, compteurs calculés par la base), jamais sur du texte libre ni
// sur du code. Le modèle de langage ne participe à rien ici : il ne décide jamais si une action est exécutée.

export const TRIGGER_KINDS = ["alert.opened", "alert.resolved", "alert.source_silent", "conversation.message", "m365.service_degraded"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** Ensemble FERMÉ : ajouter une action = modifier le moteur ET le modèle de menace (la base refuse aussi toute autre valeur). */
export const RULE_ACTIONS = ["group_into_incident", "notify_users", "notify_oncall", "propose_close_children", "create_security_ticket", "suppress"] as const;
export type RuleActionKind = (typeof RULE_ACTIONS)[number];

export const OPS = ["eq", "neq", "gte", "lte", "in", "exists"] as const;
export type Op = (typeof OPS)[number];

/** Champs du contexte des règles « alerte » et leur type. Tout autre champ rend la règle invalide (elle n'agit pas). */
export const ALERT_FIELDS = {
  "alert.severity": "string",
  "alert.attachment": "string",
  "alert.category": "string",
  "alert.state": "string",
  "alert.synthetic": "boolean",
  "alert.confirmed": "boolean",
  "alert.incident": "string",
  "incident.resolved": "boolean",
  "conversations.same_category_15min": "number",
} as const;
export type AlertField = keyof typeof ALERT_FIELDS;
export type FieldType = (typeof ALERT_FIELDS)[AlertField];

/** Vrai si la valeur a le type attendu du champ (sans conversion : « 2 » n'est pas 2). */
export function hasType(v: unknown, t: FieldType): v is string | number | boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
  }
}
export type AlertContext = Readonly<Partial<Record<AlertField, string | number | boolean | null>>>;

export interface Condition {
  readonly field: AlertField;
  readonly op: Op;
  readonly value?: string | number | boolean | readonly string[];
}

export interface Limits { readonly maxRunsPerHour: number; readonly maxItemsPerRun: number; readonly cooldownMinutes: number }

export interface Rule {
  readonly key: string;
  readonly version: number;
  readonly orgCopy: boolean;
  readonly enabled: boolean;
  readonly dryRun: boolean;
  readonly autonomy: 0 | 1;
  readonly locked: boolean;
  readonly trigger: TriggerKind;
  readonly all: readonly Condition[];
  readonly any: readonly Condition[] | null;
  readonly action: { readonly kind: RuleActionKind; readonly params: Readonly<Record<string, string | number>> };
  readonly limits: Limits;
}

/** Ligne de la table automation_rules. */
export interface RuleRow {
  org_id: string | null;
  key: unknown;
  version: unknown;
  enabled: unknown;
  dry_run: unknown;
  autonomy: unknown;
  locked: unknown;
  trigger_kind: unknown;
  definition: unknown;
}

export type ParseResult = { ok: true; rule: Rule } | { ok: false; reason: string };

const KEY = /^[a-z0-9-]{3,60}$/;
const MAX_CONDITIONS = 10;

function plain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function parseCondition(c: unknown): Condition | null {
  if (!plain(c)) return null;
  for (const k of Object.keys(c)) if (k !== "field" && k !== "op" && k !== "value") return null;
  const { field, op, value } = c;
  if (typeof field !== "string" || !Object.hasOwn(ALERT_FIELDS, field)) return null;
  if (typeof op !== "string" || !(OPS as readonly string[]).includes(op)) return null;
  const type = ALERT_FIELDS[field as AlertField];
  switch (op as Op) {
    case "exists":
      return value === undefined ? { field: field as AlertField, op: "exists" } : null;
    case "eq":
    case "neq":
      return hasType(value, type) ? { field: field as AlertField, op: op as Op, value } : null;
    case "gte":
    case "lte":
      return type === "number" && typeof value === "number" && Number.isFinite(value) ? { field: field as AlertField, op: op as Op, value } : null;
    case "in":
      return type === "string" && Array.isArray(value) && value.length >= 1 && value.length <= 20 && value.every((x) => typeof x === "string" && x.length <= 60)
        ? { field: field as AlertField, op: "in", value: Object.freeze([...value] as string[]) }
        : null;
  }
}

function parseConditions(v: unknown): Condition[] | null {
  if (!Array.isArray(v) || v.length > MAX_CONDITIONS) return null;
  const out: Condition[] = [];
  for (const c of v) {
    const p = parseCondition(c);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/** Lecture stricte : toute valeur inattendue rend la règle invalide (elle n'agit pas, l'erreur est inscrite au registre). */
export function parseRule(row: RuleRow): ParseResult {
  const bad = (reason: string): ParseResult => ({ ok: false, reason });
  if (typeof row.key !== "string" || !KEY.test(row.key)) return bad("cle");
  if (!intIn(row.version, 1, 1_000_000)) return bad("version");
  if (typeof row.enabled !== "boolean" || typeof row.dry_run !== "boolean" || typeof row.locked !== "boolean") return bad("etat");
  if (row.autonomy !== 0 && row.autonomy !== 1) return bad("autonomie");
  if (typeof row.trigger_kind !== "string" || !(TRIGGER_KINDS as readonly string[]).includes(row.trigger_kind)) return bad("declencheur");
  const d = row.definition;
  if (!plain(d)) return bad("definition");
  for (const k of Object.keys(d)) if (!["all", "any", "action", "limits"].includes(k)) return bad("definition");
  const all = parseConditions(d.all);
  if (!all) return bad("conditions");
  let any: Condition[] | null = null;
  if (d.any !== undefined) {
    any = parseConditions(d.any);
    if (!any || any.length === 0) return bad("conditions");
  }
  const a = d.action;
  if (!plain(a) || typeof a.kind !== "string" || !(RULE_ACTIONS as readonly string[]).includes(a.kind)) return bad("action");
  for (const k of Object.keys(a)) if (k !== "kind" && k !== "params") return bad("action");
  const params: Record<string, string | number> = {};
  if (a.params !== undefined) {
    if (!plain(a.params) || Object.keys(a.params).length > 10) return bad("parametres");
    for (const [k, v] of Object.entries(a.params)) {
      if (!/^[a-z_]{1,40}$/.test(k) || !((typeof v === "string" && v.length <= 60) || (typeof v === "number" && Number.isFinite(v)))) return bad("parametres");
      params[k] = v;
    }
  }
  // Seule une action qui PRÉPARE une demande à valider peut être d'autonomie 1 (même règle que la base).
  if (row.autonomy === 1 && a.kind !== "propose_close_children") return bad("autonomie");
  const l = d.limits;
  if (!plain(l) || !intIn(l.maxRunsPerHour, 1, 1000) || !intIn(l.maxItemsPerRun, 1, 500) || !intIn(l.cooldownMinutes, 0, 1440)) return bad("plafonds");
  return {
    ok: true,
    rule: Object.freeze({
      key: row.key,
      version: row.version,
      orgCopy: row.org_id !== null,
      enabled: row.enabled,
      dryRun: row.dry_run,
      autonomy: row.autonomy,
      locked: row.locked,
      trigger: row.trigger_kind as TriggerKind,
      all,
      any,
      action: Object.freeze({ kind: a.kind as RuleActionKind, params: Object.freeze(params) }),
      limits: Object.freeze({ maxRunsPerHour: l.maxRunsPerHour, maxItemsPerRun: l.maxItemsPerRun, cooldownMinutes: l.cooldownMinutes }),
    }),
  };
}

/** Copie de l'organisation, sinon modèle de la plateforme, pour chaque clé. */
export function effectiveRows(rows: readonly RuleRow[], orgId: string): RuleRow[] {
  const byKey = new Map<string, RuleRow>();
  for (const r of rows) {
    if (r.org_id !== null && r.org_id !== orgId) continue; // défense en profondeur : jamais la règle d'une autre organisation
    const k = String(r.key);
    const cur = byKey.get(k);
    if (!cur || (cur.org_id === null && r.org_id !== null)) byKey.set(k, r);
  }
  return [...byKey.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function holds(c: Condition, ctx: AlertContext): boolean {
  if (!Object.hasOwn(ctx, c.field)) return false;
  const v = ctx[c.field];
  switch (c.op) {
    case "exists":
      return v !== null && v !== undefined && v !== "";
    case "eq":
      return v === c.value;
    case "neq":
      return v !== null && v !== undefined && v !== c.value;
    case "gte":
      return typeof v === "number" && v >= (c.value as number);
    case "lte":
      return typeof v === "number" && v <= (c.value as number);
    case "in":
      return typeof v === "string" && (c.value as readonly string[]).includes(v);
  }
}

/** Toutes les conditions de « all », et au moins une de « any » si présent. Rend aussi les champs des conditions non remplies. */
export function evaluate(rule: Rule, ctx: AlertContext): { matched: boolean; failed: string[] } {
  const failed: string[] = rule.all.filter((c) => !holds(c, ctx)).map((c) => c.field);
  if (rule.any && !rule.any.some((c) => holds(c, ctx))) failed.push("any");
  return { matched: failed.length === 0, failed };
}
