// Limitation de débit (SEC-24, M10) : clés composées par le code, règles figées, échec fermé, et branchement dans les trois portes HTTP.
import assert from "node:assert/strict";
import { requireOrgMember, requireUser } from "./auth.ts";
import { AppError } from "./errors.ts";
import { BUCKETS, enforceRateLimit, limiterFor } from "./ratelimit.ts";
import { fakeSupabase, makeAuth, makeCronAuth, Op, Reply, TEST_JWT, TEST_ORG, TEST_USER, testAuthDeps, testRequest } from "./testing.ts";
import { makeRig } from "./chat/test_rig.ts";
import { createChatHandler } from "./chat/handler.ts";
import { createActionsHandler } from "./actions/handler.ts";
import { makeActionRig } from "./actions/test_rig.ts";
import { rig as adminRig, VALID_BODY } from "./admin/test_rig.ts";

async function codeOf(p: Promise<unknown>): Promise<AppError | null> {
  try { await p; } catch (e) { return e as AppError; }
  return null;
}
function limiterDb(respond: (key: string) => Reply) {
  const f = fakeSupabase((op: Op) => respond(((op.args ?? {}) as { p_key: string }).p_key));
  return { db: f.deps, ops: f.ops };
}

Deno.test("règles figées (valeurs en dur) : 12 messages par minute et par salarié, 30 opérations par technicien ou administrateur, 120 par organisation", () => {
  assert.deepEqual(BUCKETS.chat, [{ scope: "user", windowSeconds: 60, limit: 12 }, { scope: "org", windowSeconds: 60, limit: 120 }]);
  assert.deepEqual(BUCKETS.actions, [{ scope: "user", windowSeconds: 60, limit: 30 }, { scope: "org", windowSeconds: 60, limit: 120 }]);
  assert.deepEqual(BUCKETS.admin, [{ scope: "user", windowSeconds: 60, limit: 30 }, { scope: "org", windowSeconds: 60, limit: 120 }]);
  assert.deepEqual(BUCKETS.widget, [{ scope: "user", windowSeconds: 60, limit: 60 }, { scope: "org", windowSeconds: 60, limit: 1200 }]);
});

Deno.test("clés : composées à partir du contexte vérifié (personne, organisation, fonction), jamais d'une donnée de la requête", async () => {
  const auth = await makeAuth({ org_role: "end_user" });
  const { db, ops } = limiterDb(() => ({ data: true, error: null }));
  await enforceRateLimit(auth, "chat", { db });
  assert.deepEqual(ops.map((o) => o.fn), ["rate_limit_hit", "rate_limit_hit"]);
  assert.deepEqual(ops.map((o) => o.args), [
    { p_key: `chat:u:${TEST_USER}`, p_window_seconds: 60, p_limit: 12 },
    { p_key: `chat:o:${TEST_ORG}`, p_window_seconds: 60, p_limit: 120 },
  ]);
  const other = limiterDb(() => ({ data: true, error: null }));
  await enforceRateLimit(auth, "admin", { db: other.db });
  assert.equal((other.ops[0].args as { p_key: string }).p_key, `admin:u:${TEST_USER}`, "chaque fonction a son compteur");
});

Deno.test("dépassement : 429 avec le délai avant la prochaine fenêtre ; la règle « personne » s'arrête avant la règle « organisation »", async () => {
  const auth = await makeAuth();
  for (const [now, expected] of [[1_800_000_000, 60], [1_800_000_015, 45], [1_800_000_059, 1]] as const) {
    const { db, ops } = limiterDb((key) => ({ data: !key.includes(":u:"), error: null }));
    const e = await codeOf(enforceRateLimit(auth, "chat", { db, nowSeconds: () => now }));
    assert.equal(e?.code, "rate_limited");
    assert.equal(e?.status, 429);
    assert.equal(e?.retryAfterSeconds, expected - (now % 60 === 0 ? 0 : 0), `now=${now}`);
    assert.equal(ops.length, 1, "la règle de l'organisation n'est pas consommée pour rien");
  }
  const orgFull = limiterDb((key) => ({ data: !key.includes(":o:"), error: null }));
  assert.equal((await codeOf(enforceRateLimit(auth, "actions", { db: orgFull.db })))?.code, "rate_limited", "l'organisation entière peut être limitée");
});

Deno.test("personne sans organisation (acceptation d'une invitation) : seule la règle « personne » s'applique, par la porte étroite", async () => {
  const bare = await requireUser(testRequest(), testAuthDeps());
  const { db, ops } = limiterDb(() => ({ data: true, error: null }));
  await enforceRateLimit(bare, "admin", { db });
  assert.deepEqual(ops.map((o) => (o.args as { p_key: string }).p_key), [`admin:u:${TEST_USER}`]);
});

