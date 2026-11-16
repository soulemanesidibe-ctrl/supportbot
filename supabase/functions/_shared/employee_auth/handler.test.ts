import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { originsFromEnv, parseAllowedOrigins, withCors } from "../cors.ts";
import { employeeLinkRpc, sendEmployeeCode, signInRateRpc, widgetSignInRpc } from "../db.ts";
import { AppError } from "../errors.ts";
import { fakeSupabase, makeAuth, noLimit, TEST_JWT, TEST_ORG, TEST_USER, testAuthDeps } from "../testing.ts";
import { CODE_LIMITS, codeWork, createEmployeeAuthHandler, EmployeeAuthDeps } from "./handler.ts";

const SLUG = "client-alpha";
const EMAIL = "camille.durand@client-alpha.test";
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

interface Seen { hits: Array<[string, number]>; allowed: Array<[string, string]>; sent: string[]; linked: Array<[string, string]>; deferred: number }
function rig(over: Partial<EmployeeAuthDeps> & { allowed?: boolean; underLimit?: boolean | ((key: string) => boolean) } = {}) {
  const seen: Seen = { hits: [], allowed: [], sent: [], linked: [], deferred: 0 };
  const pending: Promise<unknown>[] = [];
  const deps: EmployeeAuthDeps = {
    publicOrg: (_r, slug) => Promise.resolve(slug === SLUG ? { name: "Cabinet Alpha", accent: "#1f6feb" } : null),
    codeAllowed: (_r, slug, email) => { seen.allowed.push([slug, email]); return Promise.resolve(over.allowed ?? true); },
    hit: (_r, key, rule) => {
      seen.hits.push([key, rule.limit]);
      const u = over.underLimit;
      return Promise.resolve(typeof u === "function" ? u(key) : u ?? true);
    },
    sendCode: (_r, email) => { seen.sent.push(email); return Promise.resolve(); },
    link: (auth, slug) => { seen.linked.push([auth.userId as string, slug]); return Promise.resolve(TEST_ORG); },
    defer: (w) => { seen.deferred++; pending.push(w); },
    ...over,
  };
  const h = createEmployeeAuthHandler({ deps: () => deps, authDeps: testAuthDeps(null), limit: noLimit });
  const call = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const res = await h(new Request("https://exemple.test/employee-auth", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    return { status: res.status, text: await res.text(), headers: res.headers };
  };
  return { seen, call, settle: () => Promise.all(pending) };
}

// ---------------------------------------------------------------------------------------------------------------
// org
// ---------------------------------------------------------------------------------------------------------------
Deno.test("employee-auth org : nom et couleur d'un client activé ; inconnu, mal formé ou absent = la même 404", async () => {
  const r = rig();
  const ok = await r.call({ op: "org", slug: " Client-Alpha " });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.text), { name: "Cabinet Alpha", brand: { name: "Cabinet Alpha", accent: "#1f6feb" } });
  const unknown = await r.call({ op: "org", slug: "inconnu" });
  const malformed = await r.call({ op: "org", slug: "../../etc" });
  assert.equal(unknown.status, 404);
  assert.equal(malformed.status, 404);
  assert.equal(JSON.parse(unknown.text).error.message, JSON.parse(malformed.text).error.message);
  assert.equal((await r.call({ op: "org" })).status, 400);
});

// ---------------------------------------------------------------------------------------------------------------
// request_code
// ---------------------------------------------------------------------------------------------------------------
Deno.test("employee-auth code : réponse IDENTIQUE et immédiate, adresse connue, inconnue, limitée ou panne (aucune énumération)", async () => {
  const outcomes: string[] = [];
  for (const over of [{}, { allowed: false }, { underLimit: false }, { codeAllowed: () => Promise.reject(new Error("base muette")) }]) {
    const r = rig(over);
    const res = await r.call({ op: "request_code", slug: SLUG, email: EMAIL });
    // La réponse est partie AVANT tout travail : rien n'a encore été vérifié ni envoyé.
    assert.equal(r.seen.deferred, 1);
    assert.equal(r.seen.allowed.length + r.seen.sent.length, 0, "la réponse n'attend pas la vérification");
    const original = console.warn;
    console.warn = () => {};
    try { await r.settle(); } finally { console.warn = original; }
    const headers = [...res.headers.entries()].filter(([k]) => k !== "x-request-id").map(([k, v]) => `${k}=${v}`).sort().join(",");
    outcomes.push(`${res.status}|${headers}|${res.text}`);
  }
  assert.equal(new Set(outcomes).size, 1, outcomes.join("\n"));
  assert.ok(outcomes[0].startsWith("200|"));
});

