// Exigences de sécurité du jalon J3 (docs/spec-mvp.md § 14), vérifiées DE BOUT EN BOUT à travers les vraies portes HTTP :
// chaque test porte le numéro SEC de la matrice. Les mêmes exigences sont testées plus finement ailleurs (unités, SQL) ; ici on prouve
// qu'une requête réelle ne peut pas les contourner. Aucun secret en clair dans ce fichier : les faux secrets sont assemblés à l'exécution.
import assert from "node:assert/strict";
import { AppError } from "./errors.ts";
import { AuthDeps } from "./auth.ts";
import { createChatHandler } from "./chat/handler.ts";
import { answerJson, makeRig, RigScript, triageJson } from "./chat/test_rig.ts";
import { TEXTS } from "./chat/texts.ts";
import { createActionsHandler } from "./actions/handler.ts";
import { ACTION_ID, HASH, makeActionRig, msToken, pendingAction } from "./actions/test_rig.ts";
import { rig as adminRig, VALID_BODY } from "./admin/test_rig.ts";
import { noLimit, TEST_JWT, TEST_ORG, testAuthDeps } from "./testing.ts";
import type { PrepareResult } from "./actions/prepare.ts";

const OTHER_ORG = "923e4567-e89b-12d3-a456-426614174000";
const bearer = { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json" };
const post = (h: (r: Request) => Promise<Response>, body: Record<string, unknown>, headers: Record<string, string> = bearer, url = "https://exemple.test/x") =>
  h(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }));
const technician = testAuthDeps({ org_role: "partner_technician", via: "partner" });
const approveBody = (over: Record<string, unknown> = {}) => ({ orgId: TEST_ORG, op: "approve", actionId: ACTION_ID, seenHash: HASH, identityMethod: "callback", microsoftToken: msToken(), ...over });

/** Retire ce qui change d'une requête à l'autre : identifiants de conversation et de requête. */
function normalize(text: string): string {
  const o = JSON.parse(text);
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !/^(conversationId|requestId|id)$/.test(k)).map(([k, x]) => [k, strip(x)]));
    return v;
  };
  return JSON.stringify(strip(o));
}

// ------------------------------------------------------------------------------------------------------------- SEC-04
Deno.test("SEC-04 : l'organisation n'est lue QUE dans le corps ; un en-tête, un paramètre d'URL ou un autre champ ne donnent aucun accès (chat, actions, admin)", async () => {
  const seen: string[] = [];
  const spying = (access: Parameters<typeof testAuthDeps>[0]): AuthDeps => ({ ...testAuthDeps(access), resolveAccess: (u, o) => { seen.push(o); return testAuthDeps(access).resolveAccess(u, o); } });
  const sneaky = { ...bearer, "x-org-id": OTHER_ORG, "x-organization-id": OTHER_ORG, "x-releve-org": OTHER_ORG };
  const url = `https://exemple.test/x?orgId=${OTHER_ORG}&org_id=${OTHER_ORG}`;
  const chat = createChatHandler({ ports: () => makeRig({ gate: "direct" }).ports, authDeps: spying({}), limit: noLimit });
  await post(chat, { orgId: TEST_ORG, organization: OTHER_ORG, org_id: OTHER_ORG, message: "Bonjour" }, sneaky, url);
  const actions = createActionsHandler({ deps: () => makeActionRig().deps, authDeps: spying({ org_role: "partner_technician", via: "partner" }), limit: noLimit });
  await post(actions, approveBody({ organization: OTHER_ORG, org_id: OTHER_ORG }), sneaky, url);
  const admin = adminRig();
  await admin.call("org.freeze", { organization: OTHER_ORG, org_id: OTHER_ORG }, {}, { "x-org-id": OTHER_ORG, "x-releve-org": OTHER_ORG });
  assert.deepEqual([...new Set(seen)], [TEST_ORG], "chat et actions : une seule organisation est confrontée à la base");
  assert.deepEqual(admin.seenOrgs, [TEST_ORG]);
});

