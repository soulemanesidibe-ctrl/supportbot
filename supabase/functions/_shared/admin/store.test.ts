// Magasin Supabase de `admin` : chaque écriture est filtrée par l'organisation du CONTEXTE (jamais par un identifiant du corps seul),
// conditionnelle, et les refus de la base sont traduits en messages fixes (le texte brut d'une erreur de base ne sort jamais).
import assert from "node:assert/strict";
import { requireOrgMember, requireUser } from "../auth.ts";
import { AuthContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { fakeSupabase, makeAuth, Op, Reply, TEST_ORG, TEST_USER, testAuthDeps, testRequest } from "../testing.ts";
import { fail, supabaseAdminStore } from "./store.ts";

const OTHER = "423e4567-e89b-12d3-a456-426614174000";
const REL = "323e4567-e89b-12d3-a456-426614174000";
const NOW_S = 1_800_000_000;
const MFA_ISO = new Date((NOW_S - 30) * 1000).toISOString();

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}
function store(respond: (op: Op) => Reply) {
  const f = fakeSupabase(respond);
  return { s: supabaseAdminStore(f.deps), ops: f.ops };
}
const has = (op: Op, kind: string, col: string, val?: unknown) =>
  op.filters.some(([k, c, v]) => k === kind && c === col && (val === undefined || JSON.stringify(v) === JSON.stringify(val)));
const ok = (data: unknown = [{ id: "x" }]): Reply => ({ data, error: null });

Deno.test("fail : chaque refus connu de la base devient une erreur publique FIXE ; l'inconnu devient un refus générique ; une panne devient 503", () => {
  const known: Array<[string, string]> = [
    ["Un second facteur de moins de 10 minutes est exigé", "mfa_required"],
    ["Plafond de clients atteint (10)", "conflict"],
    ["Organisation gelée : aucune création", "org_frozen"],
    ["Invitation invalide ou expirée", "bad_request"],
    ["Vous êtes déjà membre de cette organisation", "conflict"],
    ["Impossible de retirer le dernier administrateur de l'organisation (R9)", "conflict"],
    ["Les rôles approuvés ne peuvent que diminuer : une extension exige une nouvelle approbation du client", "forbidden"],
    ["Impossible d'assigner un technicien sur une relation qui n'est pas active", "conflict"],
    ["Le technicien assigné doit être un technicien actif de l'ESN", "conflict"],
    ["Barres de passage non atteintes (ou moins de 300 réponses notées) : ouverture refusée sans décision motivée", "conflict"],
    ["Un NOUVEAU motif est obligatoire pour fermer ou réduire une catégorie", "bad_request"],
    ["Le niveau 1 exige un client activé et non gelé", "conflict"],
    ["Droits insuffisants pour cette organisation", "forbidden"],
    ["Seul un administrateur de l'ESN peut créer un client", "forbidden"],
  ];
  for (const [message, code] of known) assert.equal(fail({ code: "P0001", message }).code, code, message);
  const unknown = fail({ code: "P0001", message: "table secrète public.organizations colonne client_cap = 7 dans /var/lib" });
  assert.equal(unknown.code, "forbidden");
  assert.equal(unknown.message, "Opération refusée par les contrôles de sécurité.");
  for (const [code, expected] of [["23505", "conflict"], ["42501", "forbidden"], ["23503", "bad_request"], ["23514", "bad_request"], ["22P02", "bad_request"], ["08006", "service_unavailable"], ["", "service_unavailable"]] as const) {
    const e = fail({ code, message: "duplicate key value violates unique constraint \"organizations_slug_key\" Detail: Key (slug)=(secret)" });
    assert.equal(e.code, expected, code);
    assert.ok(!/organizations|slug|secret|violates|Detail/i.test(e.message), `message public sans détail interne : ${e.message}`);
  }
  assert.equal(fail(null).code, "service_unavailable");
  assert.equal(fail(undefined).code, "service_unavailable");
});

