import assert from "node:assert/strict";
import type { InvocationContext } from "../capabilities/types.ts";
import { DemoConnector } from "./demo.ts";
import { ConnectorHttpError } from "./http.ts";

const CTX: InvocationContext = { orgId: "o", connectorId: "demo-1", requestId: "r", actor: { kind: "agent", conversationId: "c" } };
const NOW = "2026-11-16T10:00:00.000Z";
const mk = () => new DemoConnector("demo-1", () => NOW);
async function kind(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof ConnectorHttpError ? `${e.kind}:${e.status}` : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("démo : les 14 capacités de la démonstration, de type « test », sans aucun accès réseau", async () => {
  const c = mk();
  assert.equal(c.capabilities().size, 14);
  assert.equal(c.environment, "test");
  const real = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("réseau interdit"); }) as unknown as typeof fetch;
  try {
    await c.invokeCapability("ticket.create", { title: "Test", body: "x", category: "vpn", priority: "low", requesterRef: "a@b.fr" }, CTX);
    assert.equal((await c.health()).ok, true);
  } finally { globalThis.fetch = real; }
});

Deno.test("démo : tickets : création, lecture, recherche, suivi, statut, lien parent ; références validées", async () => {
  const c = mk();
  const t = await c.invokeCapability("ticket.create", { title: "Imprimante HS", body: "x", category: "printer", priority: "high", requesterRef: "a@b.fr" }, CTX);
  assert.equal(t.ref, "DEMO-1");
  assert.equal((await c.invokeCapability("ticket.get", { ref: "DEMO-1" }, CTX)).status, "new");
  assert.equal((await c.invokeCapability("ticket.search", { query: "imprim" }, CTX)).length, 1);
  assert.deepEqual(await c.invokeCapability("ticket.search", { query: "inexistant" }, CTX), []);
  await c.invokeCapability("ticket.comment", { ref: "DEMO-1", body: "ok", internal: true }, CTX);
  await c.invokeCapability("ticket.update_status", { ref: "DEMO-1", status: "solved" }, CTX);
  assert.equal((await c.invokeCapability("ticket.get", { ref: "DEMO-1" }, CTX)).status, "solved");
  await c.invokeCapability("ticket.create", { title: "Parent", body: "x", category: "vpn", priority: "low", requesterRef: "a@b.fr" }, CTX);
  assert.deepEqual(await c.invokeCapability("ticket.link_parent", { parentRef: "DEMO-2", childRef: "DEMO-1" }, CTX), { ok: true });
  for (const bad of ["../x", "DEMO-", "1", "demo-1", "DEMO-1; drop", "", 5 as never]) assert.match(await kind(c.invokeCapability("ticket.get", { ref: bad }, CTX)), /rejected:400/, String(bad));
  assert.equal(await kind(c.invokeCapability("ticket.get", { ref: "DEMO-999" }, CTX)), "not_found:404");
  assert.equal(await kind(c.invokeCapability("ticket.update_status", { ref: "DEMO-1", status: "supprimé" as never }, CTX)), "rejected:400");
});

Deno.test("démo : le diagnostic dépend de la référence (comptes de démonstration) : ordinaire, privilégié, suspect, verrouillé, échecs", async () => {
  const c = mk();
  const d = (userRef: string) => c.invokeCapability("user.diagnose", { userRef }, CTX);
  assert.deepEqual({ ...(await d("marie@x.fr")), mfaMethods: undefined }, { accountEnabled: true, locked: false, mfaMethods: undefined, lastPasswordChangeAt: "2026-10-07T10:00:00.000Z", recentFailedSignIns: 0, hasPrivilegedRole: false });
  assert.equal((await d("admin.demo@x.fr")).hasPrivilegedRole, true);
  assert.equal((await d("verrou@x.fr")).locked, true);
  assert.equal((await d("echecs@x.fr")).recentFailedSignIns, 14);
  assert.equal(Date.parse(NOW) - Date.parse((await d("suspect@x.fr")).mfaMethods[0].createdAt), 2 * 3_600_000);
  assert.equal((await d("desactive@x.fr")).accountEnabled, false);
});

Deno.test("démo : les actions privilégiées sont ENREGISTRÉES (effets) et exigent une cible ; aucun mot de passe n'est renvoyé", async () => {
  const c = mk();
  assert.deepEqual(await c.invokeCapability("user.reset_password", { userRef: "marie@x.fr" }, CTX), { ok: true, temporaryPasswordDeliveredTo: "technician" });
  await c.invokeCapability("user.unlock", { userRef: "marie@x.fr" }, CTX);
  await c.invokeCapability("user.revoke_sessions", { userRef: "marie@x.fr" }, CTX);
  await c.invokeCapability("user.mfa_reregister", { userRef: "marie@x.fr" }, CTX);
  assert.deepEqual(c.effects.map((e) => e.capability), ["user.reset_password", "user.unlock", "user.revoke_sessions", "user.mfa_reregister"]);
  assert.equal(await kind(c.invokeCapability("user.unlock", { userRef: "" }, CTX)), "rejected:400");
  assert.equal(c.effects.length, 4);
});

Deno.test("démo : alertes : une alerte identique est dédupliquée et comptée ; les alertes résolues ne sont plus actives", async () => {
  const c = mk();
  const alert = { sourceId: "s", dedupKey: "h1:cpu", asset: { kind: "host" as const, name: "srv-1" }, severity: "major" as const, state: "open" as const, summary: "CPU", occurredAt: NOW, raw: {} };
  assert.equal((await c.invokeCapability("alert.ingest", { alert }, CTX)).deduplicated, false);
  assert.equal((await c.invokeCapability("alert.ingest", { alert }, CTX)).deduplicated, true);
  const active = await c.invokeCapability("alert.list_active", {}, CTX);
  assert.equal(active.length, 1);
  assert.equal(active[0].count, 2);
  await c.invokeCapability("alert.ingest", { alert: { ...alert, state: "resolved" } }, CTX);
  assert.equal((await c.invokeCapability("alert.list_active", {}, CTX)).length, 0);
});
