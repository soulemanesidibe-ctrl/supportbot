import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { makeAuth, makeCronAuth, TEST_ORG, TEST_USER } from "../testing.ts";
import { assertApprovedActionRequest, connectorParams, executeApprovedAction } from "./execute.ts";
import { ACTION_ID, ActionRigScript, ConnectorError, HASH, makeActionRig, msToken, NOW, pendingAction } from "./test_rig.ts";

const ctxAuth = () => makeAuth({ org_role: "partner_technician", via: "partner" });
const approved = (over = {}) => pendingAction({ status: "approved", approver_id: TEST_USER, approved_hash: HASH, ...over });
const rig = (script: ActionRigScript = {}) => makeActionRig({ action: approved(), ...script });
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("exécution : action approuvée = connecteur appelé UNE fois, avec l'identité du valideur, puis « succeeded » et audit", async () => {
  const r = rig();
  const token = msToken();
  const out = await executeApprovedAction(await makeAuth({ org_role: "partner_technician", via: "partner" }), ACTION_ID, token, r.deps);
  assert.deepEqual(out, { actionId: ACTION_ID, status: "succeeded" });
  assert.equal(r.calls.invoked.length, 1);
  const ctx = r.calls.invoked[0].ctx as { actor: { kind: string; userId: string; delegatedToken: string }; actionRequestId: string; idempotencyKey: string; orgId: string };
  assert.deepEqual({ kind: ctx.actor.kind, user: ctx.actor.userId, token: ctx.actor.delegatedToken, req: ctx.actionRequestId, idem: ctx.idempotencyKey, org: ctx.orgId },
    { kind: "human", user: TEST_USER, token, req: ACTION_ID, idem: HASH, org: TEST_ORG });
  assert.equal(r.calls.finish[0].status, "succeeded");
  assert.equal(r.audits.find((a) => a.table === "audit_logs")?.row.event, "action.succeeded");
});

Deno.test("le jeton délégué n'est JAMAIS stocké ni journalisé : ni dans le résultat, ni dans l'audit", async () => {
  const r = rig();
  const token = msToken();
  await executeApprovedAction(await makeAuth(), ACTION_ID, token, r.deps);
  const everything = JSON.stringify([r.calls.finish, r.audits]);
  assert.ok(!everything.includes(token) && !everything.includes("signature-factice"));
});

Deno.test("exécution : tout autre état que « approuvée » est refusé SANS toucher au connecteur", async () => {
  for (const status of ["pending_approval", "executing", "succeeded", "failed", "unknown", "rejected", "expired", "cancelled"] as const) {
    const r = rig({ action: approved({ status }) });
    assert.equal(await code(executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), r.deps)), "conflict", status);
    assert.equal(r.calls.invoked.length + r.calls.markExecuting, 0, status);
  }
});

Deno.test("empreinte : l'action approuvée doit porter EXACTEMENT l'empreinte stockée (M12)", async () => {
  for (const approvedHash of [null, "b".repeat(64), HASH.toUpperCase()]) {
    const r = rig({ action: approved({ approved_hash: approvedHash }) });
    assert.equal(await code(executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), r.deps)), "conflict", String(approvedHash));
    assert.equal(r.calls.invoked.length, 0);
  }
});

Deno.test("exécution : action expirée, d'une autre organisation, ou exécutée par quelqu'un d'autre que le valideur = refusée", async () => {
  const expired = rig({ action: approved({ expires_at: new Date((NOW - 1) * 1000).toISOString() }) });
  assert.equal(await code(assertApprovedActionRequest(await makeAuth(), ACTION_ID, expired.deps.store, NOW * 1000)), "conflict");
  const other = rig({ action: approved({ org_id: "00000000-0000-4000-8000-0000000000ff" }) });
  assert.equal(await code(executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), other.deps)), "not_found");
  const wrongApprover = rig({ action: approved({ approver_id: "00000000-0000-4000-8000-0000000000aa" }) });
  assert.equal(await code(executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), wrongApprover.deps)), "forbidden", "on exécute avec SON identité, pas celle d'un autre");
  const noApprover = rig({ action: approved({ approver_id: null }) });
  assert.equal(await code(executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), noApprover.deps)), "forbidden");
  for (const r of [other, wrongApprover, noApprover]) assert.equal(r.calls.invoked.length, 0);
});