Deno.test("appels SQL : acteur, organisation et second facteur viennent du CONTEXTE vérifié ; sans horodatage de second facteur, rien n'est appelé", async () => {
  const auth = await makeAuth({ org_role: "partner_admin", via: "member" });
  const { s, ops } = store(() => ok({ client_org_id: "c", relationship_id: "r", invitation_id: "i", cancelled_actions: 3, assignments: 1 }));
  await s.createClient(auth, { name: "Client G", slug: "client-g", adminEmail: "a@g.test", tokenHash: "h".repeat(64) });
  await s.offboardTechnician(auth, OTHER);
  const freeze = await s.setFreeze(auth, true);
  assert.deepEqual(ops.map((o) => [o.method, o.fn]), [["rpc", "admin_create_client"], ["rpc", "admin_offboard_technician"], ["rpc", "admin_set_freeze"]]);
  assert.deepEqual(ops[0].args, { p_actor: TEST_USER, p_partner_org: TEST_ORG, p_name: "Client G", p_slug: "client-g", p_admin_email: "a@g.test", p_token_hash: "h".repeat(64), p_mfa_at: MFA_ISO });
  assert.deepEqual(ops[1].args, { p_actor: TEST_USER, p_partner_org: TEST_ORG, p_user: OTHER });
  assert.deepEqual(ops[2].args, { p_actor: TEST_USER, p_org: TEST_ORG, p_frozen: true });
  assert.equal(freeze.cancelledActions, 3);

  const noMfa = await requireOrgMember(testRequest(), TEST_ORG, undefined, { ...testAuthDeps({ org_role: "partner_admin" }), verifyToken: () => Promise.resolve({ userId: TEST_USER, aal: "aal2", amr: [] }) }); // jeton aal2 sans horodatage de second facteur lisible
  const other = store(() => ok({}));
  assert.equal(await codeOf(other.s.createClient(noMfa, { name: "x", slug: "xx", adminEmail: "a@g.test", tokenHash: "h".repeat(64) })), "mfa_required");
  assert.equal(other.ops.length, 0, "aucun appel SQL sans horodatage de second facteur");
});

Deno.test("appel SQL : un résultat inattendu de la base est une panne (503), jamais un succès deviné", async () => {
  const auth = await makeAuth({ org_role: "partner_admin" });
  for (const reply of [{ data: null, error: null }, { data: "texte", error: null }, { data: { client_org_id: 1 }, error: null }]) {
    assert.equal(await codeOf(store(() => reply).s.createClient(auth, { name: "x", slug: "xx", adminEmail: "a@g.test", tokenHash: "h".repeat(64) })), "service_unavailable");
  }
  assert.equal(await codeOf(store(() => ({ data: null, error: { code: "P0001", message: "Plafond de clients atteint (3)" } })).s.createClient(auth, { name: "x", slug: "xx", adminEmail: "a@g.test", tokenHash: "h".repeat(64) })), "conflict");
});

Deno.test("acceptation d'une invitation : par la porte étroite, avec l'identifiant de la personne ; un jeton refusé = message générique", async () => {
  const bare = await requireUser(testRequest(), testAuthDeps());
  const good = store(() => ok({ org_id: TEST_ORG, role: "org_admin" }));
  assert.deepEqual(await good.s.acceptInvitation(bare, { email: "a@b.test", tokenHash: "h".repeat(64) }), { orgId: TEST_ORG, role: "org_admin" });
  assert.deepEqual(good.ops[0].args, { p_user: TEST_USER, p_email: "a@b.test", p_token_hash: "h".repeat(64) });
  const refused = store(() => ({ data: null, error: { code: "P0001", message: "Invitation invalide ou expirée" } }));
  const e = await refused.s.acceptInvitation(bare, { email: "a@b.test", tokenHash: "h".repeat(64) }).catch((x: AppError) => x);
  assert.equal((e as AppError).code, "bad_request");
  assert.equal((e as AppError).message, "Invitation invalide ou expirée.");
  const member = await makeAuth({ org_role: "org_admin" });
  assert.equal(await codeOf(good.s.acceptInvitation(member, { email: "a@b.test", tokenHash: "h".repeat(64) })), "forbidden", "un membre n'utilise pas cette porte");
});