Deno.test("employee-auth code : envoyé seulement si l'annuaire l'autorise, après les deux compteurs ; adresse normalisée", async () => {
  const r = rig();
  await r.call({ op: "request_code", slug: "CLIENT-ALPHA", email: `  ${EMAIL.toUpperCase()} ` });
  await r.settle();
  assert.deepEqual(r.seen.allowed, [[SLUG, EMAIL]]);
  assert.deepEqual(r.seen.sent, [EMAIL]);
  assert.equal(r.seen.hits[0][0], `otp:o:${SLUG}`);
  assert.match(r.seen.hits[1][0], /^otp:e:[0-9a-f]{48}$/, "l'adresse n'apparaît jamais en clair dans une clé");
  assert.deepEqual(r.seen.hits.map((h) => h[1]), [CODE_LIMITS.org.limit, CODE_LIMITS.email.limit]);

  const refused = rig({ allowed: false });
  await refused.call({ op: "request_code", slug: SLUG, email: EMAIL });
  await refused.settle();
  assert.deepEqual(refused.seen.sent, [], "adresse absente de l'annuaire : aucun code");
});

Deno.test("employee-auth code : au-delà d'une limite, ni vérification ni envoi ; adresse ou organisation mal formées : rien", async () => {
  for (const blocked of ["otp:o:", "otp:e:"]) {
    const r = rig({ underLimit: (k) => !k.startsWith(blocked) });
    await r.call({ op: "request_code", slug: SLUG, email: EMAIL });
    await r.settle();
    assert.equal(r.seen.allowed.length + r.seen.sent.length, 0, blocked);
  }
  const deps = rig().seen;
  assert.equal(await codeWork({ ...rigDeps(deps) }, "r", "x", EMAIL), "refused");
  assert.equal(await codeWork({ ...rigDeps(deps) }, "r", SLUG, "pas-une-adresse"), "refused");
  const r = rig();
  assert.equal((await r.call({ op: "request_code", slug: SLUG, email: 42 })).status, 400);
  assert.equal((await r.call({ op: "request_code", slug: SLUG, email: "a".repeat(400) })).status, 400);
});
function rigDeps(seen: Seen): EmployeeAuthDeps {
  return {
    publicOrg: () => Promise.resolve(null),
    codeAllowed: () => { seen.allowed.push(["?", "?"]); return Promise.resolve(true); },
    hit: () => Promise.resolve(true),
    sendCode: (_r, e) => { seen.sent.push(e); return Promise.resolve(); },
    link: () => Promise.resolve(null),
    defer: () => {},
  };
}