Deno.test("échec FERMÉ : base en panne, erreur SQL, réponse inattendue ou exception = 503, jamais un passage", async () => {
  const auth = await makeAuth();
  for (const reply of [{ data: null, error: { message: "boom" } }, { data: null, error: null }, { data: "true", error: null }, { data: 1, error: null }, { data: undefined, error: null }] as Reply[]) {
    const { db } = limiterDb(() => reply);
    const e = await codeOf(enforceRateLimit(auth, "chat", { db }));
    assert.equal(e?.code, "service_unavailable", JSON.stringify(reply));
  }
  const throwing = fakeSupabase(() => { throw new Error("réseau coupé"); });
  assert.equal((await codeOf(enforceRateLimit(auth, "chat", { db: throwing.deps })))?.code, "service_unavailable");
});

Deno.test("un contexte fabriqué, une tâche planifiée ou un contexte vide ne passent pas par le limiteur d'une personne", async () => {
  const { db, ops } = limiterDb(() => ({ data: true, error: null }));
  for (const forged of [{ userId: TEST_USER, orgId: TEST_ORG, kind: "user" }, null, "texte", await makeCronAuth()]) {
    assert.equal((await codeOf(enforceRateLimit(forged as never, "chat", { db })))?.code, "forbidden");
  }
  assert.equal(ops.length, 0);
});

// ---------------------------------------------------------------- branchement dans les trois portes HTTP
const bearer = { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json" };
const full = limiterDb(() => ({ data: false, error: null }));
const blocked = limiterFor("chat", { db: full.db, nowSeconds: () => 1_800_000_010 });
const post = (h: (r: Request) => Promise<Response>, body: Record<string, unknown>, headers: Record<string, string> = bearer) =>
  h(new Request("https://exemple.test/x", { method: "POST", headers, body: JSON.stringify(body) }));

Deno.test("SEC-24 chat : au-delà de la limite, 429 avec Retry-After, AVANT tout travail (ni message enregistré ni appel au modèle)", async () => {
  const rig = makeRig({ gate: "direct" });
  const h = createChatHandler({ ports: () => rig.ports, authDeps: testAuthDeps(), limits: { chat: blocked, widget: blocked } });
  const res = await post(h, { orgId: TEST_ORG, message: "Bonjour" });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "50");
  assert.equal((await res.json()).error.code, "rate_limited");
  assert.equal(rig.messages.length + rig.calls.complete.length, 0, "aucun travail n'a été fait");
});

Deno.test("SEC-24 actions : au-delà de la limite, 429 AVANT toute lecture ou exécution", async () => {
  const r = makeActionRig();
  const h = createActionsHandler({ deps: () => r.deps, authDeps: testAuthDeps({ org_role: "partner_technician", via: "partner" }), limit: limiterFor("actions", { db: full.db }) });
  const res = await post(h, { orgId: TEST_ORG, op: "reject", actionId: "dddddddd-0000-4000-8000-000000000001", reason: "autre" });
  assert.equal(res.status, 429);
  assert.equal(r.calls.approve.length + r.calls.invoked.length, 0);
});

Deno.test("SEC-24 admin : au-delà de la limite, 429 AVANT toute écriture et même pour l'arrêt d'urgence ; les identifiants invalides ne consomment rien", async () => {
  const r = adminRig({}, [], limiterFor("admin", { db: full.db }));
  const res = await r.call("org.freeze", VALID_BODY["org.freeze"]);
  assert.equal(res.status, 429);
  assert.equal(r.calls.length, 0);
  assert.equal(r.db.inserts.length, 0, "pas d'audit pour une requête refusée");
});

Deno.test("SEC-24 : sans jeton valide ou sans droit dans l'organisation, le limiteur n'est PAS sollicité (pas de compteur pour un inconnu)", async () => {
  let asked = 0;
  const counting = () => { asked++; return Promise.resolve(); };
  const chat = createChatHandler({ ports: () => makeRig().ports, authDeps: testAuthDeps(null), limits: { chat: counting, widget: counting } });
  assert.equal((await post(chat, { orgId: TEST_ORG, message: "x" })).status, 403);
  assert.equal((await post(chat, { orgId: TEST_ORG, message: "x" }, { "content-type": "application/json" })).status, 401);
  const admin = adminRig({}, [], counting);
  await admin.call("org.freeze", {}, { access: null });
  assert.equal(asked, 0);
  const ok = createChatHandler({ ports: () => makeRig({ gate: "direct" }).ports, authDeps: testAuthDeps(), limits: { chat: counting, widget: counting } });
  assert.equal((await post(ok, { orgId: TEST_ORG, message: "Bonjour" })).status, 200);
  assert.equal(asked, 1, "sollicité une fois, après l'authentification");
});

Deno.test("limiteur et organisation : le même salarié dans une autre organisation a un autre compteur d'organisation, mais le même compteur personnel", async () => {
  const a = await requireOrgMember(testRequest(), TEST_ORG, undefined, testAuthDeps());
  const b = await requireOrgMember(testRequest(), "923e4567-e89b-12d3-a456-426614174000", undefined, testAuthDeps());
  const { db, ops } = limiterDb(() => ({ data: true, error: null }));
  await enforceRateLimit(a, "chat", { db });
  await enforceRateLimit(b, "chat", { db });
  const keys = ops.map((o) => (o.args as { p_key: string }).p_key);
  assert.equal(keys[0], keys[2], "même personne : même compteur personnel");
  assert.notEqual(keys[1], keys[3], "organisations différentes : compteurs différents");
});