Deno.test("écritures simples : TOUTES filtrées par l'organisation du contexte et conditionnelles", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { s, ops } = store((op) => (op.table === "partner_relationships" && op.method === "select" ? ok([{ id: REL, expires_at: "2099-01-01T00:00:00.000Z", approved_roles: ["partner_technician"] }]) : ok()));

  await s.activateClient(auth);
  assert.ok(has(ops[0], "eq", "id", TEST_ORG) && has(ops[0], "eq", "type", "client") && has(ops[0], "is", "activated_at", null), "activation : seulement CE client, une seule fois");

  assert.deepEqual(await s.activeRelationship(auth), { id: REL, expiresAt: "2099-01-01T00:00:00.000Z", approvedRoles: ["partner_technician"] });
  assert.ok(has(ops[1], "eq", "client_org_id", TEST_ORG) && has(ops[1], "in", "status", ["active", "reduced"]) && has(ops[1], "is", "revoked_at", null) && ops[1].filters.some(([k, c]) => k === "gt" && c === "expires_at"));

  await s.reduceRelationship(auth, ["partner_technician"]);
  assert.deepEqual(ops[2].payload, { approved_roles: ["partner_technician"], status: "reduced" });
  assert.ok(has(ops[2], "eq", "client_org_id", TEST_ORG) && has(ops[2], "in", "status", ["active", "reduced"]));

  await s.revokeRelationship(auth);
  assert.equal((ops[3].payload as { status: string; revoked_by: string }).status, "revoked");
  assert.equal((ops[3].payload as { revoked_by: string }).revoked_by, TEST_USER);
  assert.ok(has(ops[3], "eq", "client_org_id", TEST_ORG) && has(ops[3], "in", "status", ["proposed", "active", "reduced", "suspended"]));

  await s.setCategoryState(auth, { category: "password", state: "direct", reason: "Décision de l'administrateur", override: true });
  assert.deepEqual(ops[4].payload, { state: "direct", changed_by: TEST_USER, reason: "Décision de l'administrateur", override_insufficient_data: true });
  assert.ok(has(ops[4], "eq", "org_id", TEST_ORG) && has(ops[4], "eq", "category", "password"));
  await s.setCategoryState(auth, { category: "password", state: "shadow", reason: "Retour en conseil seul", override: true });
  assert.equal((ops[5].payload as { override_insufficient_data: boolean }).override_insufficient_data, false, "l'ouverture assumée ne se conserve que pour « direct »");

  await s.qualifyConnector(auth, { connectorId: OTHER, environment: "production" });
  assert.deepEqual(Object.keys(ops[6].payload as object).sort(), ["environment", "qualified_at", "qualified_by"]);
  assert.ok(has(ops[6], "eq", "id", OTHER) && has(ops[6], "eq", "org_id", TEST_ORG) && has(ops[6], "eq", "type", "m365"), "connecteur : de CETTE organisation, de type m365");

  await s.revokeSupportAccess(auth, OTHER);
  assert.ok(has(ops[7], "eq", "id", OTHER) && has(ops[7], "eq", "client_org_id", TEST_ORG) && has(ops[7], "is", "revoked_at", null));

  await s.revokeDelegation(auth, { delegationId: OTHER, ownOnly: false });
  assert.ok(has(ops[8], "eq", "id", OTHER) && has(ops[8], "eq", "org_id", TEST_ORG) && has(ops[8], "is", "revoked_at", null));
  assert.equal(ops[8].filters.some(([k]) => k === "or"), false, "l'administrateur du client retire toute délégation de son organisation");
  await s.revokeDelegation(auth, { delegationId: OTHER, ownOnly: true });
  assert.ok(ops[9].filters.some(([k, c]) => k === "or" && c === `delegator_id.eq.${TEST_USER},delegate_id.eq.${TEST_USER}`), "un technicien ne retire que les siennes");
});

Deno.test("écritures conditionnelles : zéro ligne touchée = introuvable ou conflit, jamais un faux succès", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const empty = store(() => ok([]));
  assert.equal(await codeOf(empty.s.reduceRelationship(auth, ["partner_technician"])), "conflict");
  assert.equal(await codeOf(empty.s.revokeRelationship(auth)), "conflict");
  assert.equal(await codeOf(empty.s.setCategoryState(auth, { category: "password", state: "shadow", reason: "Retour en conseil seul", override: false })), "not_found");
  assert.equal(await codeOf(empty.s.qualifyConnector(auth, { connectorId: OTHER, environment: "test" })), "not_found");
  assert.equal(await codeOf(empty.s.revokeSupportAccess(auth, OTHER)), "not_found");
  assert.equal(await codeOf(empty.s.revokeDelegation(auth, { delegationId: OTHER, ownOnly: false })), "not_found");
  assert.equal(await codeOf(empty.s.activateClient(auth)), "aucune erreur", "activer un client déjà activé est sans effet (idempotent)");
  assert.equal(await empty.s.activeRelationship(auth), null);
});

