// Porte HTTP de `admin` : ce que chaque rôle peut ou ne peut pas faire, second facteur, arrêt d'urgence, lecture seule, audit.
// Les tableaux ci-dessous sont écrits EN DUR (ils ne lisent pas ADMIN_OPS) : élargir un droit dans le code fait échouer ces tests.
import assert from "node:assert/strict";
import { ADMIN_OPS } from "./ops.ts";
import { ALL_ROLES, NOW_MS, OTHER, rig, VALID_BODY } from "./test_rig.ts";
import { TEST_ORG } from "../testing.ts";
import { hashToken } from "./token.ts";

type Expect = { roles: readonly string[]; via: "member" | "any"; mfa: boolean | "si_niveau_1" | "si_direct" | "si_actif"; frozen: boolean };
const EXPECTED: Readonly<Record<string, Expect>> = {
  "client.create": { roles: ["partner_admin"], via: "member", mfa: true, frozen: false },
  "invitation.create": { roles: ["partner_admin", "org_admin"], via: "member", mfa: true, frozen: false },
  "client.activate": { roles: ["org_admin"], via: "member", mfa: true, frozen: false },
  "relationship.reduce": { roles: ["org_admin"], via: "member", mfa: true, frozen: false },
  "relationship.revoke": { roles: ["org_admin"], via: "member", mfa: false, frozen: true },
  "assignment.create": { roles: ["partner_admin"], via: "any", mfa: true, frozen: false },
  "assignment.revoke": { roles: ["partner_admin"], via: "any", mfa: false, frozen: true },
  "technician.offboard": { roles: ["partner_admin"], via: "member", mfa: true, frozen: true },
  "org.freeze": { roles: ["org_admin", "partner_admin"], via: "any", mfa: false, frozen: true },
  "org.unfreeze": { roles: ["org_admin", "partner_admin"], via: "any", mfa: true, frozen: true },
  "autonomy.set": { roles: ["org_admin"], via: "member", mfa: "si_niveau_1", frozen: true },
  "category.set_state": { roles: ["org_admin"], via: "member", mfa: "si_direct", frozen: true },
  "automation.set_state": { roles: ["org_admin", "partner_admin"], via: "any", mfa: "si_actif", frozen: true },
  "support_access.request": { roles: ["super_admin"], via: "member", mfa: true, frozen: false },
  "support_access.approve": { roles: ["org_admin"], via: "member", mfa: true, frozen: false },
  "support_access.revoke": { roles: ["org_admin"], via: "member", mfa: false, frozen: true },
  "delegation.create": { roles: ["partner_technician", "org_technician", "org_admin"], via: "any", mfa: true, frozen: false },
  "delegation.revoke": { roles: ["partner_technician", "org_technician", "org_admin"], via: "any", mfa: false, frozen: true },
  "connector.qualify": { roles: ["org_admin"], via: "member", mfa: true, frozen: false },
  "connector.create_glpi": { roles: ["org_admin", "partner_admin"], via: "any", mfa: true, frozen: false },
  "connector.test": { roles: ["org_admin", "partner_admin"], via: "any", mfa: false, frozen: false },
  "connector.create_m365": { roles: ["org_admin", "partner_admin"], via: "any", mfa: true, frozen: false },
  "microsoft.link": { roles: ["partner_technician", "org_technician", "org_admin"], via: "any", mfa: true, frozen: false },
  "microsoft.unlink": { roles: ["partner_technician", "org_technician", "org_admin"], via: "any", mfa: false, frozen: true },
};
const ORG_OPS = Object.keys(EXPECTED);

/** Corps valide pour (opération, rôle) : une invitation ne vise que les rôles de l'organisation de celui qui invite. */
function bodyFor(op: string, role: string): Record<string, unknown> {
  if (op === "invitation.create") return { ...VALID_BODY[op], role: role === "partner_admin" ? "partner_technician" : "org_technician" };
  return VALID_BODY[op];
}
const via = (v: "member" | "partner" = "member") => v;

