import assert from "node:assert/strict";
import { OrgStateRow } from "../auth.ts";
import { AppError } from "../errors.ts";
import { fakeDb, fakeSupabase, makeAuth, makeCronAuth, makeCronOrgAuth, TEST_ORG } from "../testing.ts";
import { AutomationStore, GroupResult } from "./engine.ts";
import { PLATFORM_ROWS } from "./fixtures.ts";
import { AlertContext, RuleRow } from "./rules.ts";
import { AlertRef, alertsTick, followUpIncident, IncidentRef, supabaseTickSql, TickDeps, TickSql } from "./tick.ts";

const ORG_B = "999e4567-e89b-12d3-a456-426614174000";
const A1 = "aaaaaaaa-1111-4111-8111-111111111111";
const A2 = "aaaaaaaa-2222-4222-8222-222222222222";
const A3 = "aaaaaaaa-3333-4333-8333-333333333333";
const INC = "bbbbbbbb-2222-4222-8222-222222222222";

function sql(over: Partial<Record<keyof TickSql, unknown>> = {}, orgs: Record<string, OrgStateRow | null> = {}): TickSql & { readOrgs: string[] } {
  const readOrgs: string[] = [];
  const list = <T>(k: keyof TickSql, d: T[]) => () => Promise.resolve((over[k] as T[] | undefined) ?? d);
  return {
    readOrgs,
    confirmDue: list<AlertRef>("confirmDue", []),
    awaitingGrouping: list<AlertRef>("awaitingGrouping", []),
    recordSilence: list<AlertRef>("recordSilence", []),
    recentlyResolved: list<IncidentRef>("recentlyResolved", []),
    openFollowups: list<IncidentRef>("openFollowups", []),
    readOrg: (_c, id) => {
      readOrgs.push(id);
      return Promise.resolve(Object.hasOwn(orgs, id) ? orgs[id] : { state: "pilot", frozen: false, activated: true });
    },
  };
}

function store(o: { rows?: RuleRow[]; ctx?: AlertContext | null; group?: GroupResult; failOn?: string } = {}): AutomationStore & { calls: Array<[string, unknown, string | null]> } {
  const calls: Array<[string, unknown, string | null]> = [];
  const rec = <T>(name: string, auth: { orgId: string | null }, a: unknown, v: T): Promise<T> => {
    calls.push([name, a, auth.orgId]);
    if (o.failOn && (a as { alertId?: string })?.alertId === o.failOn) return Promise.reject(new Error("panne"));
    return Promise.resolve(v);
  };
  return {
    calls,
    rules: (auth, trigger) => rec("rules", auth, { trigger }, (o.rows ?? PLATFORM_ROWS).filter((r) => r.trigger_kind === trigger)),
    alertContext: (auth, alertId) => rec("context", auth, { alertId }, o.ctx === undefined ? { "conversations.same_category_15min": 0 } : o.ctx),
    claim: (auth, a) => rec("claim", auth, a, { decision: "executed" as const, maxItems: 100 }),
    note: (auth, a) => rec("note", auth, a, undefined),
    incidentGroup: (auth, a) => rec("group", auth, a, o.group ?? { status: "grouped" as const, incidentId: INC, created: false, parent: null, newChildren: [], notified: 1, severity: "major", category: "vpn" }),
    incidentCloseOut: (auth, a) => rec("closeOut", auth, a, { status: "incident_open" as const }),
    notifyOncall: (auth, a) => rec("oncall", auth, a, 1),
    recordParentRef: (auth, a) => rec("parent", auth, a, undefined),
  };
}

function deps(s: AutomationStore, q: TickSql, now: () => number = () => 0, budgetMs?: number): TickDeps {
  const db = fakeDb();
  return { store: s, sql: q, ticketing: { connectorFor: () => Promise.resolve(null) }, call: { db: db.deps }, db: db.deps, nowMs: now, budgetMs };
}

