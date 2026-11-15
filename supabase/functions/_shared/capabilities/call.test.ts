import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { fakeDb, makeAuth, makeCronAuth, TEST_ORG } from "../testing.ts";
import { assertCapabilityAllowed, callCapability, CallDeps, CallScope, effectiveClass } from "./call.ts";
import { clearConnectorFactories, connectorFor, registerConnectorFactory } from "./registry.ts";
import { ActionClass, AutonomousCapability, CAPABILITIES, CapabilityName, Connector, PrivilegedCapability } from "./types.ts";

const NAMES = Object.keys(CAPABILITIES) as CapabilityName[];
const REQUESTER = "marie.durand@client-alpha.test";
const scope: CallScope = { conversationId: "conv-1", requesterRef: REQUESTER };

interface Spy { invoked: Array<{ name: string; params: unknown; ctx: unknown }> }
function spyConnector(over: Partial<{ capabilities: CapabilityName[]; fail: Error }> = {}): { connector: Connector; spy: Spy } {
  const spy: Spy = { invoked: [] };
  const caps = new Set<CapabilityName>(over.capabilities ?? NAMES);
  const connector = {
    id: "conn-1",
    type: "demo",
    environment: "test",
    capabilities: () => caps,
    invokeCapability: (name: string, params: unknown, ctx: unknown) => {
      spy.invoked.push({ name, params, ctx });
      return over.fail ? Promise.reject(over.fail) : Promise.resolve({ ok: true });
    },
    health: () => Promise.resolve({ ok: true, checkedAt: "2026-11-15T00:00:00Z" }),
  } as unknown as Connector;
  return { connector, spy };
}
function deps(connector: Connector, extra: Partial<CallDeps> = {}): CallDeps {
  return { connectorFor: () => Promise.resolve(connector), db: fakeDb().deps, ...extra };
}
const paramsFor = (n: CapabilityName) => (CAPABILITIES[n].targetPolicy === "self_only" ? { userRef: REQUESTER } : {});
async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try { await (typeof p === "function" ? p() : p); } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("matrice : TOUTE capacité du contrat est essayée ; seules les autonomes ET implémentées passent, les autres n'atteignent jamais le connecteur", async () => {
  const auth = await makeAuth();
  let allowed = 0;
  for (const name of NAMES) {
    const { connector, spy } = spyConnector();
    const meta = CAPABILITIES[name];
    const code = await codeOf(callCapability(auth, name as AutonomousCapability, paramsFor(name) as never, scope, deps(connector)));
    if (meta.class === "autonomous" && meta.demo) {
      allowed++;
      assert.equal(code, "aucune erreur", name);
      assert.equal(spy.invoked.length, 1, name);
    } else {
      assert.equal(code, "forbidden", name);
      assert.equal(spy.invoked.length, 0, `${name} ne doit JAMAIS atteindre le connecteur`);
    }
  }
  assert.equal(allowed, 10, "10 capacités autonomes dans la démo");
});

Deno.test("matrice : les types dérivés du contrat correspondent au tableau (aucun oubli)", () => {
  const auto: AutonomousCapability[] = ["ticket.create", "ticket.get", "ticket.search", "ticket.comment", "ticket.link_parent", "kb.search", "user.diagnose", "tenant.service_health", "alert.ingest", "alert.list_active"];
  const priv: PrivilegedCapability[] = ["ticket.update_status", "ticket.assign", "user.reset_password", "user.unlock", "user.revoke_sessions", "user.mfa_reregister", "alert.acknowledge"];
  for (const n of NAMES) {
    const m = CAPABILITIES[n];
    assert.equal(auto.includes(n as AutonomousCapability), m.class === "autonomous" && m.demo, `autonome ${n}`);
    assert.equal(priv.includes(n as PrivilegedCapability), m.class === "approval_required", `privilégiée ${n}`);
  }
  // Toute capacité d'écriture qui modifie un compte exige une vérification d'identité (docs/spec-mvp.md § 9.3).
  for (const n of NAMES) if (n.startsWith("user.") && CAPABILITIES[n].effect === "write" && CAPABILITIES[n].class !== "forbidden" && CAPABILITIES[n].family === "identity" && n !== "user.onboard" && n !== "user.offboard") {
    assert.ok(CAPABILITIES[n].requiresIdentityCheck, n);
  }
});

Deno.test("typage : l'agent ne peut pas appeler une capacité privilégiée (erreur de compilation attendue)", async () => {
  const auth = await makeAuth();
  const { connector } = spyConnector();
  // @ts-expect-error : user.reset_password n'est pas une capacité autonome
  await callCapability(auth, "user.reset_password", { userRef: REQUESTER }, scope, deps(connector)).catch(() => {});
  // @ts-expect-error : script.run est interdite
  await callCapability(auth, "script.run", {}, scope, deps(connector)).catch(() => {});
});

