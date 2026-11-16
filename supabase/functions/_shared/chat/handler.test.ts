import assert from "node:assert/strict";
import { makeRig } from "./test_rig.ts";
import { createChatHandler } from "./handler.ts";
import { TEST_ORG, testAuthDeps, TEST_JWT } from "../testing.ts";

const bearer = { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json" };
const body = (o: Record<string, unknown>) => JSON.stringify(o);
const call = (handler: (r: Request) => Promise<Response>, init: { method?: string; headers?: Record<string, string>; body?: string }) =>
  handler(new Request("https://exemple.test/chat", { method: init.method ?? "POST", headers: init.headers ?? bearer, body: init.body }));

Deno.test("handler : succès, réponse JSON marquée « assistant IA » et identifiant de requête", async () => {
  const rig = makeRig({ gate: "direct" });
  const h = createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps() });
  const res = await call(h, { body: body({ orgId: TEST_ORG, message: "Mon imprimante est hors ligne" }) });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("x-request-id"));
  const json = await res.json();
  assert.equal(json.ai, true);
  assert.equal(json.outcome, "answered");
});

Deno.test("handler : méthode autre que POST = 405, sans jeton = 401, mauvais corps = 400", async () => {
  const rig = makeRig();
  const h = createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps() });
  assert.equal((await call(h, { method: "GET", body: undefined })).status, 405);
  assert.equal((await call(h, { headers: { "content-type": "application/json" }, body: body({ orgId: TEST_ORG, message: "x" }) })).status, 401);
  assert.equal((await call(h, { headers: { ...bearer, "content-type": "text/plain" }, body: "x" })).status, 400);
  assert.equal((await call(h, { body: "pas du json" })).status, 400);
  assert.equal((await call(h, { body: body({ message: "x" }) })).status, 400, "organisation absente");
  assert.equal((await call(h, { body: body({ orgId: TEST_ORG, message: "x", conversationId: 42 }) })).status, 400);
  assert.equal(rig.messages.length + rig.calls.complete.length, 0, "rien n'a été fait");
});

Deno.test("handler : sans droit dans l'organisation, ou avec un rôle autre que salarié = 403, identique et sans détail", async () => {
  const rig = makeRig();
  const none = createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps(null) });
  const technician = createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps({ org_role: "partner_technician", via: "partner" }) });
  const a = await call(none, { body: body({ orgId: TEST_ORG, message: "x" }) });
  const b = await call(technician, { body: body({ orgId: TEST_ORG, message: "x" }) });
  assert.equal(a.status, 403);
  assert.equal(b.status, 403);
  assert.deepEqual((await a.json()).error.message, (await b.json()).error.message);
  assert.equal(rig.messages.length + rig.calls.complete.length, 0);
});

Deno.test("handler : une erreur interne inattendue ne laisse filtrer AUCUN détail", async () => {
  const rig = makeRig();
  const boom = { ...rig.ports, store: { ...rig.ports.store, openConversation: () => Promise.reject(new Error("connexion refusée à db.interne.exemple.test, password=SuperSecret99")) } };
  const original = console.error;
  console.error = () => {};
  try {
    const h = createChatHandler({ ports: () => boom, authDeps: testAuthDeps() });
    const res = await call(h, { body: body({ orgId: TEST_ORG, message: "Bonjour, l'imprimante" }) });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.ok(!text.includes("SuperSecret99") && !text.includes("db.interne"));
  } finally {
    console.error = original;
  }
});