Deno.test("tâche : une alerte confirmée ET en attente n'est évaluée qu'une fois ; chaque organisation a son propre contexte", async () => {
  const s = store();
  const q = sql({ confirmDue: [{ alertId: A1, orgId: TEST_ORG }], awaitingGrouping: [{ alertId: A1, orgId: TEST_ORG }, { alertId: A2, orgId: ORG_B }] });
  const r = await alertsTick(await makeCronAuth(), deps(s, q));
  assert.equal(r.confirmed, 1);
  assert.equal(r.opened, 2);
  const contexts = s.calls.filter(([k]) => k === "context");
  assert.deepEqual(contexts.map(([, a, org]) => [(a as { alertId: string }).alertId, org]), [[A1, TEST_ORG], [A2, ORG_B]]);
  assert.deepEqual(q.readOrgs.sort(), [ORG_B, TEST_ORG].sort(), "l'état de chaque organisation est relu une fois");
});

Deno.test("tâche : organisation suspendue ou inconnue ignorée ; identifiants invalides écartés", async () => {
  const s = store();
  const q = sql({ awaitingGrouping: [{ alertId: A1, orgId: ORG_B }, { alertId: "x", orgId: TEST_ORG }, { alertId: A3, orgId: "pas-un-uuid" }] }, { [ORG_B]: { state: "suspended", frozen: false, activated: true } });
  await alertsTick(await makeCronAuth(), deps(s, q));
  assert.equal(s.calls.filter(([k]) => k === "rules").length, 0);
});

Deno.test("tâche : un élément en échec n'arrête pas les autres ; le budget de temps reporte le reste à la minute suivante", async () => {
  const s = store({ failOn: A1 });
  const r = await alertsTick(await makeCronAuth(), deps(s, sql({ awaitingGrouping: [{ alertId: A1, orgId: TEST_ORG }, { alertId: A2, orgId: TEST_ORG }] })));
  assert.equal(r.errors, 1);
  assert.ok(s.calls.some(([k, a]) => k === "context" && (a as { alertId: string }).alertId === A2));
  let t = 0;
  const slow = store();
  const late = await alertsTick(await makeCronAuth(), deps(slow, sql({ awaitingGrouping: [{ alertId: A1, orgId: TEST_ORG }, { alertId: A2, orgId: TEST_ORG }] }), () => (t += 30_000), 50_000));
  assert.equal(late.deferred, 1);
});

Deno.test("tâche : sources muettes, incidents résolus et suivi passent par leurs déclencheurs", async () => {
  const s = store({ ctx: { "alert.incident": INC, "incident.resolved": true, "alert.category": "vpn" } });
  const r = await alertsTick(await makeCronAuth(), deps(s, sql({
    recordSilence: [{ alertId: A1, orgId: TEST_ORG }],
    recentlyResolved: [{ incidentId: INC, alertId: A2, orgId: TEST_ORG }],
    openFollowups: [{ incidentId: INC, alertId: A3, orgId: TEST_ORG }],
  })));
  assert.deepEqual([r.silent, r.resolved, r.followups], [1, 1, 1]);
  const triggers = s.calls.filter(([k]) => k === "rules").map(([, a]) => (a as { trigger: string }).trigger);
  assert.deepEqual(triggers, ["alert.source_silent", "alert.resolved", "alert.opened"]);
});

Deno.test("tâche : seule une tâche planifiée authentique et sans organisation peut la lancer", async () => {
  const fail = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e instanceof AppError ? e.code : "autre";
    }
    return "aucune erreur";
  };
  assert.equal(await fail(alertsTick(await makeAuth({ org_role: "super_admin" }), deps(store(), sql()))), "forbidden");
  assert.equal(await fail(alertsTick(await makeCronOrgAuth(), deps(store(), sql()))), "forbidden");
  assert.equal(await fail(alertsTick({ ...(await makeCronAuth()) } as never, deps(store(), sql()))), "forbidden");
  assert.equal(await fail(supabaseTickSql(fakeSupabase(() => ({ data: [] })).deps).confirmDue(await makeCronOrgAuth())), "forbidden");
});