Deno.test("exécution : organisation gelée, accès en lecture seule ou tâche planifiée = rien ne s'exécute", async () => {
  const frozen = rig();
  assert.equal(await code(executeApprovedAction(await makeAuth({ is_frozen: true }), ACTION_ID, msToken(), frozen.deps)), "org_frozen");
  const ro = rig();
  assert.equal(await code(executeApprovedAction(await makeAuth({ org_role: "super_admin", via: "support_access", read_only: true }), ACTION_ID, msToken(), ro.deps)), "read_only");
  const cron = rig();
  assert.equal(await code(executeApprovedAction(await makeCronAuth(), ACTION_ID, msToken(), cron.deps)), "not_found");
  for (const r of [frozen, ro, cron]) assert.equal(r.calls.invoked.length + r.calls.markExecuting, 0);
});

Deno.test("jeton : celui d'un autre compte, d'un autre locataire, expiré, absent ou trop court = refusé AVANT tout changement d'état", async () => {
  for (const [label, token, script] of [
    ["autre compte", msToken({ oid: "object-autre" }), {}],
    ["autre locataire", msToken({ tid: "autre-locataire" }), {}],
    ["expiré", msToken({ exp: NOW - 5 }), {}],
    ["aucun compte lié", msToken(), { binding: null }],
    ["trop court", "abc", {}],
    ["vide", "", {}],
  ] as Array<[string, string, ActionRigScript]>) {
    const r = rig(script);
    assert.notEqual(await code(executeApprovedAction(await makeAuth(), ACTION_ID, token, r.deps)), "aucune erreur", label);
    assert.equal(r.calls.markExecuting + r.calls.invoked.length, 0, `${label} : aucun état changé`);
  }
});

Deno.test("exécution : le connecteur ne sait pas faire la capacité = indisponible, rien ne change", async () => {
  const r = rig({ capabilities: [] });
  assert.equal(await code(executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), r.deps)), "service_unavailable");
  assert.equal(r.calls.markExecuting, 0);
});

Deno.test("au plus UNE exécution : deux requêtes simultanées pour la même action n'appellent le connecteur qu'une fois (M13)", async () => {
  const r = rig();
  const auth = await makeAuth();
  const results = await Promise.allSettled([
    executeApprovedAction(auth, ACTION_ID, msToken(), r.deps),
    executeApprovedAction(auth, ACTION_ID, msToken(), r.deps),
  ]);
  assert.equal(r.calls.invoked.length, 1, "une seule exécution");
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);
});

Deno.test("valideur devenu non éligible entre l'approbation et l'exécution (I5) : la base refuse, le connecteur n'est jamais appelé", async () => {
  const r = rig({ refuseExecuting: new AppError(403, "forbidden", "Opération refusée : vous n'êtes pas (ou plus) éligible pour cette validation.") });
  assert.equal(await code(executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), r.deps)), "forbidden");
  assert.equal(r.calls.invoked.length, 0);
  assert.equal(r.calls.finish.length, 0);
});

Deno.test("issue : échec certain = « failed », issue incertaine = « unknown » ; JAMAIS rejouée seule ; aucun détail du connecteur ne fuit", async () => {
  for (const [label, err, expected] of [
    ["échec certain", new ConnectorError("failed", "403 droits insuffisants sur https://graph.interne.exemple.test jeton=secret-abc"), "failed"],
    ["issue incertaine", new ConnectorError("unknown", "délai dépassé après envoi"), "unknown"],
    ["erreur inconnue", new Error("ECONNRESET à https://graph.interne.exemple.test"), "unknown"],
  ] as Array<[string, Error, string]>) {
    const r = rig({ connectorFails: err });
    const out = await executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), r.deps);
    assert.equal(out.status, expected, label);
    assert.equal(r.calls.invoked.length, 1, `${label} : jamais de relance automatique`);
    assert.deepEqual(r.calls.finish[0].result, { outcome: expected });
    assert.ok(!JSON.stringify([r.calls.finish, r.audits]).includes("graph.interne") && !JSON.stringify(r.audits).includes("abc"), label);
  }
});

