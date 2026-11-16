import assert from "node:assert/strict";
import { testAuthDeps, TEST_JWT, TEST_ORG } from "../testing.ts";
import { createActionsHandler } from "./handler.ts";
import { ACTION_ID, HASH, makeActionRig, msToken } from "./test_rig.ts";

const bearer = { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json" };
const technician = testAuthDeps({ org_role: "partner_technician", via: "partner" });
const call = (h: (r: Request) => Promise<Response>, body: Record<string, unknown> | string, headers: Record<string, string> = bearer, method = "POST") =>
  h(new Request("https://exemple.test/actions", { method, headers, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) }));
const approveBody = (over: Record<string, unknown> = {}) => ({ orgId: TEST_ORG, op: "approve", actionId: ACTION_ID, seenHash: HASH, identityMethod: "callback", microsoftToken: msToken(), ...over });

Deno.test("handler actions : un technicien valide, l'action s'exécute, la réponse ne contient JAMAIS le jeton", async () => {
  const r = makeActionRig();
  const h = createActionsHandler({ deps: () => r.deps, authDeps: technician });
  const token = msToken();
  const res = await call(h, approveBody({ microsoftToken: token }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { actionId: ACTION_ID, status: "succeeded" });
  assert.ok(!text.includes(token));
});

Deno.test("handler actions : un salarié, un administrateur sans rôle de technicien ou un inconnu ne valident rien (403, sans détail)", async () => {
  for (const access of [{ org_role: "end_user" }, { org_role: "org_admin" }, { org_role: "partner_admin", via: "partner" }] as const) {
    const r = makeActionRig();
    const h = createActionsHandler({ deps: () => r.deps, authDeps: testAuthDeps(access) });
    const res = await call(h, approveBody());
    assert.equal(res.status, 403, access.org_role);
    assert.equal(r.calls.approve.length + r.calls.invoked.length, 0);
  }
  const none = createActionsHandler({ deps: () => makeActionRig().deps, authDeps: testAuthDeps(null) });
  assert.equal((await call(none, approveBody())).status, 403);
});

Deno.test("handler actions : méthode, jeton, corps et opération invalides refusés", async () => {
  const r = makeActionRig();
  const h = createActionsHandler({ deps: () => r.deps, authDeps: technician });
  assert.equal((await call(h, "", bearer, "GET")).status, 405);
  assert.equal((await call(h, approveBody(), { "content-type": "application/json" })).status, 401);
  assert.equal((await call(h, "pas du json")).status, 400);
  assert.equal((await call(h, { ...approveBody(), op: "supprimer" })).status, 400);
  assert.equal((await call(h, { ...approveBody(), op: undefined })).status, 400);
  assert.equal((await call(h, { ...approveBody(), orgId: undefined })).status, 400);
  assert.equal(r.calls.approve.length + r.calls.invoked.length, 0);
});

Deno.test("handler actions : refus d'une action, et reprise d'exécution d'une action approuvée", async () => {
  const rej = makeActionRig();
  const h = createActionsHandler({ deps: () => rej.deps, authDeps: technician });
  const res = await call(h, { orgId: TEST_ORG, op: "reject", actionId: ACTION_ID, reason: "mauvaise_cible" });
  assert.equal(res.status, 200);
  assert.deepEqual(rej.calls.reject, ["mauvaise_cible"]);
  const bad = await call(h, { orgId: TEST_ORG, op: "reject", actionId: ACTION_ID, reason: "parce que" });
  assert.equal(bad.status, 400);

  const exec = makeActionRig({ action: { ...makeActionRig().action.current!, status: "approved", approver_id: "123e4567-e89b-12d3-a456-426614174000", approved_hash: HASH } });
  const h2 = createActionsHandler({ deps: () => exec.deps, authDeps: technician });
  assert.equal((await call(h2, { orgId: TEST_ORG, op: "execute", actionId: ACTION_ID, microsoftToken: msToken() })).status, 200);
  assert.equal(exec.calls.invoked.length, 1);
  assert.equal((await call(h2, { orgId: TEST_ORG, op: "execute", actionId: ACTION_ID })).status, 400);
});

Deno.test("handler actions : une erreur interne inattendue ne laisse filtrer AUCUN détail", async () => {
  const r = makeActionRig();
  const boom = { ...r.deps, store: { ...r.deps.store, load: () => Promise.reject(new Error("connexion refusée à db.interne.exemple.test, password=SuperSecret99")) } };
  const original = console.error;
  console.error = () => {};
  try {
    const res = await call(createActionsHandler({ deps: () => boom, authDeps: technician }), approveBody());
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.ok(!text.includes("SuperSecret99") && !text.includes("db.interne"));
  } finally {
    console.error = original;
  }
});