// ---------------------------------------------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------------------------------------------
Deno.test("employee-auth link : exige un jeton ; rattache la personne DU JETON ; refus identique sinon", async () => {
  const deps: EmployeeAuthDeps = { ...rigDeps({ hits: [], allowed: [], sent: [], linked: [], deferred: 0 }), link: (auth, slug) => Promise.resolve(slug === SLUG && auth.userId === TEST_USER ? TEST_ORG : null) };
  const h = createEmployeeAuthHandler({ deps: () => deps, authDeps: testAuthDeps(null), limit: noLimit });
  const post = (body: Record<string, unknown>, auth = true) =>
    h(new Request("https://exemple.test/employee-auth", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${TEST_JWT}` } : {}) },
      body: JSON.stringify(body),
    }));
  assert.equal((await post({ op: "link", slug: SLUG }, false)).status, 401);
  const ok = await post({ op: "link", slug: SLUG, userId: "quelqu-un-d-autre" });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { orgId: TEST_ORG });
  const refused = await post({ op: "link", slug: "client-beta" });
  const bad = await post({ op: "link", slug: "../x" });
  assert.equal(refused.status, 403);
  assert.equal(bad.status, 403);
  assert.equal((await refused.json()).error.message, (await bad.json()).error.message);
});

Deno.test("employee-auth : méthode autre que POST = 405, opération inconnue = 400", async () => {
  const r = rig();
  const h = createEmployeeAuthHandler({ deps: () => rigDeps(r.seen), authDeps: testAuthDeps(null), limit: noLimit });
  assert.equal((await h(new Request("https://exemple.test/x", { method: "GET" }))).status, 405);
  assert.equal((await r.call({ op: "delete_user" })).status, 400);
  assert.equal((await r.call({ op: "__proto__" })).status, 400);
});

// ---------------------------------------------------------------------------------------------------------------
// Portes étroites de db.ts
// ---------------------------------------------------------------------------------------------------------------
Deno.test("portes étroites : avant connexion, seulement les deux fonctions prévues ; compteurs « otp: » seulement", async () => {
  const { deps, ops } = fakeSupabase(() => ({ data: null }));
  await widgetSignInRpc("r", { fn: "widget_public_org", slug: SLUG }, deps);
  await widgetSignInRpc("r", { fn: "widget_code_allowed", slug: SLUG, email: EMAIL }, deps);
  assert.equal(await code(widgetSignInRpc("r", { fn: "admin_create_client" } as never, deps)), "forbidden");
  await signInRateRpc("r", { key: "otp:e:abc123", windowSeconds: 900, limit: 5 }, deps);
  for (const key of ["chat:u:x", "otp:e:", "otp:E:abc", "otp:e:abc def", "otp:e:" + "a".repeat(80)]) {
    assert.equal(await code(signInRateRpc("r", { key, windowSeconds: 60, limit: 1 }, deps)), "forbidden", key);
  }
  assert.deepEqual(ops.map((o) => [o.fn, o.args]), [
    ["widget_public_org", { p_slug: SLUG }],
    ["widget_code_allowed", { p_slug: SLUG, p_email: EMAIL }],
    ["rate_limit_hit", { p_key: "otp:e:abc123", p_window_seconds: 900, p_limit: 5 }],
  ]);
});

Deno.test("porte étroite link : seulement la personne du jeton, sans organisation ; jamais un contexte d'organisation", async () => {
  const { deps, ops } = fakeSupabase(() => ({ data: TEST_ORG }));
  const { requireUser } = await import("../auth.ts");
  const { testRequest } = await import("../testing.ts");
  const bare = await requireUser(testRequest(), testAuthDeps());
  await employeeLinkRpc(bare, SLUG, deps);
  assert.deepEqual(ops[0].args, { p_slug: SLUG, p_user: TEST_USER });
  assert.equal(await code(employeeLinkRpc(await makeAuth({ org_role: "end_user", via: "member" }), SLUG, deps)), "forbidden");
  assert.equal(await code(employeeLinkRpc({ kind: "user", userId: TEST_USER, orgId: null } as never, SLUG, deps)), "forbidden", "contexte non fabriqué par auth.ts");
});

Deno.test("porte étroite d'envoi du code : compte créé si besoin (déjà existant = normal), puis code SANS création de compte", async () => {
  const calls: Array<[string, unknown]> = [];
  const fakeClient = (createErr: string | null, otpErr: string | null) => ({
    createClient: (() => ({
      auth: {
        admin: { createUser: (a: unknown) => { calls.push(["createUser", a]); return Promise.resolve({ error: createErr ? { message: createErr } : null }); } },
        signInWithOtp: (a: unknown) => { calls.push(["otp", a]); return Promise.resolve({ error: otpErr ? { message: otpErr } : null }); },
      },
    })) as unknown as typeof createClient,
    url: () => "https://projet.exemple.test",
    serviceKey: () => "cle-de-service-factice",
  });
  await sendEmployeeCode("r", EMAIL, fakeClient(null, null));
  await sendEmployeeCode("r", EMAIL, fakeClient("A user with this email address has already been registered", null));
  assert.deepEqual(calls, [
    ["createUser", { email: EMAIL, email_confirm: true }],
    ["otp", { email: EMAIL, options: { shouldCreateUser: false } }],
    ["createUser", { email: EMAIL, email_confirm: true }],
    ["otp", { email: EMAIL, options: { shouldCreateUser: false } }],
  ]);
  assert.equal(await code(sendEmployeeCode("r", EMAIL, fakeClient("database down", null))), "service_unavailable");
  assert.equal(await code(sendEmployeeCode("r", EMAIL, fakeClient(null, "rate limit"))), "service_unavailable");
});

// ---------------------------------------------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------------------------------------------
Deno.test("CORS : liste blanche exacte ; joker, chemin, http public et entrées vides ignorés ; rien sans liste", () => {
  const s = parseAllowedOrigins(" https://app.releve.example , http://localhost:5173,*,https://*.evil.test,http://releve.example,https://app.releve.example/path,,null");
  assert.deepEqual([...s].sort(), ["http://localhost:5173", "https://app.releve.example"]);
  assert.equal(parseAllowedOrigins(undefined).size, 0);
  assert.equal(originsFromEnv().size, 0, "aucune variable dans les tests : aucune origine");
});

Deno.test("CORS : pré-vol et réponse seulement pour une origine autorisée ; jamais « * » ni cookie ; l'appel refusé reste refusé", async () => {
  const allowed = parseAllowedOrigins("https://app.releve.example");
  let handled = 0;
  const h = withCors(() => { handled++; return Promise.resolve(new Response("{}", { status: 200, headers: { "x-request-id": "r" } })); }, allowed);
  const pre = await h(new Request("https://f.test/chat", { method: "OPTIONS", headers: { origin: "https://app.releve.example" } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://app.releve.example");
  assert.equal(pre.headers.get("access-control-allow-methods"), "POST");
  assert.equal(pre.headers.get("access-control-allow-credentials"), null);
  assert.equal(handled, 0, "le pré-vol n'atteint jamais le métier");
  const evil = await h(new Request("https://f.test/chat", { method: "OPTIONS", headers: { origin: "https://evil.test" } }));
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  const ok = await h(new Request("https://f.test/chat", { method: "POST", headers: { origin: "https://app.releve.example" } }));
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.releve.example");
  assert.match(ok.headers.get("vary") ?? "", /Origin/);
  assert.equal(ok.headers.get("x-request-id"), "r");
  const other = await h(new Request("https://f.test/chat", { method: "POST", headers: { origin: "https://evil.test" } }));
  assert.equal(other.headers.get("access-control-allow-origin"), null);
  const sameCase = await h(new Request("https://f.test/chat", { method: "OPTIONS", headers: { origin: "https://APP.releve.example" } }));
  assert.equal(sameCase.status, 403, "comparaison exacte");
});