Deno.test("résultat : les secrets sont masqués (le mot de passe temporaire ne va qu'au technicien), un résultat énorme est écarté", async () => {
  const leaky = rig({ result: { ok: true, temporaryPassword: "Azerty123!", note: "mot de passe est Soleil42x" } });
  await executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), leaky.deps);
  const stored = JSON.stringify(leaky.calls.finish[0].result);
  assert.ok(!stored.includes("Azerty123") && !stored.includes("Soleil42x"));
  const huge = rig({ result: { ok: true, blob: Array.from({ length: 40 }, () => "x".repeat(400)) } });
  await executeApprovedAction(await makeAuth(), ACTION_ID, msToken(), huge.deps);
  assert.deepEqual(huge.calls.finish[0].result, { tronque: true });
});

Deno.test("paramètres du connecteur : la CIBLE vient de l'action approuvée (couverte par l'empreinte), jamais des paramètres libres", async () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["user.reset_password", { userRef: "autre.compte@client.test" }, { userRef: "marie@client-alpha.test" }],
    ["user.unlock", {}, { userRef: "marie@client-alpha.test" }],
    ["ticket.update_status", { status: "solved", ref: "999" }, { status: "solved", ref: "marie@client-alpha.test" }],
  ];
  for (const [capability, params, expected] of cases) {
    const r = rig({ capabilities: ["user.reset_password", "user.unlock", "ticket.update_status"], action: pendingAction({ capability, params, status: "approved", approver_id: "123e4567-e89b-12d3-a456-426614174000", approved_hash: HASH }) });
    await executeApprovedAction(await ctxAuth(), ACTION_ID, msToken(), r.deps);
    assert.deepEqual(r.calls.invoked[0].params, expected, capability);
  }
  assert.deepEqual(connectorParams(pendingAction({ capability: "user.unlock", params: [] as never })), { userRef: "marie@client-alpha.test" }, "des paramètres non objet sont ignorés");
});

Deno.test("mot de passe temporaire : remis UNE fois, dans la réponse au technicien qui valide, et nulle part ailleurs (ni résultat stocké, ni audit, ni journal)", async () => {
  const secret = ["Temp", "Secret", "9x7"].join("-");
  const lines: string[] = [];
  const saved = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const k of ["info", "warn", "error", "log"] as const) console[k] = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const r = rig({ secret, action: pendingAction({ capability: "user.reset_password", status: "approved", approver_id: "123e4567-e89b-12d3-a456-426614174000", approved_hash: HASH }) });
    const out = await executeApprovedAction(await ctxAuth(), ACTION_ID, msToken(), r.deps);
    assert.deepEqual(out, { actionId: ACTION_ID, status: "succeeded", oneTimeSecret: { kind: "temporary_password", value: secret } });
    const stored = JSON.stringify([r.calls.finish, r.audits, r.action.current, lines]);
    assert.ok(!stored.includes(secret), "le secret n'est ni stocké, ni audité, ni journalisé");
    // Échec ou issue incertaine après le dépôt du secret : il n'est PAS rendu (il ne correspond à rien d'utilisable).
    for (const [label, fails] of [["échec", new ConnectorError("failed", "x")], ["incertain", new Error("réseau")]] as const) {
      const f = rig({ secret, connectorFails: fails, action: pendingAction({ capability: "user.reset_password", status: "approved", approver_id: "123e4567-e89b-12d3-a456-426614174000", approved_hash: HASH }) });
      const o = await executeApprovedAction(await ctxAuth(), ACTION_ID, msToken(), f.deps);
      assert.equal(o.oneTimeSecret, undefined, label);
    }
  } finally { Object.assign(console, saved); }
});
