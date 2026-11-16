import assert from "node:assert/strict";
import { DemoConnector } from "../connectors/demo.ts";
import { fakeDb, fakeSupabase, makeAuth, Op, Reply, TEST_ORG } from "../testing.ts";
import { diagnosticSummary, mirrorTicket } from "./mirror.ts";
import type { MirrorTicket } from "./types.ts";

const T: MirrorTicket = { ticketId: "t-1", conversationId: "conv-1", title: "Imprimante : ne répond plus", category: "printer", priority: "normal", body: "Mon imprimante est hors ligne", security: false, diagnostic: { reason: "mode_ombre", intent: "incident" } };
const has = (op: Op, kind: string, col: string, val?: unknown) => op.filters.some(([k, c, v]) => k === kind && c === col && (val === undefined || JSON.stringify(v) === JSON.stringify(val)));

function setup(row: unknown, over: { connector?: DemoConnector | null; requester?: string | null; updateError?: unknown } = {}) {
  const f = fakeSupabase((op: Op): Reply => (op.method === "select" ? { data: row, error: null } : { data: null, error: over.updateError ?? null }));
  const connector = over.connector === undefined ? new DemoConnector("conn-demo") : over.connector;
  let lookups = 0;
  const deps = {
    connectorFor: () => { lookups++; return Promise.resolve(connector); },
    requesterOf: () => Promise.resolve(over.requester === undefined ? "marie@client.exemple.fr" : over.requester),
    call: { db: fakeDb().deps },
    db: f.deps,
  };
  return { f, connector, deps, lookups: () => lookups };
}

Deno.test("copie : crée le ticket dans le connecteur, puis enregistre la référence externe (conditionnellement, pour CETTE organisation)", async () => {
  const auth = await makeAuth({ org_role: "end_user" });
  const s = setup({ external_ref: null });
  await mirrorTicket(auth, T, s.deps);
  assert.ok(has(s.f.ops[0], "eq", "id", "t-1") && has(s.f.ops[0], "eq", "org_id", TEST_ORG), "lecture filtrée par ticket ET organisation");
  const update = s.f.ops[1];
  assert.deepEqual(update.payload, { external_ref: "DEMO-1", external_url: "https://demo.invalid/tickets/DEMO-1", connector_id: "conn-demo" });
  assert.ok(has(update, "eq", "id", "t-1") && has(update, "eq", "org_id", TEST_ORG) && has(update, "is", "external_ref", null), "conditionnelle : jamais deux copies");
  const created = await s.connector!.invokeCapability("ticket.get", { ref: "DEMO-1" }, { orgId: "o", connectorId: "c", requestId: "r", actor: { kind: "system", reason: "cron" } });
  assert.equal(created.title, T.title);
});

Deno.test("copie : idempotente (déjà copié = rien), sans connecteur = rien, ticket d'une autre organisation = rien", async () => {
  const auth = await makeAuth({ org_role: "end_user" });
  const done = setup({ external_ref: "42" });
  await mirrorTicket(auth, T, done.deps);
  assert.equal(done.lookups(), 0, "aucune recherche de connecteur pour un ticket déjà copié");
  assert.equal(done.f.ops.length, 1);
  const none = setup({ external_ref: null }, { connector: null });
  await mirrorTicket(auth, T, none.deps);
  assert.equal(none.f.ops.length, 1, "aucune écriture sans connecteur");
  const foreign = setup(null);
  await mirrorTicket(auth, T, foreign.deps);
  assert.equal(foreign.lookups(), 0);
});

Deno.test("copie : le demandeur vient de l'annuaire (« inconnu » sinon) ; seuls le message MASQUÉ et un résumé fixe sortent", async () => {
  const auth = await makeAuth({ org_role: "end_user" });
  const seen: Array<{ body: string; requesterRef: string; diagnosticSummary?: string }> = [];
  const s = setup({ external_ref: null }, { requester: null });
  const connector = s.connector!;
  const orig = connector.invokeCapability.bind(connector);
  (connector as { invokeCapability: unknown }).invokeCapability = (n: string, p: { body: string; requesterRef: string; diagnosticSummary?: string }, c: unknown) => { seen.push(p); return (orig as (...a: unknown[]) => unknown)(n, p, c); };
  await mirrorTicket(auth, { ...T, body: "Mon mot de passe est [MASQUÉ]", diagnostic: { reason: "x", triage: { texte: "contenu libre du salarié" }, signals: ["a"], secret: "jeton-a-ne-pas-copier", flags: ["X2"] } }, s.deps);
  assert.equal(seen[0].requesterRef, "inconnu");
  assert.equal(seen[0].body, "Mon mot de passe est [MASQUÉ]");
  assert.ok(!JSON.stringify(seen[0]).includes("contenu libre") && !JSON.stringify(seen[0]).includes("jeton-a-ne-pas-copier"));
  assert.match(seen[0].diagnosticSummary ?? "", /reason : x/);
  assert.match(seen[0].diagnosticSummary ?? "", /flags : X2/);
});

Deno.test("diagnosticSummary : liste fermée de clés, valeurs courtes, rien d'autre", () => {
  assert.equal(diagnosticSummary({}), "");
  assert.equal(diagnosticSummary({ reason: "a".repeat(200), triage: { x: 1 }, intent: null, step: 5, gate: true }), `reason : ${"a".repeat(80)}\nstep : 5\ngate : true`);
  assert.equal(diagnosticSummary({ flags: ["X2", 3] }), "");
  assert.ok(diagnosticSummary({ reason: "x".repeat(79), step: "y".repeat(79), gate: "z".repeat(79), prepared: "p".repeat(79), requested_action: "q".repeat(79), not_prepared_reason: "n".repeat(79), flags: ["f".repeat(50)] }).length <= 1500);
});

Deno.test("copie : une panne du connecteur ou une organisation gelée ne créent rien et n'enregistrent rien ; l'erreur remonte (l'orchestrateur l'absorbe)", async () => {
  const auth = await makeAuth({ org_role: "end_user" });
  const broken = new DemoConnector("conn-demo");
  (broken as { invokeCapability: unknown }).invokeCapability = () => Promise.reject(new Error("GLPI muet"));
  const s = setup({ external_ref: null }, { connector: broken });
  await assert.rejects(() => mirrorTicket(auth, T, s.deps));
  assert.equal(s.f.ops.length, 1, "aucune écriture de référence");
  const frozen = await makeAuth({ org_role: "end_user", is_frozen: true });
  const f2 = setup({ external_ref: null });
  await assert.rejects(() => mirrorTicket(frozen, T, f2.deps), { code: "org_frozen" });
  assert.equal(f2.f.ops.length, 1);
});

Deno.test("copie : échec de l'écriture de la référence = erreur (le ticket reste copié côté GLPI, la prochaine tentative est sans effet grâce à la condition)", async () => {
  const auth = await makeAuth({ org_role: "end_user" });
  const s = setup({ external_ref: null }, { updateError: { message: "base muette" } });
  await assert.rejects(() => mirrorTicket(auth, T, s.deps), { code: "service_unavailable" });
});