Deno.test("SEC-04 : une organisation qui n'existe pas et une organisation où l'on n'a aucun droit donnent la MÊME réponse (pas d'énumération)", async () => {
  const none = testAuthDeps(null);
  const handlers: Array<[string, (b: Record<string, unknown>) => Promise<Response>]> = [
    ["chat", (b) => post(createChatHandler({ ports: () => makeRig().ports, authDeps: none, limit: noLimit }), { ...b, message: "x" })],
    ["actions", (b) => post(createActionsHandler({ deps: () => makeActionRig().deps, authDeps: none, limit: noLimit }), approveBody(b))],
  ];
  for (const [name, call] of handlers) {
    const exists = await call({ orgId: TEST_ORG });
    const missing = await call({ orgId: OTHER_ORG });
    assert.equal(exists.status, 403, name);
    assert.equal(normalize(await exists.text()), normalize(await missing.text()), `${name} : réponses identiques`);
  }
  const a = adminRig(); const b = adminRig();
  const r1 = await a.call("org.freeze", { orgId: TEST_ORG }, { access: null });
  const r2 = await b.call("org.freeze", { orgId: OTHER_ORG }, { access: null });
  assert.equal(r1.status, 403);
  assert.equal(normalize(r1.text), normalize(r2.text));
});

// ------------------------------------------------------------------------------------------------------------- SEC-07 à SEC-10, SEC-12
Deno.test("SEC-07 : quand la base refuse l'approbation (auto-validation, valideur non éligible), rien ne s'exécute et le message reste fixe", async () => {
  const r = makeActionRig({ refuseApprove: new AppError(403, "forbidden", "Opération refusée : un valideur ne valide pas une action sur son propre compte.") });
  const res = await post(createActionsHandler({ deps: () => r.deps, authDeps: technician, limit: noLimit }), approveBody());
  assert.equal(res.status, 403);
  assert.equal(r.calls.invoked.length, 0, "aucun appel au connecteur");
  assert.equal(r.action.current?.status, "pending_approval", "la demande reste en attente");
});

Deno.test("SEC-08 : une empreinte différente de celle qui est stockée (l'action a changé depuis l'affichage) refuse l'approbation ET l'exécution", async () => {
  const r = makeActionRig();
  for (const seenHash of ["b".repeat(64), "", "A".repeat(64), HASH.slice(1)]) {
    const res = await post(createActionsHandler({ deps: () => r.deps, authDeps: technician, limit: noLimit }), approveBody({ seenHash }));
    assert.ok(res.status === 409 || res.status === 400, `empreinte « ${seenHash.slice(0, 8)} » : ${res.status}`);
  }
  assert.equal(r.calls.approve.length, 0);
  assert.equal(r.calls.invoked.length, 0);
});