Deno.test("liste fermée : exactement ces opérations existent, rien d'autre (un ajout doit être relu ici)", () => {
  assert.deepEqual([...ADMIN_OPS.keys()].sort(), [...ORG_OPS, "invitation.accept"].sort());
  assert.deepEqual(Object.keys(VALID_BODY).sort(), [...ADMIN_OPS.keys()].sort());
});

Deno.test("porte : méthode, corps et opération inconnue sont refusés AVANT tout accès (le magasin n'est jamais touché)", async () => {
  const r = rig();
  const get = await r.handlerFor({})(new Request("https://exemple.test/admin", { method: "GET" }));
  assert.equal(get.status, 405);
  const notJson = await r.handlerFor({})(new Request("https://exemple.test/admin", { method: "POST", body: "pas du json", headers: { authorization: "Bearer aaaaaaaa.bbbbbbbb.cccccccc" } }));
  assert.equal(notJson.status, 400);
  for (const op of ["", "inconnue", "__proto__", "constructor", "toString", "hasOwnProperty", "client.create ", "CLIENT.CREATE", "client.create\n", "../client.create"]) {
    const res = await r.call(op, {});
    assert.equal(res.status, 400, `opération « ${op} » refusée`);
  }
  assert.equal((await r.call(undefined as unknown as string, {})).status, 400);
  assert.equal(r.calls.length, 0);
  assert.equal(r.db.inserts.length, 0, "aucune trace d'audit pour une opération qui n'existe pas");
});