Deno.test("assignation : la relation doit être celle de CE client (vérifiée en base) ; révocation limitée aux assignations de ses relations", async () => {
  const auth = await makeAuth({ org_role: "partner_admin", via: "partner" });
  // La relation fournie n'appartient pas à ce client : introuvable, et RIEN n'est inséré.
  const stranger = store((op) => (op.table === "partner_relationships" ? ok([]) : ok([{ id: "a" }])));
  assert.equal(await codeOf(stranger.s.createAssignment(auth, { relationshipId: REL, userId: OTHER, endsAt: "2027-01-01T00:00:00.000Z" })), "not_found");
  assert.equal(stranger.ops.some((o) => o.table === "partner_assignments"), false);
  assert.ok(has(stranger.ops[0], "eq", "id", REL) && has(stranger.ops[0], "eq", "client_org_id", TEST_ORG));

  const good = store((op) => (op.method === "insert" ? { data: { id: "new" }, error: null } : ok([{ id: REL }])));
  assert.deepEqual(await good.s.createAssignment(auth, { relationshipId: REL, userId: OTHER, endsAt: "2027-01-01T00:00:00.000Z" }), { assignmentId: "new" });
  const ins = good.ops.find((o) => o.method === "insert")!;
  assert.deepEqual(Object.keys(ins.payload as object).sort(), ["created_by", "ends_at", "relationship_id", "role", "starts_at", "user_id"]);
  assert.equal((ins.payload as { role: string }).role, "partner_technician", "le rôle d'assignation est fixé par le code");

  const rev = store((op) => (op.table === "partner_relationships" ? ok([{ id: REL }]) : ok([{ id: "a" }])));
  await rev.s.revokeAssignment(auth, OTHER);
  const upd = rev.ops.find((o) => o.method === "update")!;
  assert.ok(has(upd, "eq", "id", OTHER) && has(upd, "in", "relationship_id", [REL]) && has(upd, "is", "revoked_at", null));
  const none = store(() => ok([]));
  assert.equal(await codeOf(none.s.revokeAssignment(auth, OTHER)), "not_found", "aucune relation : introuvable");
  assert.equal(none.ops.some((o) => o.method === "update"), false);
});

Deno.test("autonomie : le niveau 1 porte l'auteur et le second facteur ; le niveau 0 n'en porte aucun ; une seule ligne par catégorie", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { s, ops } = store(() => ok());
  await s.setAutonomy(auth, { category: "accounts", level: 1 });
  await s.setAutonomy(auth, { category: "accounts", level: 0 });
  const [one, zero] = ops.map((o) => o.payload as Record<string, unknown>);
  assert.equal(one.level, 1); assert.equal(one.set_by, TEST_USER); assert.equal(one.mfa_verified_at, MFA_ISO); assert.equal(one.org_id, TEST_ORG);
  assert.equal(zero.level, 0); assert.equal(zero.mfa_verified_at, null);
  assert.deepEqual(ops[0].options, { onConflict: "org_id,category" });
  const noMfa = await requireOrgMember(testRequest(), TEST_ORG, undefined, { ...testAuthDeps({ org_role: "org_admin" }), verifyToken: () => Promise.resolve({ userId: TEST_USER, aal: "aal2", amr: [] }) }); // jeton aal2 sans horodatage de second facteur lisible
  const other = store(() => ok());
  assert.equal(await codeOf(other.s.setAutonomy(noMfa, { category: "accounts", level: 1 })), "mfa_required");
  assert.equal(other.ops.length, 0);
  await other.s.setAutonomy(noMfa, { category: "accounts", level: 0 });
  assert.equal(other.ops.length, 1, "revenir au niveau 0 ne demande pas de nouvelle vérification");
});