Deno.test("SEC-09 : deux validations simultanées, un double clic ou une relance = AU PLUS une exécution ; une issue incertaine n'est jamais rejouée", async () => {
  const r = makeActionRig();
  const h = createActionsHandler({ deps: () => r.deps, authDeps: technician, limit: noLimit });
  const [a, b] = await Promise.all([post(h, approveBody()), post(h, approveBody())]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(r.calls.invoked.length, 1, "une seule exécution");
  const again = await post(h, approveBody());
  assert.equal(again.status, 409, "relance : refusée");
  assert.equal(r.calls.invoked.length, 1);
  // Reprise d'une exécution déjà traitée (réussie, échouée, incertaine) : toujours refusée, jamais rejouée toute seule.
  for (const status of ["succeeded", "failed", "unknown", "executing", "rejected", "expired", "cancelled"] as const) {
    const other = makeActionRig({ action: pendingAction({ status, approver_id: "123e4567-e89b-12d3-a456-426614174000", approved_hash: HASH }) });
    const res = await post(createActionsHandler({ deps: () => other.deps, authDeps: technician, limit: noLimit }), { orgId: TEST_ORG, op: "execute", actionId: ACTION_ID, microsoftToken: msToken() });
    assert.equal(res.status, 409, status);
    assert.equal(other.calls.invoked.length, 0, `${status} : aucun appel au connecteur`);
  }
});

Deno.test("SEC-10 : une demande expirée (personne n'a validé dans le délai) ne s'exécute jamais, même validée trop tard", async () => {
  const r = makeActionRig({ action: pendingAction({ expires_at: new Date((1_800_000_000 - 60) * 1000).toISOString() }) });
  const res = await post(createActionsHandler({ deps: () => r.deps, authDeps: technician, limit: noLimit }), approveBody());
  assert.ok(res.status === 409 || res.status === 403, String(res.status));
  assert.equal(r.calls.invoked.length, 0);
  assert.equal(r.calls.approve.length, 0);
});

Deno.test("SEC-12 : sans vérification d'identité hors bande valide (méthode absente ou inconnue), la validation est refusée côté serveur", async () => {
  const r = makeActionRig();
  const h = createActionsHandler({ deps: () => r.deps, authDeps: technician, limit: noLimit });
  for (const identityMethod of [undefined, null, "", "email", "sms", "Callback", "callback ", 1, ["callback"], { method: "callback" }]) {
    const res = await post(h, approveBody({ identityMethod }));
    assert.equal(res.status, 400, JSON.stringify(identityMethod));
  }
  assert.equal(r.calls.approve.length + r.calls.invoked.length, 0);
  for (const identityMethod of ["callback", "manager_confirmation", "in_person"]) {
    const ok = makeActionRig();
    assert.equal((await post(createActionsHandler({ deps: () => ok.deps, authDeps: technician, limit: noLimit }), approveBody({ identityMethod }))).status, 200, identityMethod);
  }
});

// ------------------------------------------------------------------------------------------------------------- SEC-11
Deno.test("SEC-11 : toute demande d'action sur un compte (préparée ou non, suspecte ou non, compte connu ou non, panne) reçoit EXACTEMENT la même réponse", async () => {
  const accountTriage = triageJson({ intent: "account_action", category: "mfa", requested_action: "mfa_reregister" });
  const cases: Array<[string, RigScript]> = [
    ["préparée", { prepare: { status: "prepared", actionId: "act-1", flags: [] } }],
    ["niveau 0", { prepare: { status: "not_prepared", reason: "niveau_0" } }],
    ["compte à privilèges (X1)", { prepare: { status: "not_prepared", reason: "compte_a_privileges" } }],
    ["salarié absent de l'annuaire", { prepare: { status: "not_prepared", reason: "identite_non_resolue" } }],
    ["diagnostic indisponible", { prepare: { status: "not_prepared", reason: "diagnostic_indisponible" } }],
    ["client non activé", { prepare: { status: "not_prepared", reason: "client_non_active" } }],
    ["suspecte X2", { prepare: { status: "suspicious", flags: ["X2"] } }],
    ["suspecte X3", { prepare: { status: "suspicious", flags: ["X3"] } }],
    ["suspecte X4", { prepare: { status: "suspicious", flags: ["X4"] } }],
    ["suspecte X2 X3 X4", { prepare: { status: "suspicious", flags: ["X2", "X3", "X4"] } }],
    ["panne de la préparation", { prepare: new Error("base muette") }],
    ["aucune action demandée", { triage: triageJson({ intent: "account_action", category: "mfa" }) }],
  ];
  const seen = new Map<string, string[]>();
  for (const [label, script] of cases) {
    const rig = makeRig({ triage: accountTriage, gate: "direct", ...script });
    const res = await post(createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps(), limit: noLimit }), { orgId: TEST_ORG, message: "Pouvez-vous réinitialiser mon authentification ?" });
    assert.equal(res.status, 200, label);
    const key = `${res.status}|${[...res.headers.entries()].filter(([k]) => !/^(x-request-id|date)$/.test(k)).map(([k, v]) => `${k}=${v}`).sort().join(",")}|${normalize(await res.text())}`;
    seen.set(key, [...(seen.get(key) ?? []), label]);
  }
  assert.equal(seen.size, 1, `les réponses diffèrent : ${JSON.stringify([...seen.values()])}`);
  const only = [...seen.keys()][0];
  assert.ok(only.includes(TEXTS.accountAction.slice(0, 40)));
  assert.ok(!/X[1-4]|suspect|privil|niveau|annuaire|risque/i.test(only.replace(TEXTS.accountAction, "")), "aucune trace de la règle qui a joué dans la réponse");
});