Deno.test("noms fabriqués : __proto__, constructor, toString, chaîne vide ou non textuelle sont refusés", async () => {
  const auth = await makeAuth();
  for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty", "", "ticket.create ", "TICKET.CREATE", "ticket.create\n", 42, null, undefined, { toString: () => "ticket.create" }]) {
    assert.equal(await codeOf(() => assertCapabilityAllowed(bad as string, auth, scope, {})), "forbidden", String(bad));
  }
});

Deno.test("durcissement : une organisation peut restreindre une capacité autonome ; jamais assouplir une privilégiée ou interdite", async () => {
  const auth = await makeAuth();
  assert.equal(effectiveClass("ticket.create", { "ticket.create": "approval_required" }), "approval_required");
  assert.equal(effectiveClass("ticket.create", { "ticket.create": "forbidden" }), "forbidden");
  for (const loosened of [["user.reset_password", "autonomous"], ["script.run", "autonomous"], ["script.run", "approval_required"], ["user.unlock", "autonomous"]] as Array<[CapabilityName, ActionClass]>) {
    assert.equal(effectiveClass(loosened[0], { [loosened[0]]: loosened[1] }), CAPABILITIES[loosened[0]].class, `${loosened[0]} assouplie`);
    assert.equal(await codeOf(() => assertCapabilityAllowed(loosened[0], auth, scope, paramsFor(loosened[0]), { [loosened[0]]: loosened[1] })), "forbidden", loosened.join(" → "));
  }
  const { connector, spy } = spyConnector();
  const d = deps(connector, { overrides: () => Promise.resolve({ "kb.search": "forbidden" as const }) });
  assert.equal(await codeOf(callCapability(auth, "kb.search", { query: "vpn" }, scope, d)), "forbidden");
  assert.equal(spy.invoked.length, 0);
});

Deno.test("cible : « self_only » n'accepte QUE l'utilisateur de la conversation (casse ignorée), jamais une autre personne", async () => {
  const auth = await makeAuth();
  assert.equal(await codeOf(() => assertCapabilityAllowed("user.diagnose", auth, scope, { userRef: REQUESTER.toUpperCase() })), "aucune erreur");
  for (const other of ["directeur@client-alpha.test", "", REQUESTER + ".evil.test", `${REQUESTER}, admin@client-alpha.test`]) {
    assert.equal(await codeOf(() => assertCapabilityAllowed("user.diagnose", auth, scope, { userRef: other })), "forbidden", other);
  }
  assert.equal(await codeOf(() => assertCapabilityAllowed("user.diagnose", auth, scope, {})), "forbidden", "cible absente");
  assert.equal(await codeOf(() => assertCapabilityAllowed("user.diagnose", auth, scope, { userRef: 42 })), "forbidden");
  assert.equal(await codeOf(() => assertCapabilityAllowed("user.diagnose", auth, { ...scope, requesterRef: null }, { userRef: REQUESTER })), "forbidden", "aucune identité connue de l'interlocuteur");
});

Deno.test("contexte : organisation gelée = plus rien ; accès d'assistance = lecture seulement ; tâche planifiée refusée", async () => {
  const frozen = await makeAuth({ is_frozen: true });
  assert.equal(await codeOf(() => assertCapabilityAllowed("kb.search", frozen, scope, { query: "x" })), "org_frozen");
  const support = await makeAuth({ org_role: "super_admin", via: "support_access", read_only: true });
  assert.equal(await codeOf(() => assertCapabilityAllowed("ticket.create", support, scope, {})), "read_only", "écriture refusée");
  assert.equal(await codeOf(() => assertCapabilityAllowed("kb.search", support, scope, { query: "x" })), "aucune erreur", "lecture admise");
  const cron = await makeCronAuth();
  assert.equal(await codeOf(() => assertCapabilityAllowed("kb.search", cron, scope, {})), "forbidden", "une tâche planifiée n'est pas un utilisateur");
});

Deno.test("paramètres : tableau, texte, null, objet à prototype étranger ou énorme refusés", async () => {
  const auth = await makeAuth();
  class Etranger { x = 1; }
  for (const bad of [[], "texte", null, undefined, 7, new Etranger(), { x: "y".repeat(9000) }]) {
    assert.equal(await codeOf(() => assertCapabilityAllowed("kb.search", auth, scope, bad)), "bad_request", JSON.stringify(bad)?.slice(0, 30));
  }
  assert.equal(await codeOf(() => assertCapabilityAllowed("kb.search", auth, scope, Object.create(null))), "aucune erreur");
});

