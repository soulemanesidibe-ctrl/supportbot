import assert from "node:assert/strict";
import { clearConnectorFactories, connectorById, connectorFor } from "../capabilities/registry.ts";
import { fakeSupabase, makeAuth, Op, TEST_ORG } from "../testing.ts";
import { parseSuffixes, registerConnectors } from "./register.ts";
import type { SecretPort } from "./secrets.ts";

const row = (type: string, over: Record<string, unknown> = {}) => ({ id: "c1", org_id: TEST_ORG, type, name: "n", environment: "test", status: "ok", config: { base_url: "https://client.glpi.exemple.fr" }, tenant_id: null, vault_secret_id: "v", ...over });
const secrets: SecretPort = { get: () => Promise.resolve(JSON.stringify({ user_token: "jeton-utilisateur-1234" })), set: () => Promise.resolve() };

Deno.test("parseSuffixes : domaines valides seulement, en minuscules", () => {
  assert.deepEqual(parseSuffixes(" .GLPI-network.cloud , exemple.fr,, pas un domaine, localhost, -x.fr,.a "), [".glpi-network.cloud", "exemple.fr"]);
  assert.deepEqual(parseSuffixes(undefined), []);
  assert.deepEqual(parseSuffixes(""), []);
});

Deno.test("registre : le connecteur GLPI est disponible ; le connecteur « démo » est INERTE par défaut (jamais en production par accident)", async () => {
  clearConnectorFactories();
  registerConnectors({ secrets, allowedSuffixes: [] });
  const auth = await makeAuth({ org_role: "end_user" });
  const f = fakeSupabase((_op: Op) => ({ data: [row("demo", { id: "d1" }), row("glpi")], error: null }));
  const c = await connectorFor(auth, "ticket.create", f.deps);
  assert.equal(c.type, "glpi", "le connecteur démo est ignoré, GLPI est pris");
  const onlyDemo = fakeSupabase(() => ({ data: [row("demo", { id: "d1" })], error: null }));
  await assert.rejects(() => connectorFor(auth, "ticket.create", onlyDemo.deps), { code: "service_unavailable" });
  clearConnectorFactories();
  registerConnectors({ secrets, allowDemo: true });
  assert.equal((await connectorFor(auth, "ticket.create", onlyDemo.deps)).type, "demo");
  clearConnectorFactories();
});

Deno.test("registre : un connecteur GLPI dont l'adresse n'est pas publique n'est jamais construit (la ligne en base est ignorée par la fabrique qui échoue)", async () => {
  clearConnectorFactories();
  registerConnectors({ secrets });
  const auth = await makeAuth({ org_role: "end_user" });
  const f = fakeSupabase(() => ({ data: [row("glpi", { config: { base_url: "https://169.254.169.254" } })], error: null }));
  await assert.rejects(() => connectorFor(auth, "ticket.create", f.deps));
  clearConnectorFactories();
});

Deno.test("connectorById : filtré par identifiant ET organisation du contexte ; ligne d'une autre organisation = introuvable ; type sans fabrique = indisponible", async () => {
  clearConnectorFactories();
  registerConnectors({ secrets });
  const auth = await makeAuth({ org_role: "org_admin" });
  const f = fakeSupabase(() => ({ data: row("glpi"), error: null }));
  const c = await connectorById(auth, "c1", f.deps);
  assert.equal(c.id, "c1");
  const op = f.ops[0];
  assert.ok(op.filters.some(([k, col, v]) => k === "eq" && col === "id" && v === "c1") && op.filters.some(([k, col, v]) => k === "eq" && col === "org_id" && v === TEST_ORG));
  const foreign = fakeSupabase(() => ({ data: row("glpi", { org_id: "923e4567-e89b-12d3-a456-426614174000" }), error: null }));
  await assert.rejects(() => connectorById(auth, "c1", foreign.deps), { code: "not_found" });
  const none = fakeSupabase(() => ({ data: null, error: null }));
  await assert.rejects(() => connectorById(auth, "c1", none.deps), { code: "not_found" });
  const unknownType = fakeSupabase(() => ({ data: row("m365"), error: null }));
  await assert.rejects(() => connectorById(auth, "c1", unknownType.deps), { code: "service_unavailable" });
  clearConnectorFactories();
});