Deno.test("SEC-11 : le caractère suspect n'existe que pour les techniciens (ticket de sécurité de priorité haute), jamais pour le salarié", async () => {
  const rig = makeRig({ triage: triageJson({ intent: "account_action", category: "mfa", requested_action: "mfa_reregister" }), prepare: { status: "suspicious", flags: ["X3"] } as PrepareResult });
  await post(createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps(), limit: noLimit }), { orgId: TEST_ORG, message: "Réinitialisez mon authentification" });
  assert.equal(rig.tickets[0].security, true);
  assert.equal(rig.tickets[0].priority, "high");
  assert.ok(rig.messages.some((m) => m.visibility === "technician" && m.content.includes("SUSPECTE")));
  assert.ok(rig.messages.filter((m) => m.visibility === "public").every((m) => !/X3|suspect/i.test(m.content)));
});

// ------------------------------------------------------------------------------------------------------------- SEC-15
Deno.test("SEC-15 : le prompt système ne contient JAMAIS un contenu du salarié ni d'une fiche ; la donnée externe n'est que dans le message, encadrée", async () => {
  const marker = "ZZ-MARQUEUR-" + "EXTERNE-42";
  const rig = makeRig({ gate: "direct", hits: [{ documentId: "aaaaaaaa-0000-4000-8000-000000000001", title: `Fiche ${marker}`, text: `Contenu ${marker}`, score: 0.9 }] });
  await post(createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps(), limit: noLimit }), { orgId: TEST_ORG, message: `Mon imprimante ne répond plus ${marker}` });
  assert.ok(rig.calls.complete.length >= 2, "tri puis réponse");
  for (const req of rig.calls.complete) {
    assert.ok(!JSON.stringify(req.system).includes(marker), `prompt système « ${req.purpose} » sans donnée externe`);
    assert.ok(req.messages.every((m) => m.role !== ("system" as string)), "aucun rôle « system » dans les messages");
    const carriers = req.messages.filter((m) => m.content.includes(marker));
    assert.ok(carriers.length > 0, "la donnée externe est bien dans le message utilisateur");
    assert.ok(carriers.every((m) => /<donnee[ >]/.test(m.content) || /<donnee/.test(m.content)), "et encadrée comme donnée, pas comme consigne");
  }
});

// ------------------------------------------------------------------------------------------------------------- SEC-16
Deno.test("SEC-16 : un secret écrit par le salarié (mot de passe, jeton, clé) n'apparaît ni dans le stockage, ni dans les tickets, ni dans l'audit, ni dans les prompts, ni dans les journaux, même en cas d'erreur", async () => {
  const jwt = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJl" + "RmFjdGljZQ"].join(".");
  const supabaseKey = "sb_" + "secret_" + "AbCdEfGh1234IjKlMnOp";
  const password = "Tr0ub4dor" + "&3-Cheval";
  const message = `Bonjour, mon mot de passe est ${password} et mon jeton ${jwt}, la clé ${supabaseKey}. Mon imprimante est hors ligne.`;
  const secrets = [password, jwt, supabaseKey, jwt.split(".")[1]];

  const lines: string[] = [];
  const saved = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const k of ["info", "warn", "error", "log"] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    for (const mode of ["normal", "erreur_non_geree"] as const) {
      const rig = makeRig({ gate: "direct" });
      if (mode === "erreur_non_geree") {
        (rig.ports.llm as { complete: unknown }).complete = () => Promise.reject(new Error(`incident avec ${message}`));
      }
      const res = await post(createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps(), limit: noLimit }), { orgId: TEST_ORG, message });
      const everything = [await res.text(), JSON.stringify(rig.messages), JSON.stringify(rig.tickets), JSON.stringify(rig.audits), JSON.stringify(rig.usage),
        JSON.stringify(rig.calls.complete), JSON.stringify(rig.calls.embed), JSON.stringify(rig.updates), lines.join("\n")].join("\n");
      for (const secret of secrets) assert.ok(!everything.includes(secret), `${mode} : le secret « ${secret.slice(0, 6)}… » est présent quelque part`);
    }
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(lines.length > 0, "le journal a bien été capturé (le test fouille quelque chose)");
});