Deno.test("accès d'assistance : l'approbation relit la demande DE CE CLIENT, puis écrit conditionnellement ; la fenêtre vient de la durée demandée", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { s, ops } = store((op) => (op.terminal === "maybeSingle" ? { data: { id: "g", duration_minutes: 90 }, error: null } : ok()));
  await s.approveSupportAccess(auth, OTHER);
  assert.ok(has(ops[0], "eq", "id", OTHER) && has(ops[0], "eq", "client_org_id", TEST_ORG) && has(ops[0], "is", "approved_by", null) && has(ops[0], "is", "revoked_at", null));
  const p = ops[1].payload as { approved_by: string; starts_at: string; ends_at: string };
  assert.equal(p.approved_by, TEST_USER);
  assert.equal(Date.parse(p.ends_at) - Date.parse(p.starts_at), 90 * 60_000);
  assert.ok(has(ops[1], "eq", "client_org_id", TEST_ORG) && has(ops[1], "is", "approved_by", null), "écriture conditionnelle : pas de double approbation");
  const missing = store((op) => (op.terminal === "maybeSingle" ? { data: null, error: null } : ok()));
  assert.equal(await codeOf(missing.s.approveSupportAccess(auth, OTHER)), "not_found");
  assert.equal(missing.ops.some((o) => o.method === "update"), false);
  const raced = store((op) => (op.terminal === "maybeSingle" ? { data: { id: "g", duration_minutes: 90 }, error: null } : ok([])));
  assert.equal(await codeOf(raced.s.approveSupportAccess(auth, OTHER)), "conflict");
});

Deno.test("création : jeton en empreinte, invitation de 7 jours ; demande d'accès d'assistance et délégation portent l'auteur vérifié", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { s, ops } = store(() => ({ data: { id: "nouveau" }, error: null }));
  await s.createInvitation(auth, { email: "a@b.test", role: "org_technician", tokenHash: "h".repeat(64) });
  const inv = ops[0].payload as Record<string, string>;
  assert.deepEqual(Object.keys(inv).sort(), ["email", "expires_at", "invited_by", "org_id", "role", "token_hash"]);
  assert.equal(inv.org_id, TEST_ORG); assert.equal(inv.invited_by, TEST_USER);
  const days = (Date.parse(inv.expires_at) - Date.now()) / 86_400_000;
  assert.ok(days > 6.99 && days <= 7, `expire dans 7 jours (${days})`);

  await s.requestSupportAccess(auth, { clientOrgId: OTHER, reason: "Diagnostic d'un incident", durationMinutes: 60 });
  assert.deepEqual(ops[1].payload, { client_org_id: OTHER, requested_by: TEST_USER, reason: "Diagnostic d'un incident", duration_minutes: 60 });

  await s.createDelegation(auth, { delegatorId: TEST_USER, delegateId: OTHER, categories: ["accounts"], days: 7 });
  const d = ops[2].payload as Record<string, unknown>;
  assert.deepEqual(Object.keys(d).sort(), ["categories", "created_by", "delegate_id", "delegator_id", "ends_at", "mfa_verified_at", "org_id"]);
  assert.equal(d.org_id, TEST_ORG); assert.equal(d.created_by, TEST_USER); assert.equal(d.mfa_verified_at, MFA_ISO);

  const dup = store(() => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint invitations_one_pending" } }));
  const e = await dup.s.createInvitation(auth, { email: "a@b.test", role: "org_technician", tokenHash: "h".repeat(64) }).catch((x: AppError) => x);
  assert.equal((e as AppError).code, "conflict");
  assert.ok(!/invitations_one_pending|constraint/.test((e as AppError).message));
});

Deno.test("contexte sans organisation : toute écriture d'organisation est refusée sans toucher la base", async () => {
  const bare: AuthContext = await requireUser(testRequest(), testAuthDeps());
  const { s, ops } = store(() => ok());
  assert.equal(await codeOf(s.activateClient(bare)), "forbidden");
  assert.equal(await codeOf(s.revokeRelationship(bare)), "forbidden");
  assert.equal(await codeOf(s.setCategoryState(bare, { category: "password", state: "shadow", reason: null, override: false })), "forbidden");
  assert.equal(ops.length, 0);
});