Deno.test("suivi d'un incident ouvert : seulement si la règle de regroupement est active et hors simulation ; gabarit fixe ; audité", async () => {
  const ref = { incidentId: INC, alertId: A1, orgId: TEST_ORG };
  const ctx: AlertContext = { "alert.incident": INC, "alert.category": "vpn" };
  const s = store({ ctx });
  const d = deps(s, sql());
  assert.equal(await followUpIncident(await makeCronOrgAuth(), ref, d), true);
  const group = s.calls.find(([k]) => k === "group");
  assert.deepEqual(group?.[1], { alertId: A1, maxItems: 100, notice: (await import("./templates.ts")).AUTOMATION_TEXTS.incidentOpened("vpn") });
  assert.ok((d.db as unknown as { inserts?: unknown }) !== undefined);
  // Simulation, règle désactivée, organisation gelée, alerte d'un autre incident, autre organisation : rien.
  const dry = store({ ctx, rows: [{ ...PLATFORM_ROWS[0], org_id: TEST_ORG, dry_run: true }] });
  assert.equal(await followUpIncident(await makeCronOrgAuth(), ref, deps(dry, sql())), false);
  assert.equal(dry.calls.filter(([k]) => k === "group").length, 0);
  const off = store({ ctx, rows: [{ ...PLATFORM_ROWS[0], org_id: TEST_ORG, enabled: false }] });
  assert.equal(await followUpIncident(await makeCronOrgAuth(), ref, deps(off, sql())), false);
  assert.equal(await followUpIncident(await makeCronOrgAuth({ frozen: true }), ref, deps(store({ ctx }), sql())), false);
  const other = store({ ctx: { "alert.incident": "cccccccc-3333-4333-8333-333333333333" } });
  assert.equal(await followUpIncident(await makeCronOrgAuth(), ref, deps(other, sql())), false);
  assert.equal(other.calls.filter(([k]) => k === "group").length, 0);
  await assert.rejects(followUpIncident(await makeCronOrgAuth(), { ...ref, orgId: ORG_B }, deps(store({ ctx }), sql())), (e: AppError) => e.code === "forbidden");
  // Rien de nouveau (aucune demande rattachée, personne à prévenir) : pas d'audit inutile.
  const nothing = store({ ctx, group: { status: "grouped", incidentId: INC, created: false, parent: null, newChildren: [], notified: 0 } });
  assert.equal(await followUpIncident(await makeCronOrgAuth(), ref, deps(nothing, sql())), false);
});

Deno.test("lectures de la tâche : état de l'organisation relu (arrêt d'urgence, activation) ; références mal formées écartées", async () => {
  const cron = await makeCronAuth();
  const db = fakeSupabase((op) => {
    if (op.table === "organizations") return { data: { state: "pilot", frozen_at: "2026-11-16T10:00:00Z", activated_at: null } };
    return { data: [{ alert_id: A1, org_id: TEST_ORG }, { alert_id: 42, org_id: TEST_ORG }, { incident_id: INC, alert_id: null, org_id: TEST_ORG }] };
  });
  const q = supabaseTickSql(db.deps);
  assert.deepEqual(await q.readOrg(cron, TEST_ORG), { state: "pilot", frozen: true, activated: false });
  assert.deepEqual(await q.confirmDue(cron), [{ alertId: A1, orgId: TEST_ORG }]);
  assert.deepEqual(await q.recentlyResolved(cron), []);
  assert.deepEqual(db.ops.filter((o) => o.method === "rpc").map((o) => [o.fn, o.args]), [["alerts_confirm_due", { p_limit: 200 }], ["incidents_recently_resolved", { p_limit: 200 }]]);
});
