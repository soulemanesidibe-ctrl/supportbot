import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { fakeSupabase as fake, makeAuth, Op, TEST_ORG, TEST_USER } from "../testing.ts";
import { guardErrorMessage, supabaseActionStore } from "./store.ts";
import { ACTION_ID, HASH } from "./test_rig.ts";

const has = (op: Op, kind: string, col: string, val: unknown) => op.filters.some(([k, c, v]) => k === kind && c === col && JSON.stringify(v) === JSON.stringify(val));
async function err(p: Promise<unknown>): Promise<AppError | null> {
  try { await p; } catch (e) { return e as AppError; }
  return null;
}

Deno.test("refus de la base : traduits en motifs français, le texte brut n'est JAMAIS renvoyé", () => {
  const cases: Array<[string, string]> = [
    ["Auto-validation interdite (I2)", "propre compte"],
    ["Un valideur ne valide pas une action sur son propre compte (I2)", "propre compte"],
    ["Vérification d'identité hors bande obligatoire, faite par le valideur (SEC-12)", "vérification d'identité"],
    ["L'empreinte validée ne correspond pas à l'action (M12)", "a changé"],
    ["Ce valideur n'est pas éligible pour cette catégorie (chaîne vide...)", "éligible"],
    ["Le valideur n'est plus éligible au moment de l'exécution (I5)", "éligible"],
    ["La délégation déclarée n'est pas valide pour cette validation (I7)", "délégation"],
    ["Demande expirée : rien ne s'exécute (I8)", "expiré"],
    ["Organisation gelée : validation impossible (SEC-28)", "arrêt d'urgence"],
    ["Transition interdite : succeeded vers approved", "état"],
    ["quelque chose d'imprévu avec password=SuperSecret99", "sécurité"],
  ];
  for (const [raw, expected] of cases) {
    const m = guardErrorMessage(raw);
    assert.ok(m.includes(expected), `${raw} → ${m}`);
    assert.ok(!m.includes("SuperSecret99") && !/\(I\d|SEC-|M12/.test(m), "aucun code interne ni texte brut");
  }
});

Deno.test("transitions : écriture CONDITIONNELLE sur l'état attendu et l'organisation ; zéro ligne touchée = conflit (deux validations simultanées)", async () => {
  const { deps, ops } = fake(() => ({ data: [] }));
  const store = supabaseActionStore(deps);
  const e = await err(store.markExecuting(await makeAuth(), ACTION_ID));
  assert.equal(e?.code, "conflict");
  const op = ops[0];
  assert.ok(has(op, "eq", "id", ACTION_ID) && has(op, "eq", "org_id", TEST_ORG) && has(op, "eq", "status", "approved"));
  assert.deepEqual(op.payload, { status: "executing" });
});

Deno.test("approbation : enregistre l'identité vérifiée PAR LE VALIDEUR LUI-MÊME, l'empreinte vue et la délégation ; filtré sur « pending_approval »", async () => {
  const { deps, ops } = fake(() => ({ data: [{ id: ACTION_ID }] }));
  await supabaseActionStore(deps).approve(await makeAuth(), ACTION_ID, { approvedHash: HASH, identityMethod: "in_person", viaDelegationId: "eeeeeeee-0000-4000-8000-000000000001" });
  const op = ops[0];
  assert.ok(has(op, "eq", "status", "pending_approval") && has(op, "eq", "org_id", TEST_ORG));
  const p = op.payload as Record<string, unknown>;
  const check = p.identity_check as Record<string, unknown>;
  assert.deepEqual({ status: p.status, approver: p.approver_id, hash: p.approved_hash, via: p.approved_via_delegation_id, method: check.method, by: check.performed_by, at: typeof check.at },
    { status: "approved", approver: TEST_USER, hash: HASH, via: "eeeeeeee-0000-4000-8000-000000000001", method: "in_person", by: TEST_USER, at: "string" });
});

Deno.test("refus du déclencheur : devient une erreur 403 « Opération refusée : <motif> », sans le texte brut de la base", async () => {
  const { deps } = fake(() => ({ error: { message: "Auto-validation interdite (I2) pour u@exemple.test" } }));
  const e = await err(supabaseActionStore(deps).approve(await makeAuth(), ACTION_ID, { approvedHash: HASH, identityMethod: "callback", viaDelegationId: null }));
  assert.equal(e?.status, 403);
  assert.ok(e?.message.startsWith("Opération refusée : "));
  assert.ok(!e?.message.includes("exemple.test") && !e?.message.includes("(I2)"));
});

Deno.test("refus : motif en clair enregistré, état « pending_approval » exigé ; motif inconnu refusé sans requête", async () => {
  const { deps, ops } = fake(() => ({ data: [{ id: ACTION_ID }] }));
  const store = supabaseActionStore(deps);
  await store.reject(await makeAuth(), ACTION_ID, "mauvaise_cible");
  assert.deepEqual(ops[0].payload, { status: "rejected", reason: "Mauvaise cible" });
  assert.ok(has(ops[0], "eq", "status", "pending_approval"));
  assert.equal((await err(store.reject(await makeAuth(), ACTION_ID, "parce que" as never)))?.code, "bad_request");
  assert.equal(ops.length, 1);
});

Deno.test("création : cible et empreinte laissées à la BASE, jamais fournies par le code ; une demande identique déjà ouverte est reprise", async () => {
  const first = fake(() => ({ data: { id: ACTION_ID } }));
  await supabaseActionStore(first.deps).insert(await makeAuth(), { conversationId: "conv-1", capability: "user.unlock", directoryUserId: "dir-1", riskFlags: ["X2"] });
  const payload = first.ops[0].payload as Record<string, unknown>;
  assert.deepEqual(payload, { org_id: TEST_ORG, conversation_id: "conv-1", capability: "user.unlock", target_directory_user_id: "dir-1", params: {}, requested_by_kind: "agent", risk_flags: ["X2"] });
  assert.ok(!("params_hash" in payload) && !("target_ref" in payload) && !("status" in payload) && !("requester_user_id" in payload));

  const dup = fake((op) => (op.method === "insert" ? { error: { code: "23505", message: "doublon" } } : { data: [{ id: "act-existante" }] }));
  assert.equal((await supabaseActionStore(dup.deps).insert(await makeAuth(), { conversationId: "conv-1", capability: "user.unlock", directoryUserId: "dir-1", riskFlags: [] })).id, "act-existante");
  const other = fake(() => ({ error: { code: "P0001", message: "Niveau d'autonomie 0" } }));
  assert.equal((await err(supabaseActionStore(other.deps).insert(await makeAuth(), { conversationId: "c", capability: "user.unlock", directoryUserId: "d", riskFlags: [] })))?.code, "service_unavailable");
});

Deno.test("niveau d'autonomie : « 1 » seulement ; absent, 0 ou toute autre valeur (le niveau 2 n'existe pas) = 0", async () => {
  for (const [row, expected] of [[{ level: 1 }, 1], [{ level: 0 }, 0], [{ level: 2 }, 0], [{ level: "1; drop" }, 0], [null, 0]] as Array<[unknown, number]>) {
    assert.equal(await supabaseActionStore(fake(() => ({ data: row })).deps).autonomyLevel(await makeAuth(), "accounts"), expected, JSON.stringify(row));
  }
});

Deno.test("annuaire : retrouve le salarié par son compte, rattache la conversation UNE fois ; absent = null", async () => {
  const { deps, ops } = fake((op) => (op.table === "directory_users" ? { data: { id: "dir-1", email: "marie@client-alpha.test" } } : {}));
  const r = await supabaseActionStore(deps).directoryUserFor(await makeAuth(), "conv-1");
  assert.deepEqual(r, { id: "dir-1", email: "marie@client-alpha.test" });
  assert.ok(has(ops[0], "eq", "linked_user_id", TEST_USER) && has(ops[0], "eq", "org_id", TEST_ORG) && has(ops[0], "eq", "active", true));
  const upd = ops.find((o) => o.table === "conversations")!;
  assert.deepEqual(upd.payload, { directory_user_id: "dir-1" });
  assert.ok(has(upd, "is", "directory_user_id", undefined) || upd.filters.some(([k, c]) => k === "is" && c === "directory_user_id"), "seulement si pas déjà rattachée");
  assert.ok(has(upd, "eq", "requester_user_id", TEST_USER));
  assert.equal(await supabaseActionStore(fake(() => ({ data: null })).deps).directoryUserFor(await makeAuth(), "conv-1"), null);
});

Deno.test("compte Microsoft : lien du technicien ACTUEL, non révoqué, et locataire du connecteur ; l'un des deux manque = aucune liaison", async () => {
  const both = fake((op) => (op.table === "microsoft_identities" ? { data: { object_id: "oid-1" } } : { data: { tenant_id: "tid-1" } }));
  assert.deepEqual(await supabaseActionStore(both.deps).microsoftBinding(await makeAuth(), "conn-1"), { tenantId: "tid-1", objectId: "oid-1" });
  const ident = both.ops.find((o) => o.table === "microsoft_identities")!;
  assert.ok(has(ident, "eq", "user_id", TEST_USER) && has(ident, "eq", "connector_id", "conn-1") && ident.filters.some(([k, c]) => k === "is" && c === "revoked_at"));
  const noIdent = fake((op) => (op.table === "microsoft_identities" ? { data: null } : { data: { tenant_id: "tid-1" } }));
  assert.equal(await supabaseActionStore(noIdent.deps).microsoftBinding(await makeAuth(), "conn-1"), null);
  const noTenant = fake((op) => (op.table === "microsoft_identities" ? { data: { object_id: "oid-1" } } : { data: { tenant_id: null } }));
  assert.equal(await supabaseActionStore(noTenant.deps).microsoftBinding(await makeAuth(), "conn-1"), null);
});

Deno.test("lecture d'une action : filtrée par identifiant ET organisation", async () => {
  const { deps, ops } = fake(() => ({ data: null }));
  assert.equal(await supabaseActionStore(deps).load(await makeAuth(), ACTION_ID), null);
  assert.ok(has(ops[0], "eq", "id", ACTION_ID) && has(ops[0], "eq", "org_id", TEST_ORG));
});