Deno.test("connecteurs : création = adresse seule en configuration, statut « brouillon », organisation du contexte ; doublon de nom = conflit sans texte de base", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { s, ops } = store(() => ({ data: { id: "conn-1" }, error: null }));
  assert.deepEqual(await s.createConnector(auth, { type: "glpi", name: "GLPI", baseUrl: "https://glpi.exemple.fr" }), { connectorId: "conn-1" });
  assert.deepEqual(ops[0].payload, { org_id: TEST_ORG, type: "glpi", name: "GLPI", status: "draft", config: { base_url: "https://glpi.exemple.fr" } });
  const dup = store(() => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint connectors_org_id_name_key" } }));
  const e = await dup.s.createConnector(auth, { type: "glpi", name: "GLPI", baseUrl: "https://glpi.exemple.fr" }).catch((x: AppError) => x);
  assert.equal((e as AppError).code, "conflict");
  assert.ok(!/constraint|connectors_org/.test((e as AppError).message));
});

Deno.test("connecteurs : le statut est écrit pour l'organisation du contexte seulement ; zéro ligne = introuvable", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { s, ops } = store(() => ok());
  await s.setConnectorStatus(auth, OTHER, { status: "error", error: "auth" });
  assert.ok(has(ops[0], "eq", "id", OTHER) && has(ops[0], "eq", "org_id", TEST_ORG));
  const p = ops[0].payload as Record<string, unknown>;
  assert.equal(p.status, "error"); assert.equal(p.last_error, "auth");
  assert.deepEqual(Object.keys(p).sort(), ["last_error", "last_sync_at", "status"]);
  assert.equal(await codeOf(store(() => ok([])).s.setConnectorStatus(auth, OTHER, { status: "ok", error: null })), "not_found");
});

Deno.test("Microsoft 365 : tenant lu pour CE connecteur de CETTE organisation ; création avec le tenant en colonne et une configuration vide", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const { s, ops } = store(() => ({ data: { tenant_id: "11111111-2222-4333-8444-555555555555", id: "c" }, error: null }));
  assert.equal(await s.microsoftTenantOf(auth, OTHER), "11111111-2222-4333-8444-555555555555");
  assert.ok(has(ops[0], "eq", "id", OTHER) && has(ops[0], "eq", "org_id", TEST_ORG) && has(ops[0], "eq", "type", "m365"));
  await s.createConnector(auth, { type: "m365", name: "M365", tenantId: "11111111-2222-4333-8444-555555555555" });
  assert.deepEqual(ops[1].payload, { org_id: TEST_ORG, type: "m365", name: "M365", status: "draft", config: {}, tenant_id: "11111111-2222-4333-8444-555555555555" });
  assert.equal(await store(() => ({ data: null, error: null })).s.microsoftTenantOf(auth, OTHER), null);
  assert.equal(fail({ code: "P0001", message: "Microsoft 365 ne peut pas être connecté avant l'activation du client par son administrateur (SEC-30)" }).code, "not_activated");
});

Deno.test("Microsoft 365 : le lien est TOUJOURS celui de la personne du contexte ; même compte = mise à jour ; autre compte actif = conflit ; ancien lien révoqué = remplacé", async () => {
  const auth = await makeAuth({ org_role: "org_technician" });
  const id = { connectorId: OTHER, tenantId: "t", objectId: "obj-1", upn: "tech@c.fr" };
  const fresh = store((op) => (op.terminal === "maybeSingle" ? { data: null, error: null } : ok()));
  await fresh.s.linkMicrosoftIdentity(auth, id);
  assert.ok(has(fresh.ops[0], "eq", "user_id", TEST_USER) && has(fresh.ops[0], "eq", "org_id", TEST_ORG) && has(fresh.ops[0], "eq", "connector_id", OTHER));
  assert.deepEqual(fresh.ops[1].payload, { org_id: TEST_ORG, user_id: TEST_USER, connector_id: OTHER, tenant_id: "t", object_id: "obj-1", upn: "tech@c.fr" });

  const same = store((op) => (op.terminal === "maybeSingle" ? { data: { id: "row", object_id: "obj-1", revoked_at: "2026-01-01T00:00:00Z" }, error: null } : ok()));
  await same.s.linkMicrosoftIdentity(auth, id);
  assert.equal(same.ops[1].method, "update");
  assert.equal((same.ops[1].payload as { revoked_at: unknown }).revoked_at, null);
  assert.ok(has(same.ops[1], "eq", "id", "row") && has(same.ops[1], "eq", "user_id", TEST_USER));

  const other = store((op) => (op.terminal === "maybeSingle" ? { data: { id: "row", object_id: "obj-2", revoked_at: null }, error: null } : ok()));
  assert.equal(await codeOf(other.s.linkMicrosoftIdentity(auth, id)), "conflict");
  assert.equal(other.ops.length, 1, "rien n'est écrit");

  const old = store((op) => (op.terminal === "maybeSingle" ? { data: { id: "row", object_id: "obj-2", revoked_at: "2026-01-01T00:00:00Z" }, error: null } : ok()));
  await old.s.linkMicrosoftIdentity(auth, id);
  assert.deepEqual(old.ops.map((o) => o.method), ["select", "delete", "insert"]);
  assert.ok(old.ops[1].filters.some(([k, c]) => k === "not" && c === "revoked_at"), "on ne supprime qu'un lien RÉVOQUÉ");
});

