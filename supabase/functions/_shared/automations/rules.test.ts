import assert from "node:assert/strict";
import { PLATFORM_ROWS } from "./fixtures.ts";
import { effectiveRows, evaluate, parseRule, Rule, RuleRow } from "./rules.ts";

const grouped = PLATFORM_ROWS[0];
function withDef(patch: Record<string, unknown>, row: RuleRow = grouped): RuleRow {
  return { ...row, definition: { ...(row.definition as Record<string, unknown>), ...patch } };
}
function rule(row: RuleRow): Rule {
  const p = parseRule(row);
  if (!p.ok) throw new Error(p.reason);
  return p.rule;
}

Deno.test("règles livrées : les trois règles « alerte » se lisent sans erreur", () => {
  for (const row of PLATFORM_ROWS) assert.equal(parseRule(row).ok, true, String(row.key));
  assert.equal(rule(grouped).limits.cooldownMinutes, 5);
  assert.equal(rule(PLATFORM_ROWS[1]).autonomy, 1);
});

Deno.test("lecture stricte : tout écart rend la règle invalide (elle n'agit pas)", () => {
  const bad: Array<[string, RuleRow]> = [
    ["champ inconnu", withDef({ all: [{ field: "alert.summary", op: "eq", value: "x" }] })],
    ["champ du prototype", withDef({ all: [{ field: "__proto__", op: "exists" }] })],
    ["opérateur inconnu", withDef({ all: [{ field: "alert.severity", op: "regex", value: ".*" }] })],
    ["type de valeur", withDef({ all: [{ field: "conversations.same_category_15min", op: "eq", value: "2" }] })],
    ["comparaison sur du texte", withDef({ all: [{ field: "alert.severity", op: "gte", value: 2 }] })],
    ["liste non textuelle", withDef({ all: [{ field: "alert.severity", op: "in", value: [1, 2] }] })],
    ["liste vide", withDef({ all: [{ field: "alert.severity", op: "in", value: [] }] })],
    ["clé de condition en trop", withDef({ all: [{ field: "alert.severity", op: "eq", value: "major", script: "x" }] })],
    ["« exists » avec valeur", withDef({ all: [{ field: "alert.incident", op: "exists", value: "x" }] })],
    ["clé de définition en trop", withDef({ code: "process.exit()" })],
    ["« any » vide", withDef({ any: [] })],
    ["trop de conditions", withDef({ all: Array.from({ length: 11 }, () => ({ field: "alert.confirmed", op: "eq", value: true })) })],
    ["action inconnue", withDef({ action: { kind: "delete_user", params: {} } })],
    ["clé d'action en trop", withDef({ action: { kind: "notify_oncall", params: {}, target: "x" } })],
    ["paramètre objet", withDef({ action: { kind: "group_into_incident", params: { notify_users: { a: 1 } } } })],
    ["plafond absent", withDef({ limits: { maxRunsPerHour: 20, maxItemsPerRun: 100 } })],
    ["plafond hors bornes", withDef({ limits: { maxRunsPerHour: 0, maxItemsPerRun: 100, cooldownMinutes: 5 } })],
    ["plafond non entier", withDef({ limits: { maxRunsPerHour: 1.5, maxItemsPerRun: 100, cooldownMinutes: 5 } })],
    ["autonomie 1 sur une action qui agit", { ...grouped, autonomy: 1 }],
    ["autonomie 2", { ...grouped, autonomy: 2 }],
    ["déclencheur inconnu", { ...grouped, trigger_kind: "alert.deleted" }],
    ["clé invalide", { ...grouped, key: "Incident Groupé" }],
    ["version", { ...grouped, version: 0 }],
    ["état non booléen", { ...grouped, enabled: "true" }],
    ["définition non objet", { ...grouped, definition: "[]" }],
  ];
  for (const [label, row] of bad) assert.equal(parseRule(row).ok, false, label);
});

Deno.test("évaluation : toutes les conditions de « all », une de « any » ; les champs en échec sont nommés", () => {
  const r = rule(grouped);
  const ctx = { "alert.severity": "critical", "alert.attachment": "attached", "conversations.same_category_15min": 2 } as const;
  assert.deepEqual(evaluate(r, ctx), { matched: true, failed: [] });
  assert.deepEqual(evaluate(r, { ...ctx, "alert.severity": "warning", "conversations.same_category_15min": 1 }), {
    matched: false, failed: ["alert.severity", "conversations.same_category_15min"],
  });
  // Champ absent du contexte : la condition est fausse (jamais « vraie par défaut »).
  assert.equal(evaluate(r, { "alert.severity": "critical", "alert.attachment": "attached" }).matched, false);
  const withAny = rule(withDef({ any: [{ field: "alert.category", op: "eq", value: "vpn" }, { field: "alert.category", op: "eq", value: "teams" }] }));
  assert.equal(evaluate(withAny, { ...ctx, "alert.category": "teams" }).matched, true);
  assert.deepEqual(evaluate(withAny, { ...ctx, "alert.category": "printer" }).failed, ["any"]);
});

Deno.test("évaluation : « exists » exige une valeur, « neq » une valeur présente, comparaisons numériques seulement sur des nombres", () => {
  const resolved = rule(PLATFORM_ROWS[1]);
  assert.equal(evaluate(resolved, { "alert.incident": "x", "incident.resolved": true }).matched, true);
  assert.equal(evaluate(resolved, { "alert.incident": null, "incident.resolved": true }).matched, false);
  assert.equal(evaluate(resolved, { "alert.incident": "", "incident.resolved": true }).matched, false);
  assert.equal(evaluate(resolved, { "alert.incident": "x", "incident.resolved": false }).matched, false);
  const neq = rule(withDef({ all: [{ field: "alert.state", op: "neq", value: "resolved" }] }));
  assert.equal(evaluate(neq, {}).matched, false);
  assert.equal(evaluate(neq, { "alert.state": null }).matched, false, "une valeur nulle n'est pas « différente » : elle est inconnue");
  assert.equal(evaluate(neq, { "alert.state": "open" }).matched, true);
  const lte = rule(withDef({ all: [{ field: "conversations.same_category_15min", op: "lte", value: 3 }] }));
  assert.equal(evaluate(lte, { "conversations.same_category_15min": 3 }).matched, true);
  assert.equal(evaluate(lte, { "conversations.same_category_15min": "1" as never }).matched, false);
});

Deno.test("règles effectives : la copie de l'organisation l'emporte ; la règle d'une AUTRE organisation n'est jamais prise", () => {
  const ORG = "223e4567-e89b-12d3-a456-426614174000";
  const OTHER = "999e4567-e89b-12d3-a456-426614174000";
  const rows = effectiveRows([
    grouped,
    { ...grouped, org_id: OTHER, enabled: false },
    { ...grouped, org_id: ORG, dry_run: true },
    PLATFORM_ROWS[2],
    { ...PLATFORM_ROWS[2], org_id: OTHER, key: "regle-autre-client" },
  ], ORG);
  assert.deepEqual(rows.map((r) => [r.key, r.org_id, r.dry_run]), [["incident-grouped", ORG, true], ["source-silent", null, false]]);
});
