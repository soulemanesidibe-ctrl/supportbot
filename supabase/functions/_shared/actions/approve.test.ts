import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { makeAuth, TEST_JWT, TEST_ORG, TEST_USER } from "../testing.ts";
import { requireOrgMember } from "../auth.ts";
import { approveAction, rejectAction } from "./approve.ts";
import { ACTION_ID, ActionRigScript, HASH, makeActionRig, msToken, pendingAction } from "./test_rig.ts";

const tech = { org_role: "partner_technician", via: "partner" } as const;
const input = (over: Record<string, unknown> = {}) => ({ actionId: ACTION_ID, seenHash: HASH, identityMethod: "callback", viaDelegationId: null, delegatedToken: msToken(), ...over });
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}
const rig = (script: ActionRigScript = {}) => makeActionRig(script);

Deno.test("validation : le valideur voit l'action EXACTE, valide avec une vérification d'identité, et l'action s'exécute dans la même requête", async () => {
  const r = rig();
  const out = await approveAction(await makeAuth(tech), input({ identityMethod: "manager_confirmation", viaDelegationId: "eeeeeeee-0000-4000-8000-000000000001" }), r.deps);
  assert.deepEqual(out, { actionId: ACTION_ID, status: "succeeded" });
  assert.deepEqual(r.calls.approve, [{ approvedHash: HASH, identityMethod: "manager_confirmation", viaDelegationId: "eeeeeeee-0000-4000-8000-000000000001" }]);
  assert.equal(r.calls.invoked.length, 1);
  const events = r.audits.filter((a) => a.table === "audit_logs").map((a) => a.row.event);
  assert.deepEqual(events, ["action.approved", "action.succeeded"]);
});

Deno.test("entrées : identifiant, empreinte, méthode d'identité, délégation ou jeton invalides = refusés AVANT toute lecture", async () => {
  const bad: Array<Record<string, unknown>> = [
    { actionId: "pas-un-uuid" }, { actionId: undefined }, { seenHash: "abc" }, { seenHash: HASH + "0" }, { seenHash: undefined },
    { identityMethod: "sms" }, { identityMethod: "" }, { identityMethod: undefined }, { viaDelegationId: "x" }, { viaDelegationId: 5 }, { delegatedToken: undefined }, { delegatedToken: 12 },
  ];
  for (const b of bad) {
    const r = rig();
    assert.equal(await code(approveAction(await makeAuth(tech), input(b), r.deps)), "bad_request", JSON.stringify(b));
    assert.equal(r.calls.approve.length + r.calls.invoked.length, 0);
  }
});

Deno.test("second facteur : valider exige un MFA de moins de 10 minutes (aal2) ; sinon rien ne bouge", async () => {
  const old = await requireOrgMember(new Request("https://exemple.test", { headers: { authorization: `Bearer ${TEST_JWT}` } }), TEST_ORG, undefined, {
    verifyToken: () => Promise.resolve({ userId: TEST_USER, aal: "aal2", amr: [{ method: "totp", timestamp: 1_800_000_000 - 3600 }] }),
    resolveAccess: () => Promise.resolve({ org_role: "partner_technician", via: "partner", org_type: "client", org_state: "pilot", is_frozen: false, is_activated: true, read_only: false }),
    cronSecret: () => undefined,
    nowSeconds: () => 1_800_000_000,
  });
  const r = rig();
  // Le banc fixe l'horloge à NOW : un second facteur vieux d'une heure est trop ancien.
  assert.equal(await code(approveAction(old, input(), r.deps)), "mfa_required");
  assert.equal(r.calls.approve.length, 0);
});

Deno.test("M12 : si l'action a changé depuis l'affichage (empreinte différente), la validation est refusée", async () => {
  const r = rig();
  assert.equal(await code(approveAction(await makeAuth(tech), input({ seenHash: "b".repeat(64) }), r.deps)), "conflict");
  assert.equal(r.calls.approve.length + r.calls.invoked.length, 0);
});

Deno.test("validation : une action qui n'attend plus, introuvable ou d'une autre organisation = refusée", async () => {
  for (const [label, action, expected] of [
    ["déjà approuvée", pendingAction({ status: "approved" }), "conflict"],
    ["déjà refusée", pendingAction({ status: "rejected" }), "conflict"],
    ["introuvable", null, "not_found"],
    ["autre organisation", pendingAction({ org_id: "00000000-0000-4000-8000-0000000000ff" }), "not_found"],
  ] as Array<[string, ReturnType<typeof pendingAction> | null, string]>) {
    const r = rig({ action });
    assert.equal(await code(approveAction(await makeAuth(tech), input(), r.deps)), expected, label);
    assert.equal(r.calls.approve.length + r.calls.invoked.length, 0, label);
  }
});

Deno.test("pas d'approbation laissée sans suite : un jeton invalide ou un compte non lié est refusé AVANT d'approuver", async () => {
  for (const script of [{ binding: null }, {}] as ActionRigScript[]) {
    const r = rig(script);
    const token = script.binding === null ? msToken() : msToken({ oid: "object-autre" });
    assert.equal(await code(approveAction(await makeAuth(tech), input({ delegatedToken: token }), r.deps)), "forbidden");
    assert.equal(r.calls.approve.length, 0, "aucune approbation");
    assert.equal(r.action.current?.status, "pending_approval");
  }
});

Deno.test("la base refuse l'approbation (auto-validation, identité, éligibilité...) : le connecteur n'est jamais appelé", async () => {
  const r = rig({ refuseApprove: new AppError(403, "forbidden", "Opération refusée : un valideur ne valide pas une action sur son propre compte.") });
  assert.equal(await code(approveAction(await makeAuth(tech), input(), r.deps)), "forbidden");
  assert.equal(r.calls.invoked.length, 0);
  assert.equal(r.audits.filter((a) => a.table === "audit_logs").length, 0, "pas d'événement « approuvée » pour une validation refusée");
});

Deno.test("refus d'une action : motif dans une liste, action en attente seulement, tracé", async () => {
  const r = rig();
  await rejectAction(await makeAuth(tech), { actionId: ACTION_ID, reason: "identite_non_confirmee" }, r.deps);
  assert.deepEqual(r.calls.reject, ["identite_non_confirmee"]);
  assert.equal(r.audits.find((a) => a.table === "audit_logs")?.row.event, "action.rejected");
  for (const reason of ["parce que", "", undefined, 42]) {
    assert.equal(await code(rejectAction(await makeAuth(tech), { actionId: ACTION_ID, reason }, rig().deps)), "bad_request", String(reason));
  }
  assert.equal(await code(rejectAction(await makeAuth(tech), { actionId: ACTION_ID, reason: "autre" }, rig({ action: pendingAction({ status: "succeeded" }) }).deps)), "conflict");
  assert.equal(await code(rejectAction(await makeAuth({ is_frozen: true }), { actionId: ACTION_ID, reason: "autre" }, rig().deps)), "org_frozen");
});