Deno.test("Microsoft 365 : délier = seulement le lien actif de la personne du contexte ; aucun lien = introuvable", async () => {
  const auth = await makeAuth({ org_role: "org_technician" });
  const { s, ops } = store(() => ok());
  await s.unlinkMicrosoftIdentity(auth, OTHER);
  assert.ok(has(ops[0], "eq", "user_id", TEST_USER) && has(ops[0], "eq", "connector_id", OTHER) && has(ops[0], "eq", "org_id", TEST_ORG) && has(ops[0], "is", "revoked_at", null));
  assert.equal(await codeOf(store(() => ok([])).s.unlinkMicrosoftIdentity(auth, OTHER)), "not_found");
});

Deno.test("règles d'automatisation : copie du modèle de la plateforme pour l'organisation du CONTEXTE ; seul l'état est choisi", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const tpl = { key: "incident-grouped", name: "Incident regroupé", version: 1, autonomy: 0, locked: false, trigger_kind: "alert.opened", definition: { all: [] } };
  const { s, ops } = store((op) => (op.method === "select" ? ok(tpl) : ok(null)));
  await s.setAutomationState(auth, { key: "incident-grouped", state: "dry_run" });
  const read = ops[0];
  assert.ok(has(read, "is", "org_id", null) && has(read, "eq", "key", "incident-grouped"), "lecture du modèle de la plateforme");
  const write = ops[1];
  assert.equal(write.method, "upsert");
  assert.deepEqual(write.options, { onConflict: "org_id,key" });
  assert.deepEqual(write.payload, {
    org_id: TEST_ORG, key: "incident-grouped", name: "Incident regroupé", version: 1, autonomy: 0, locked: false, trigger_kind: "alert.opened",
    definition: { all: [] }, enabled: true, dry_run: true, updated_by: TEST_USER,
  });
  const off = store((op) => (op.method === "select" ? ok(tpl) : ok(null)));
  await off.s.setAutomationState(auth, { key: "incident-grouped", state: "disabled" });
  assert.equal((off.ops[1].payload as Record<string, unknown>).enabled, false);
  const on = store((op) => (op.method === "select" ? ok(tpl) : ok(null)));
  await on.s.setAutomationState(auth, { key: "incident-grouped", state: "active" });
  assert.deepEqual([(on.ops[1].payload as Record<string, unknown>).enabled, (on.ops[1].payload as Record<string, unknown>).dry_run], [true, false]);
});

Deno.test("règles d'automatisation : règle verrouillée ou inconnue refusée sans écriture ; refus de la base traduit", async () => {
  const auth = await makeAuth({ org_role: "org_admin" });
  const locked = store(() => ok({ key: "incident-grouped", locked: true }));
  assert.equal(await codeOf(locked.s.setAutomationState(auth, { key: "incident-grouped", state: "disabled" })), "conflict");
  assert.equal(locked.ops.length, 1, "aucune écriture");
  const missing = store(() => ok(null));
  assert.equal(await codeOf(missing.s.setAutomationState(auth, { key: "source-silent", state: "disabled" })), "not_found");
  const refused = store((op) => (op.method === "select" ? ok({ key: "x", locked: false }) : { data: null, error: { code: "P0001", message: "La règle suspicious-reset est verrouillée par la plateforme" } }));
  assert.equal(await codeOf(refused.s.setAutomationState(auth, { key: "incident-grouped", state: "dry_run" })), "conflict");
});