Deno.test("appel : contexte d'invocation correct (organisation, requête, acteur agent) et audit sans paramètres", async () => {
  const auth = await makeAuth();
  const { connector, spy } = spyConnector();
  const db = fakeDb();
  await callCapability(auth, "kb.search", { query: "mot de passe est Azerty123" }, scope, deps(connector, { db: db.deps }));
  assert.deepEqual(spy.invoked[0].ctx, { orgId: TEST_ORG, connectorId: "conn-1", requestId: auth.requestId, actor: { kind: "agent", conversationId: "conv-1" } });
  const audit = db.inserts.find((i) => i.table === "audit_logs")!.row;
  assert.equal(audit.event, "capability.call");
  assert.deepEqual(audit.details, { capability: "kb.search", connector: "conn-1", outcome: "ok" });
  assert.ok(!JSON.stringify(audit).includes("Azerty123"), "les paramètres ne sont jamais dans l'audit");
});

Deno.test("appel : un connecteur qui ne sait pas faire la capacité, ou qui échoue, ne laisse filtrer aucun détail", async () => {
  const auth = await makeAuth();
  const none = spyConnector({ capabilities: [] });
  assert.equal(await codeOf(callCapability(auth, "kb.search", { query: "x" }, scope, deps(none.connector))), "service_unavailable");
  assert.equal(none.spy.invoked.length, 0);

  const failing = spyConnector({ fail: new Error("401 sur https://glpi.interne.exemple.test avec le jeton secret-abc123") });
  const db = fakeDb();
  try { await callCapability(auth, "kb.search", { query: "x" }, scope, deps(failing.connector, { db: db.deps })); assert.fail(); } catch (e) {
    assert.ok(e instanceof AppError && e.code === "service_unavailable");
    assert.ok(!e.message.includes("glpi") && !e.message.includes("abc123"));
  }
  const audit = db.inserts.find((i) => i.table === "audit_logs")!.row;
  assert.equal(audit.event, "capability.failure");
  assert.ok(!JSON.stringify(audit).includes("abc123") && !JSON.stringify(audit).includes("glpi"));
});

Deno.test("registre : choisit le connecteur actif de L'ORGANISATION qui sait faire la capacité ; sans fabrique, rien", async () => {
  clearConnectorFactories();
  const auth = await makeAuth();
  const rows = [
    { id: "c-autre-org", org_id: "00000000-0000-4000-8000-0000000000ff", type: "demo", name: "x", environment: "test", status: "ok", config: {}, tenant_id: null, vault_secret_id: null },
    { id: "c-glpi", org_id: TEST_ORG, type: "glpi", name: "GLPI", environment: "production", status: "ok", config: {}, tenant_id: null, vault_secret_id: null },
    { id: "c-demo", org_id: TEST_ORG, type: "demo", name: "Démo", environment: "test", status: "ok", config: {}, tenant_id: null, vault_secret_id: null },
  ];
  const queries: Array<[string, unknown]> = [];
  const db = fakeDb().deps;
  db.createClient = (() => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, val: unknown) => { queries.push([col, val]); return q; };
      q.order = () => Promise.resolve({ data: rows, error: null });
      return q;
    },
  })) as never;
  assert.equal(await codeOf(connectorFor(auth, "kb.search", db)), "service_unavailable", "aucune fabrique enregistrée");
  const mk = (row: { id: string }, caps: CapabilityName[]) => spyConnector({ capabilities: caps }).connector && ({ ...spyConnector({ capabilities: caps }).connector, id: row.id } as Connector);
  registerConnectorFactory("demo", (row) => mk(row, NAMES));
  registerConnectorFactory("glpi", (row) => mk(row, ["ticket.create", "ticket.get"]));
  assert.equal((await connectorFor(auth, "ticket.create", db)).id, "c-glpi", "premier connecteur de l'organisation qui sait faire");
  assert.equal((await connectorFor(auth, "kb.search", db)).id, "c-demo");
  assert.deepEqual(queries.slice(0, 2), [["org_id", TEST_ORG], ["status", "ok"]], "filtré par organisation ET par état");
  const onlyOther = { ...db };
  onlyOther.createClient = (() => ({ from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.eq = () => q; q.order = () => Promise.resolve({ data: [rows[0]], error: null }); return q; } })) as never;
  assert.equal(await codeOf(connectorFor(auth, "kb.search", onlyOther)), "service_unavailable", "un connecteur d'une autre organisation n'est jamais pris, même renvoyé par erreur");
  clearConnectorFactories();
});