Deno.test("SEC-16 : un jeton Microsoft de valideur et un jeton d'invitation ne sortent ni dans la réponse, ni dans l'audit, ni dans les journaux", async () => {
  const lines: string[] = [];
  const saved = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const k of ["info", "warn", "error", "log"] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const token = msToken();
    const r = makeActionRig({ connectorFails: new Error(`échec avec ${token}`) });
    const res = await post(createActionsHandler({ deps: () => r.deps, authDeps: technician, limit: noLimit }), approveBody({ microsoftToken: token }));
    const dump = [await res.text(), JSON.stringify(r.audits), JSON.stringify(r.calls.finish), lines.join("\n")].join("\n");
    assert.ok(!dump.includes(token) && !dump.includes(token.split(".")[1]), "jeton Microsoft absent de tout ce qui est écrit");

    const admin = adminRig();
    const created = await admin.call("client.create", VALID_BODY["client.create"], { access: { org_role: "partner_admin" } });
    const inviteToken = String(created.json.invitationToken);
    const adminDump = [JSON.stringify(admin.db.inserts), JSON.stringify(admin.calls), lines.join("\n")].join("\n");
    assert.equal(inviteToken.length, 43);
    assert.ok(!adminDump.includes(inviteToken), "le jeton d'invitation en clair n'est ni audité, ni transmis au magasin, ni journalisé");
  } finally {
    Object.assign(console, saved);
  }
});

// ------------------------------------------------------------------------------------------------------------- SEC-19
Deno.test("SEC-19 : en mode ombre, rien de ce que l'IA écrit n'atteint le salarié (réponse HTTP comprise) ; le technicien reçoit le brouillon", async () => {
  const draft = "MARQUEUR-" + "BROUILLON-IA";
  const rig = makeRig({ gate: "shadow", answer: answerJson({ answer: draft }) });
  const res = await post(createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps(), limit: noLimit }), { orgId: TEST_ORG, message: "Mon imprimante est hors ligne" });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(draft), "le brouillon n'est pas dans la réponse envoyée au salarié");
  assert.ok(text.includes(TEXTS.shadow.slice(0, 40)));
  assert.ok(rig.messages.some((m) => m.visibility === "technician" && m.content.includes(draft)), "le technicien le reçoit pour le noter");
  assert.ok(rig.messages.filter((m) => m.role === "assistant" && m.visibility === "public").every((m) => !m.content.includes(draft)));
  // Si la porte ne répond pas, ou si la base refuse, on retombe en mode ombre : jamais en réponse directe.
  const broken = makeRig({ gate: "throw", answer: answerJson({ answer: draft }) });
  const res2 = await post(createChatHandler({ ports: () => broken.ports, authDeps: testAuthDeps(), limit: noLimit }), { orgId: TEST_ORG, message: "Mon imprimante est hors ligne" });
  assert.ok(!(await res2.text()).includes(draft));
});

// ------------------------------------------------------------------------------------------------------------- SEC-28
Deno.test("SEC-28 : organisation gelée = le chat ne sollicite plus le modèle, les actions ne s'exécutent plus", async () => {
  const frozen = testAuthDeps({ is_frozen: true });
  const rig = makeRig({ gate: "direct" });
  const res = await post(createChatHandler({ ports: () => rig.ports, authDeps: frozen, limit: noLimit }), { orgId: TEST_ORG, message: "Mon imprimante est hors ligne" });
  const json = await res.json();
  assert.equal(json.outcome, "frozen");
  assert.equal(rig.calls.complete.length + rig.calls.embed.length, 0, "aucun appel au modèle");
  const r = makeActionRig();
  const ares = await post(createActionsHandler({ deps: () => r.deps, authDeps: testAuthDeps({ org_role: "partner_technician", via: "partner", is_frozen: true }), limit: noLimit }), approveBody());
  assert.equal(ares.status, 403);
  assert.equal(r.calls.invoked.length, 0);
  const approved = makeActionRig({ action: pendingAction({ status: "approved", approver_id: "123e4567-e89b-12d3-a456-426614174000", approved_hash: HASH }) });
  const exec = await post(createActionsHandler({ deps: () => approved.deps, authDeps: testAuthDeps({ org_role: "partner_technician", via: "partner", is_frozen: true }), limit: noLimit }), { orgId: TEST_ORG, op: "execute", actionId: ACTION_ID, microsoftToken: msToken() });
  assert.equal(exec.status, 403, "même une action déjà approuvée ne s'exécute pas dans une organisation gelée");
  assert.equal(approved.calls.invoked.length, 0);
  assert.equal(approved.calls.markExecuting, 0);
});