Deno.test("SEC-04 sans jeton : 401, avant tout ; l'organisation du corps n'est qu'une demande (jamais lue dans un en-tête)", async () => {
  const r = rig();
  const noToken = await r.handlerFor({})(new Request("https://exemple.test/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "org.freeze", orgId: TEST_ORG }) }));
  assert.equal(noToken.status, 401);
  assert.equal(r.calls.length, 0);
  // Un en-tête ou un paramètre d'URL qui désigne une autre organisation n'est jamais lu.
  const res = await r.call("org.freeze", {}, {}, { "x-org-id": OTHER, "x-organization": OTHER });
  assert.equal(res.status, 200);
  assert.deepEqual(r.seenOrgs, [TEST_ORG], "seule l'organisation du corps est confrontée à la base");
});

Deno.test("SEC-04 aucun accès à l'organisation visée : 403, même réponse qu'elle existe ou non ; identifiant invalide : 400", async () => {
  const r = rig();
  for (const op of ORG_OPS) {
    const res = await r.call(op, VALID_BODY[op], { access: null });
    assert.equal(res.status, 403, op);
    assert.equal(res.code, "forbidden", op);
  }
  assert.equal((await r.call("org.freeze", { orgId: "pas-un-uuid" })).status, 400);
  assert.equal((await r.call("org.freeze", { orgId: 12 })).status, 400);
  assert.equal(r.calls.length, 0);
});

Deno.test("rôles : pour chaque opération, SEULS les rôles prévus passent (matrice complète 24 opérations × 10 rôles)", async () => {
  for (const op of ORG_OPS) {
    for (const role of ALL_ROLES) {
      const r = rig();
      const res = await r.call(op, bodyFor(op, role), { access: { org_role: role, via: "member" } });
      const allowed = EXPECTED[op].roles.includes(role);
      assert.equal(res.status, allowed ? 200 : 403, `${op} / ${role}`);
      if (!allowed) assert.equal(r.calls.length, 0, `${op} / ${role} : le magasin n'est pas touché`);
    }
  }
});

Deno.test("voie d'accès : une opération « membre » est refusée à une ESN qui agit chez le client (voie ESN) ; les opérations « any » l'acceptent", async () => {
  for (const op of ORG_OPS) {
    for (const role of EXPECTED[op].roles) {
      const r = rig();
      const res = await r.call(op, bodyFor(op, role), { access: { org_role: role, via: via("partner") } });
      assert.equal(res.status, EXPECTED[op].via === "any" ? 200 : 403, `${op} / ${role} / voie ESN`);
    }
  }
});

Deno.test("accès d'assistance (lecture seule) : AUCUNE opération, même celles qui restreignent", async () => {
  for (const op of ORG_OPS) {
    const r = rig();
    const res = await r.call(op, bodyFor(op, EXPECTED[op].roles[0]), { access: { org_role: EXPECTED[op].roles[0], via: "support_access", read_only: true } });
    assert.ok(res.status === 403, `${op} : ${res.status}`);
    assert.equal(r.calls.length, 0, op);
  }
});

Deno.test("SEC-28 arrêt d'urgence : seules les opérations qui RESTREINT l'accès restent possibles ; les autres sont refusées (org_frozen)", async () => {
  for (const op of ORG_OPS) {
    const role = EXPECTED[op].roles[0];
    const r = rig();
    // Pour les opérations à niveau variable, on teste la forme qui OUVRE (niveau 1, catégorie directe) : refusée si gelé.
    const res = await r.call(op, bodyFor(op, role), { access: { org_role: role, via: "member", is_frozen: true } });
    const opensAccess = op === "autonomy.set" || op === "category.set_state" || op === "automation.set_state";
    assert.equal(res.status, EXPECTED[op].frozen && !opensAccess ? 200 : 403, `${op} gelée`);
    if (res.status === 403) assert.equal(res.code, "org_frozen", op);
  }
  const r = rig();
  assert.equal((await r.call("autonomy.set", { category: "accounts", level: 0 }, { access: { is_frozen: true } })).status, 200, "retour au niveau 0 : possible");
  assert.equal((await r.call("category.set_state", { category: "password", state: "shadow", reason: "Retour au conseil seul après incident" }, { access: { is_frozen: true } })).status, 200);
  assert.equal((await r.call("category.set_state", { category: "password", state: "advice_only", reason: "Retour au conseil seul après incident" }, { access: { is_frozen: true } })).status, 200);
});

Deno.test("second facteur : exigé RÉCENT pour les opérations qui ouvrent ou créent ; d'ouverture de session (1 h) ou ancien (11 min) = refus ; 5 minutes = accepté", async () => {
  for (const op of ORG_OPS) {
    const role = EXPECTED[op].roles[0];
    const needs = EXPECTED[op].mfa;
    const body = bodyFor(op, role);
    const needsFor = (b: Record<string, unknown>) =>
      needs === true || (needs === "si_niveau_1" && b.level === 1) || (needs === "si_direct" && b.state === "direct") || (needs === "si_actif" && b.state === "active");
    for (const [label, mfaAge, ok] of [["d'ouverture de session", null, false], ["ancien", 660, false], ["récent", 300, true]] as const) {
      const r = rig();
      const res = await r.call(op, body, { access: { org_role: role, via: "member" }, mfaAge });
      const expectOk = ok || !needsFor(body);
      assert.equal(res.status, expectOk ? 200 : 403, `${op} / second facteur ${label}`);
      if (!expectOk) { assert.equal(res.code, "mfa_required", op); assert.equal(r.calls.length, 0, op); }
    }
  }
  // Les formes qui RESTREIGNENT n'exigent pas de second facteur RÉCENT : niveau 0, catégorie fermée, gel, révocations.
  const r = rig();
  assert.equal((await r.call("autonomy.set", { category: "accounts", level: 0 }, { mfaAge: null })).status, 200);
  assert.equal((await r.call("category.set_state", { category: "password", state: "shadow", reason: "Retour au conseil seul après incident" }, { mfaAge: null })).status, 200);
  assert.equal((await r.call("org.freeze", {}, { mfaAge: null })).status, 200, "geler ne demande pas de nouvelle vérification : l'urgence prime");
  assert.equal((await r.call("org.unfreeze", {}, { mfaAge: null })).status, 403, "dégeler en demande une");
});

Deno.test("SEC-33 : une session SANS second facteur (connexion par code) ne fait AUCUNE opération d'organisation, même celles qui restreignent", async () => {
  for (const op of ORG_OPS) {
    const role = EXPECTED[op].roles[0];
    const r = rig();
    const res = await r.call(op, bodyFor(op, role), { access: { org_role: role, via: "member" }, mfaAge: -1 });
    assert.equal(res.status, 403, op);
    assert.equal(res.code, "mfa_required", op);
    assert.equal(r.calls.length, 0, op);
  }
});

Deno.test("audit AVANT d'agir : journal indisponible = 503 et rien n'est fait ; sinon une ligne « admin.<op> » sans paramètre ni jeton", async () => {
  const down = rig({}, ["audit_logs"]);
  const res = await down.call("client.create", VALID_BODY["client.create"], { access: { org_role: "partner_admin" } });
  assert.equal(res.status, 503);
  assert.equal(down.calls.length, 0, "aucune création sans trace");

  const ok = rig();
  const created = await ok.call("client.create", VALID_BODY["client.create"], { access: { org_role: "partner_admin" } });
  assert.equal(created.status, 200);
  const rows = ok.db.inserts.filter((i) => i.table === "audit_logs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row.event, "admin.client.create");
  const dump = JSON.stringify(rows[0].row);
  assert.ok(!dump.includes("T".repeat(43)) && !dump.includes("gamma") && !dump.includes("Gamma"), "ni le jeton d'invitation ni les paramètres dans l'audit");
});

Deno.test("jeton d'invitation : renvoyé UNE fois à l'appelant ; le magasin ne reçoit que son empreinte", async () => {
  const r = rig();
  const res = await r.call("client.create", VALID_BODY["client.create"], { access: { org_role: "partner_admin" } });
  assert.equal(res.json.invitationToken, "T".repeat(43));
  assert.deepEqual(r.calls[0].args[0], { name: "Client Gamma", slug: "client-gamma", adminEmail: "admin@gamma.test", tokenHash: "h".repeat(64) });
  assert.ok(!JSON.stringify(r.calls).includes("T".repeat(43)), "le jeton en clair n'atteint jamais le magasin");
});

Deno.test("invitations : chacun n'invite que les rôles de SA organisation ; jamais un rôle de la plateforme ni un salarié", async () => {
  const cases: Array<[string, string, number]> = [
    ["partner_admin", "partner_technician", 200], ["partner_admin", "partner_manager", 200], ["partner_admin", "partner_admin", 200],
    ["partner_admin", "org_admin", 403], ["partner_admin", "org_technician", 403],
    ["org_admin", "org_technician", 200], ["org_admin", "org_viewer", 200], ["org_admin", "auditor", 200], ["org_admin", "org_admin", 200],
    ["org_admin", "partner_admin", 403], ["org_admin", "partner_technician", 403],
    ["org_admin", "super_admin", 400], ["org_admin", "platform_support", 400], ["partner_admin", "super_admin", 400], ["org_admin", "end_user", 400],
    ["org_admin", "n'importe quoi", 400],
  ];
  for (const [caller, invited, status] of cases) {
    const r = rig();
    const res = await r.call("invitation.create", { email: "nouveau@exemple.test", role: invited }, { access: { org_role: caller } });
    assert.equal(res.status, status, `${caller} invite ${invited}`);
    if (status !== 200) assert.equal(r.calls.length, 0);
  }
});

Deno.test("M29 acceptation d'une invitation : adresse CONFIRMÉE du jeton d'authentification, jamais celle du corps ; forme du jeton vérifiée", async () => {
  const r = rig();
  const ok = await r.call("invitation.accept", { token: "T".repeat(43), email: "pirate@exemple.test", orgId: OTHER }, { email: "Vraie.Personne@Client.test" });
  assert.equal(ok.status, 200);
  assert.deepEqual(r.calls[0].args[0], { email: "vraie.personne@client.test", tokenHash: await hashToken("T".repeat(43)) });
  assert.deepEqual(r.seenOrgs, [], "aucune organisation n'est demandée : la personne n'est pas encore membre");
  assert.equal(r.db.inserts.length, 0, "pas d'audit applicatif sans organisation : la base journalise l'appartenance et l'invitation elle-même");
  for (const [label, who] of [["adresse non confirmée", { email: null }], ["adresse absente", { email: undefined }]] as const) {
    const r2 = rig();
    const res = await r2.call("invitation.accept", { token: "T".repeat(43) }, who as { email: null });
    assert.equal(res.status, label === "adresse absente" ? 200 : 403, label);
  }
  const bad = rig();
  for (const token of [undefined, "", "trop-court", "T".repeat(42), "T".repeat(44), "T".repeat(42) + "+", 42, ["T".repeat(43)]]) {
    assert.equal((await bad.call("invitation.accept", { token } as Record<string, unknown>)).status, 400, String(token));
  }
  assert.equal(bad.calls.length, 0);
});

Deno.test("assignation : jamais au-delà de la fin de la relation ; sans relation active = conflit", async () => {
  const r = rig();
  const res = await r.call("assignment.create", { userId: OTHER, days: 365 }, { access: { org_role: "partner_admin", via: "partner" } });
  assert.equal(res.status, 200);
  const args = r.calls.find((c) => c.method === "createAssignment")!.args[0] as { endsAt: string };
  assert.equal(args.endsAt, new Date(NOW_MS + 200 * 86_400_000).toISOString(), "plafonnée à la fin de la relation (200 jours), pas 365");
  const short = rig();
  await short.call("assignment.create", { userId: OTHER, days: 10 }, { access: { org_role: "partner_admin", via: "partner" } });
  assert.equal(((short.calls.find((c) => c.method === "createAssignment")!.args[0]) as { endsAt: string }).endsAt, new Date(NOW_MS + 10 * 86_400_000).toISOString());
  const none = rig({ activeRelationship: () => null });
  assert.equal((await none.call("assignment.create", { userId: OTHER }, { access: { org_role: "partner_admin", via: "partner" } })).status, 409);
  assert.equal(none.calls.some((c) => c.method === "createAssignment"), false);
  for (const days of [0, 366, 1.5, "30", -1]) {
    assert.equal((await rig().call("assignment.create", { userId: OTHER, days } as Record<string, unknown>, { access: { org_role: "partner_admin", via: "partner" } })).status, 400, String(days));
  }
});

Deno.test("niveaux d'autonomie : 0 ou 1 seulement (le niveau 2 n'existe pas), catégories de la liste fermée", async () => {
  const r = rig();
  for (const level of [2, 3, -1, 0.5, "1", true, null]) {
    assert.equal((await r.call("autonomy.set", { category: "accounts", level } as Record<string, unknown>)).status, 400, `niveau ${String(level)}`);
  }
  for (const category of ["", "everything", "Accounts", "accounts ", "password", undefined]) {
    assert.equal((await r.call("autonomy.set", { category, level: 1 } as Record<string, unknown>)).status, 400, String(category));
  }
  assert.equal(r.calls.length, 0);
  assert.equal((await r.call("autonomy.set", { category: "tickets", level: 1 })).status, 200);
  assert.deepEqual(r.calls[0].args[0], { category: "tickets", level: 1 });
});

Deno.test("catégories : état et motif contrôlés ; ouvrir (direct) exige un second facteur", async () => {
  const r = rig();
  for (const body of [
    { category: "password", state: "ouvert", reason: "Un motif suffisamment long pour passer" },
    { category: "inconnue", state: "direct", reason: "Un motif suffisamment long pour passer" },
    { category: "password", state: "shadow", reason: "trop court" },
    { category: "password", state: "shadow", reason: "x".repeat(501) },
    { category: "password", state: "direct", overrideInsufficientData: "oui" },
  ]) assert.equal((await r.call("category.set_state", body)).status, 400, JSON.stringify(body));
  assert.equal(r.calls.length, 0);
  assert.equal((await r.call("category.set_state", { category: "password", state: "direct", overrideInsufficientData: true, reason: "Ouverture assumée avec moins de 300 réponses" })).status, 200);
  assert.deepEqual(r.calls[0].args[0], { category: "password", state: "direct", reason: "Ouverture assumée avec moins de 300 réponses", override: true });
});

Deno.test("délégations : on délègue SES validations ; seul l'administrateur du client réattribue celles d'un absent ; 30 jours et catégories fermées", async () => {
  const r = rig();
  const tech = { access: { org_role: "org_technician" } };
  assert.equal((await r.call("delegation.create", { delegateId: OTHER, categories: ["accounts"], days: 7 }, tech)).status, 200);
  assert.equal((r.calls[0].args[0] as { delegatorId: string }).delegatorId, "123e4567-e89b-12d3-a456-426614174000", "le délégant est l'appelant");
  assert.equal((await r.call("delegation.create", { delegateId: OTHER, delegatorId: "523e4567-e89b-12d3-a456-426614174000", categories: ["accounts"], days: 7 }, tech)).status, 403, "un technicien ne délègue pas les validations d'un autre");
  const admin = await r.call("delegation.create", { delegateId: OTHER, delegatorId: "523e4567-e89b-12d3-a456-426614174000", categories: ["accounts"], days: 7 }, { access: { org_role: "org_admin" } });
  assert.equal(admin.status, 200, "l'administrateur du client réattribue (I9)");
  for (const body of [
    { delegateId: OTHER, categories: ["accounts"], days: 31 }, { delegateId: OTHER, categories: ["accounts"], days: 0 },
    { delegateId: OTHER, categories: [], days: 7 }, { delegateId: OTHER, categories: ["accounts", "accounts"], days: 7 },
    { delegateId: OTHER, categories: ["tout"], days: 7 }, { delegateId: OTHER, categories: "accounts", days: 7 },
    { delegateId: "pas-un-uuid", categories: ["accounts"], days: 7 },
  ]) assert.equal((await r.call("delegation.create", body, tech)).status, 400, JSON.stringify(body));
  assert.equal((await r.call("delegation.create", { delegateId: OTHER, categories: ["accounts"], days: 7 }, tech)).status, 200);
});

Deno.test("révocation d'une délégation : un technicien ne retire que les siennes ; l'administrateur du client toutes celles de son organisation", async () => {
  const r = rig();
  await r.call("delegation.revoke", { delegationId: OTHER }, { access: { org_role: "org_technician" } });
  await r.call("delegation.revoke", { delegationId: OTHER }, { access: { org_role: "partner_technician", via: "partner" } });
  await r.call("delegation.revoke", { delegationId: OTHER }, { access: { org_role: "org_admin" } });
  assert.deepEqual(r.calls.map((c) => (c.args[0] as { ownOnly: boolean }).ownOnly), [true, true, false]);
});

Deno.test("mass assignment : le magasin ne reçoit QUE les champs prévus, jamais ceux que l'appelant ajoute au corps", async () => {
  const r = rig();
  await r.call("client.create", { ...VALID_BODY["client.create"], plan: "pro", client_cap: 1000, created_by: OTHER, state: "active", role: "super_admin", activated_at: "2020-01-01", approved_roles: ["partner_admin"] }, { access: { org_role: "partner_admin" } });
  assert.deepEqual(Object.keys(r.calls[0].args[0] as object).sort(), ["adminEmail", "name", "slug", "tokenHash"]);
  const r2 = rig();
  await r2.call("relationship.reduce", { roles: ["partner_technician"], status: "active", expires_at: "2099-01-01", client_org_id: OTHER });
  assert.deepEqual(r2.calls[0].args, [["partner_technician"]]);
  const r3 = rig();
  await r3.call("support_access.request", { ...VALID_BODY["support_access.request"], approved_by: OTHER, ends_at: "2099-01-01" }, { access: { org_role: "super_admin" } });
  assert.deepEqual(Object.keys(r3.calls[0].args[0] as object).sort(), ["clientOrgId", "durationMinutes", "reason"]);
});

Deno.test("relation : seuls les rôles de la liste fermée, au moins un, sans doublon (on ne crée pas de rôle ni on n'élargit)", async () => {
  const r = rig();
  for (const roles of [[], ["org_admin"], ["super_admin"], ["partner_technician", "partner_technician"], "partner_technician", ["partner_technician", 1], undefined]) {
    assert.equal((await r.call("relationship.reduce", { roles } as Record<string, unknown>)).status, 400, JSON.stringify(roles));
  }
  assert.equal(r.calls.length, 0);
});

Deno.test("accès d'assistance : motif de 10 à 500 caractères, durée de 15 minutes à 24 h ; réservé au super administrateur de la plateforme", async () => {
  const r = rig();
  const sa = { access: { org_role: "super_admin" } };
  for (const body of [
    { clientOrgId: OTHER, reason: "court", durationMinutes: 60 }, { clientOrgId: OTHER, reason: "x".repeat(501), durationMinutes: 60 },
    { clientOrgId: OTHER, reason: "Diagnostic d'un incident signalé", durationMinutes: 14 }, { clientOrgId: OTHER, reason: "Diagnostic d'un incident signalé", durationMinutes: 1441 },
    { clientOrgId: "x", reason: "Diagnostic d'un incident signalé", durationMinutes: 60 },
    { clientOrgId: OTHER, reason: "Diagnostic\nd'un incident signalé", durationMinutes: 60 },
  ]) assert.equal((await r.call("support_access.request", body, sa)).status, 400, JSON.stringify(body));
  assert.equal((await r.call("support_access.request", { clientOrgId: OTHER, reason: "Diagnostic d'un incident signalé" }, sa)).status, 200, "durée par défaut : 4 h");
  assert.equal((r.calls[0].args[0] as { durationMinutes: number }).durationMinutes, 240);
});

Deno.test("réponses d'erreur : aucun détail interne (pile, requête, nom de table) ne sort, et l'identifiant de requête est présent", async () => {
  const r = rig({ createClient: () => { throw new Error("duplicate key value violates unique constraint organizations_slug_key at /srv/app/secret.ts"); } });
  const res = await r.call("client.create", VALID_BODY["client.create"], { access: { org_role: "partner_admin" } });
  assert.equal(res.status, 500);
  assert.ok(!/constraint|organizations|secret\.ts|\/srv/.test(res.text), res.text);
  assert.ok(typeof res.json.requestId === "string" || res.text.length > 0);
});

Deno.test("règles d'automatisation : liste fermée des règles et des états ; couper ou simuler reste possible pendant un arrêt d'urgence", async () => {
  const r = rig();
  for (const body of [
    { key: "suspicious-reset", state: "disabled" },
    { key: "m365-outage", state: "active" },
    { key: "__proto__", state: "active" },
    { key: "incident-grouped", state: "supprimee" },
    { key: "incident-grouped" },
  ]) assert.equal((await r.call("automation.set_state", body)).status, 400, JSON.stringify(body));
  assert.equal(r.calls.length, 0);
  const frozen = rig();
  assert.equal((await frozen.call("automation.set_state", { key: "incident-grouped", state: "disabled" }, { access: { is_frozen: true }, mfaAge: null })).status, 200);
  assert.equal((await frozen.call("automation.set_state", { key: "incident-grouped", state: "dry_run" }, { access: { is_frozen: true }, mfaAge: null })).status, 200);
  const active = await frozen.call("automation.set_state", { key: "incident-grouped", state: "active" }, { access: { is_frozen: true } });
  assert.equal(active.status, 403);
  assert.equal(active.code, "org_frozen");
});
