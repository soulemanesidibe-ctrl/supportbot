// Connecteur Microsoft 365 contre un FAUX Graph qui reproduit les réponses documentées par Microsoft (Learn). Aucun réseau.
// Les faux jetons sont assemblés à l'exécution (un détecteur de secrets ne doit pas les prendre pour de vrais, et ne se contourne jamais).
import assert from "node:assert/strict";
import type { ConnectorRow } from "../capabilities/registry.ts";
import type { InvocationContext, OneTimeSecret } from "../capabilities/types.ts";
import { ConnectorError } from "../actions/types.ts";
import { ConnectorHttpError } from "./http.ts";
import { healthStatus, M365Connector } from "./m365.ts";

const TENANT = "11111111-2222-4333-8444-555555555555";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const APP_TOKEN = ["jeton", "application", "lecture", "seule", "000111"].join(".");
const DELEGATED = ["jeton", "delegue", "technicien", "valideur", "222333"].join(".");
const CLIENT_SECRET = ["secret", "client", "application", "relève", "444555"].join("-");
const NOW = Date.parse("2026-11-16T12:00:00Z");
const ROW: ConnectorRow = { id: "m365-1", org_id: "o", type: "m365", name: "M365", environment: "test", status: "ok", config: {}, tenant_id: TENANT, vault_secret_id: null };
const AGENT: InvocationContext = { orgId: "o", connectorId: "m365-1", requestId: "r", actor: { kind: "agent", conversationId: "c" } };
function human(over: Partial<InvocationContext> = {}): { ctx: InvocationContext; secrets: OneTimeSecret[] } {
  const secrets: OneTimeSecret[] = [];
  return { ctx: { orgId: "o", connectorId: "m365-1", requestId: "r", actor: { kind: "human", userId: "u", delegatedToken: DELEGATED }, deliverSecret: (s) => secrets.push(s), ...over }, secrets };
}

interface Seen { method: string; url: string; path: string; query: string; headers: Record<string, string>; body: unknown }
interface Script {
  methods?: unknown[]; signIns?: unknown[]; roles?: unknown[]; user?: Record<string, unknown>; health?: unknown[];
  handler?: (s: Seen) => Response | undefined; polls?: string[]; location?: string | null; newPassword?: unknown;
}
const j = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
function fakeGraph(sc: Script = {}) {
  const seen: Seen[] = [];
  const polls = [...(sc.polls ?? ["succeeded"])];
  const fetchFn = ((url: string, init: RequestInit) => {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === "string" && headers["content-type"]?.includes("json") ? JSON.parse(init.body) : init.body;
    const s: Seen = { method: String(init.method), url, path: decodeURIComponent(u.pathname), query: decodeURIComponent(u.search), headers, body };
    seen.push(s);
    const custom = sc.handler?.(s);
    if (custom) return Promise.resolve(custom);
    if (u.hostname === "login.microsoftonline.com") return Promise.resolve(j({ access_token: APP_TOKEN, expires_in: 3599, token_type: "Bearer" }));
    const p = s.path;
    if (s.method === "GET" && /^\/v1\.0\/users\/[^/]+$/.test(p)) return Promise.resolve(j({ id: USER_ID, accountEnabled: true, lastPasswordChangeDateTime: "2026-09-01T08:00:00Z", ...sc.user }));
    if (s.method === "GET" && p === "/v1.0/users") return Promise.resolve(j({ value: [{ id: USER_ID }] }));
    if (s.method === "GET" && p.endsWith("/authentication/methods")) return Promise.resolve(j({ value: sc.methods ?? [{ "@odata.type": "#microsoft.graph.passwordAuthenticationMethod", id: PASSWORD }, { "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod", id: "auth1", createdDateTime: "2026-05-01T10:00:00Z" }] }));
    if (s.method === "GET" && p === "/v1.0/auditLogs/signIns") return Promise.resolve(j({ value: sc.signIns ?? [] }));
    if (s.method === "GET" && p === "/v1.0/roleManagement/directory/roleAssignments") return Promise.resolve(j({ value: sc.roles ?? [] }));
    if (s.method === "GET" && p === "/v1.0/admin/serviceAnnouncement/healthOverviews") return Promise.resolve(j({ value: sc.health ?? [{ service: "Exchange Online", status: "ServiceOperational", id: "Exchange" }] }));
    if (s.method === "POST" && p.endsWith(`/authentication/methods/${PASSWORD}/resetPassword`)) {
      const location = sc.location === undefined ? `https://graph.microsoft.com/v1.0/users/${USER_ID}/authentication/operations/op1` : sc.location;
      return Promise.resolve(j({ "@odata.context": "x", newPassword: sc.newPassword === undefined ? ["Mdp", "Genere", "Par", "Microsoft"].join("-") : sc.newPassword }, 202, location ? { location } : {}));
    }
    if (s.method === "GET" && p.includes("/authentication/operations/")) return Promise.resolve(j({ status: polls.length > 1 ? polls.shift() : polls[0] }));
    if (s.method === "PATCH") return Promise.resolve(new Response(null, { status: 204 }));
    if (s.method === "POST" && p.endsWith("/revokeSignInSessions")) return Promise.resolve(j({ value: true }));
    if (s.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(j({ error: { code: "Request_ResourceNotFound" } }, 404));
  }) as unknown as typeof fetch;
  const connector = new M365Connector(ROW, {
    appCredentials: () => ({ clientId: "client-id-de-test", clientSecret: CLIENT_SECRET }),
    http: { fetch: fetchFn }, nowMs: () => NOW, sleep: () => Promise.resolve(),
  });
  return { connector, seen };
}
const PASSWORD = "28c10230-6103-485e-b985-444c60001490";
const calls = (seen: Seen[]) => seen.map((s) => `${s.method} ${s.path.replace(USER_ID, "{id}")}`);
async function failure(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof ConnectorError ? `${e.name}:${e.outcome}:${e.message}` : e instanceof ConnectorHttpError ? `http:${e.kind}` : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("M365 : six capacités exactement ; un tenant qui n'est pas un identifiant (GUID) est refusé à la construction", () => {
  assert.deepEqual([...fakeGraph().connector.capabilities()].sort(), ["tenant.service_health", "user.diagnose", "user.mfa_reregister", "user.reset_password", "user.revoke_sessions", "user.unlock"]);
  for (const tenant_id of [null, "", "contoso.onmicrosoft.com", "../x", `${TENANT}/../y`, `${TENANT}?a=1`]) {
    assert.throws(() => new M365Connector({ ...ROW, tenant_id }, { appCredentials: () => null }), ConnectorHttpError, String(tenant_id));
  }
});

Deno.test("M365 lecture : jeton d'APPLICATION par le flux « client credentials » (formulaire encodé, périmètre .default), utilisé en lecture seulement", async () => {
  const { connector, seen } = fakeGraph();
  await connector.invokeCapability("user.diagnose", { userRef: "marie@client.exemple.fr" }, AGENT);
  const token = seen[0];
  assert.equal(token.url, `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
  assert.equal(token.method, "POST");
  const form = new URLSearchParams(String(token.body));
  assert.deepEqual([form.get("grant_type"), form.get("scope"), form.get("client_id"), form.get("client_secret")], ["client_credentials", "https://graph.microsoft.com/.default", "client-id-de-test", CLIENT_SECRET]);
  assert.ok(seen.slice(1).every((s) => s.method === "GET" && s.headers.authorization === `Bearer ${APP_TOKEN}`), "toutes les lectures en GET avec le jeton d'application");
  assert.equal(seen.filter((s) => s.url.includes("login.microsoftonline")).length, 1, "un seul jeton par appel");
  assert.ok(seen.every((s) => !s.url.includes(CLIENT_SECRET) && !s.url.includes(APP_TOKEN)), "aucun secret dans une adresse");
});

Deno.test("M365 diagnostic : comptes, méthodes (sans le mot de passe), échecs de connexion, verrouillage récent, rôle d'administration", async () => {
  const t = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
  const { connector, seen } = fakeGraph({
    methods: [{ "@odata.type": "#microsoft.graph.passwordAuthenticationMethod", id: PASSWORD }, { "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod", id: "a", createdDateTime: "2026-11-16T10:00:00Z" },
      { "@odata.type": "#microsoft.graph.phoneAuthenticationMethod", id: "p" }, { "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "f", creationDateTime: "2026-01-01T00:00:00Z" }],
    signIns: [{ createdDateTime: t(5), status: { errorCode: 50053 } }, { createdDateTime: t(100), status: { errorCode: 50126 } }, { createdDateTime: t(200), status: { errorCode: 50126 } },
      { createdDateTime: t(300), status: { errorCode: 0 } }, { createdDateTime: t(310), status: { errorCode: 50074 } }, { createdDateTime: t(320), status: { errorCode: 50057 } }],
    roles: [{ id: "x", principalId: USER_ID, roleDefinitionId: "y" }], user: { accountEnabled: false },
  });
  const d = await connector.invokeCapability("user.diagnose", { userRef: "marie@client.exemple.fr" }, AGENT);
  assert.deepEqual(d, {
    accountEnabled: false, locked: true, recentFailedSignIns: 4, hasPrivilegedRole: true, lastPasswordChangeAt: "2026-09-01T08:00:00Z",
    mfaMethods: [{ type: "microsoftAuthenticator", createdAt: "2026-11-16T10:00:00Z" }, { type: "phone", createdAt: "" }, { type: "fido2", createdAt: "2026-01-01T00:00:00Z" }],
  });
  assert.deepEqual(calls(seen).slice(1), ["GET /v1.0/users/marie@client.exemple.fr", "GET /v1.0/users/{id}/authentication/methods", "GET /v1.0/auditLogs/signIns", "GET /v1.0/roleManagement/directory/roleAssignments"]);
  const si = seen.find((s) => s.path.endsWith("signIns"))!;
  assert.ok(si.query.includes(`userId eq '${USER_ID}'`) && si.query.includes("createdDateTime ge 2026-11-15T12:00:00.000Z"), "filtre : cet utilisateur, les dernières 24 h");
  assert.ok(seen.find((s) => s.path.endsWith("roleAssignments"))!.query.includes(`principalId eq '${USER_ID}'`));
});

Deno.test("M365 diagnostic : un compte ordinaire sans signal ; un verrouillage ANCIEN n'est pas « verrouillé »", async () => {
  const d = await fakeGraph().connector.invokeCapability("user.diagnose", { userRef: "marie@client.exemple.fr" }, AGENT);
  assert.deepEqual({ locked: d.locked, failed: d.recentFailedSignIns, priv: d.hasPrivilegedRole, enabled: d.accountEnabled }, { locked: false, failed: 0, priv: false, enabled: true });
  const old = await fakeGraph({ signIns: [{ createdDateTime: new Date(NOW - 3 * 3_600_000).toISOString(), status: { errorCode: 50053 } }] }).connector.invokeCapability("user.diagnose", { userRef: "m@c.fr" }, AGENT);
  assert.deepEqual({ locked: old.locked, failed: old.recentFailedSignIns }, { locked: false, failed: 1 });
});

Deno.test("M365 diagnostic : échec FERMÉ : historique des connexions, rôles ou méthodes inaccessibles = erreur, jamais « aucun signe de risque »", async () => {
  for (const [label, needle] of [["connexions", "auditLogs/signIns"], ["rôles", "roleAssignments"], ["méthodes", "/authentication/methods"]] as const) {
    const { connector } = fakeGraph({ handler: (s) => (s.path.includes(needle) ? j({ error: { code: "Authorization_RequestDenied" } }, 403) : undefined) });
    assert.equal(await failure(connector.invokeCapability("user.diagnose", { userRef: "marie@client.exemple.fr" }, AGENT)), "http:auth", label);
  }
  const unknownUser = fakeGraph({ handler: (s) => (/\/users\/[^/]+$/.test(s.path) && s.method === "GET" ? j({}, 404) : undefined) });
  assert.equal(await failure(unknownUser.connector.invokeCapability("user.diagnose", { userRef: "inconnu@client.exemple.fr" }, AGENT)), "http:not_found");
  const noId = fakeGraph({ user: { id: "../../x" } });
  assert.equal(await failure(noId.connector.invokeCapability("user.diagnose", { userRef: "marie@client.exemple.fr" }, AGENT)), "http:bad_response");
});

Deno.test("M365 : un nom d'utilisateur qui n'a pas la forme d'une adresse est refusé AVANT tout appel (aucun détournement de chemin)", async () => {
  for (const userRef of ["a/b@x.fr", "../x@y.fr", "marie@client", "marie client@x.fr", "marie@x.fr/..", "marie@x.fr?a=1", "%2e%2e@x.fr", "marie@x.fr#f", "ma\\rie@x.fr", "", " ", 42, null, undefined, "a".repeat(80) + "@x.fr"]) {
    const { connector, seen } = fakeGraph();
    for (const cap of ["user.diagnose", "user.unlock"] as const) {
      assert.equal(await failure(connector.invokeCapability(cap, { userRef: userRef as string }, human().ctx)), "http:rejected", `${cap} ${String(userRef)}`);
    }
    assert.equal(seen.length, 0, `${String(userRef)} : aucun appel réseau`);
  }
});

Deno.test("M365 état des services : trois états ; un état inconnu est « incident » (on ne rassure pas à tort)", async () => {
  const { connector } = fakeGraph({ health: [{ service: "Exchange Online", status: "ServiceOperational" }, { service: "Teams", status: "ServiceDegradation" }, { service: "Identity", status: "ServiceInterruption" }, { service: "X", status: "ValeurInconnue" }] });
  assert.deepEqual((await connector.invokeCapability("tenant.service_health", {}, AGENT)).map((s) => s.status), ["operational", "degraded", "incident", "incident"]);
  assert.equal(healthStatus("ServiceRestored"), "operational");
  assert.equal(healthStatus(""), "incident");
});

Deno.test("M365 écriture : JAMAIS sans le jeton délégué d'un technicien (agent, système ou jeton absent) ; aucun appel, pas même le jeton d'application", async () => {
  for (const ctx of [AGENT, { ...AGENT, actor: { kind: "system" as const, reason: "automation" as const } }, { ...AGENT, actor: { kind: "human" as const, userId: "u", delegatedToken: "" } },
    { ...AGENT, actor: { kind: "human" as const, userId: "u", delegatedToken: "trop court" } }]) {
    for (const cap of ["user.reset_password", "user.unlock", "user.revoke_sessions", "user.mfa_reregister"] as const) {
      const { connector, seen } = fakeGraph();
      assert.equal(await failure(connector.invokeCapability(cap, { userRef: "marie@client.exemple.fr" }, { ...ctx, deliverSecret: () => {} } as InvocationContext)), "ConnectorError:failed:m365:no_delegated_token", cap);
      assert.equal(seen.length, 0);
    }
  }
});

Deno.test("M365 écriture : les appels portent le jeton DÉLÉGUÉ du technicien, jamais celui de l'application", async () => {
  const { connector, seen } = fakeGraph();
  const { ctx } = human();
  await connector.invokeCapability("user.unlock", { userRef: "marie@client.exemple.fr" }, ctx);
  await connector.invokeCapability("user.revoke_sessions", { userRef: "marie@client.exemple.fr" }, ctx);
  assert.deepEqual(calls(seen), ["PATCH /v1.0/users/marie@client.exemple.fr", "POST /v1.0/users/marie@client.exemple.fr/revokeSignInSessions"]);
  assert.ok(seen.every((s) => s.headers.authorization === `Bearer ${DELEGATED}`));
  assert.deepEqual(seen[0].body, { accountEnabled: true });
  assert.ok(seen.every((s) => !s.url.includes("login.microsoftonline")), "aucun jeton d'application demandé pour écrire");
});

Deno.test("M365 mot de passe : réinitialisation, ATTENTE de la confirmation de Microsoft, puis seulement remise du mot de passe par le canal à usage unique", async () => {
  const { connector, seen } = fakeGraph({ polls: ["running", "running", "succeeded"] });
  const { ctx, secrets } = human();
  const out = await connector.invokeCapability("user.reset_password", { userRef: "marie@client.exemple.fr" }, ctx);
  assert.deepEqual(out, { ok: true, temporaryPasswordDeliveredTo: "technician" });
  assert.deepEqual(secrets, [{ kind: "temporary_password", value: "Mdp-Genere-Par-Microsoft" }]);
  assert.ok(!JSON.stringify(out).includes("Mdp-Genere"), "le mot de passe n'est pas dans le résultat");
  assert.deepEqual(calls(seen), ["POST /v1.0/users/marie@client.exemple.fr/authentication/methods/28c10230-6103-485e-b985-444c60001490/resetPassword", ...Array(3).fill("GET /v1.0/users/{id}/authentication/operations/op1")]);
  assert.deepEqual(seen[0].body, {}, "aucun mot de passe choisi par nous : Microsoft en génère un");
});

Deno.test("M365 mot de passe : pas de canal = RIEN n'est réinitialisé ; opération échouée, non confirmée ou réponse douteuse = aucun mot de passe remis", async () => {
  const noChannel = fakeGraph();
  assert.equal(await failure(noChannel.connector.invokeCapability("user.reset_password", { userRef: "marie@client.exemple.fr" }, human({ deliverSecret: undefined }).ctx)), "ConnectorError:failed:m365:no_secret_channel");
  assert.equal(noChannel.seen.length, 0, "aucun appel : un mot de passe que personne ne connaît bloquerait le salarié");

  const cases: Array<[string, Script, string]> = [
    ["échec de l'opération", { polls: ["failed"] }, "ConnectorError:failed:m365:reset_failed"],
    ["jamais confirmée", { polls: ["running"] }, "ConnectorError:unknown:m365:not_confirmed"],
    ["adresse de suivi absente", { location: null }, "ConnectorError:unknown:m365:bad_response"],
    ["adresse de suivi ailleurs", { location: "https://evil.exemple.fr/v1.0/users/x/authentication/operations/1" }, "ConnectorError:unknown:m365:bad_location"],
    ["adresse de suivi hors chemin", { location: "https://graph.microsoft.com/v1.0/organization" }, "ConnectorError:unknown:m365:bad_location"],
    ["mot de passe absent", { newPassword: undefined as unknown, handler: (s) => (s.path.endsWith("/resetPassword") ? j({}, 202, { location: `https://graph.microsoft.com/v1.0/users/${USER_ID}/authentication/operations/op1` }) : undefined) }, "ConnectorError:unknown:m365:bad_response"],
    ["mot de passe trop court", { newPassword: "court" }, "ConnectorError:unknown:m365:bad_response"],
  ];
  for (const [label, script, expected] of cases) {
    const { connector, seen } = fakeGraph(script);
    const { ctx, secrets } = human();
    assert.equal(await failure(connector.invokeCapability("user.reset_password", { userRef: "marie@client.exemple.fr" }, ctx)), expected, label);
    assert.equal(secrets.length, 0, `${label} : aucun mot de passe remis`);
    assert.ok(seen.every((s) => !s.url.includes("evil.exemple.fr")), `${label} : aucune requête vers une adresse étrangère`);
  }
});

Deno.test("M365 écriture : un refus AVANT toute écriture est un échec certain ; une panne ou un délai est une issue incertaine ; jamais de détail dans l'erreur", async () => {
  const denied = fakeGraph({ handler: (s) => (s.method === "PATCH" ? j({ error: { code: "Authorization_RequestDenied", message: "secret interne 10.0.0.5" } }, 403) : undefined) });
  const e1 = await denied.connector.invokeCapability("user.unlock", { userRef: "marie@client.exemple.fr" }, human().ctx).catch((e: ConnectorError) => e);
  assert.deepEqual([(e1 as ConnectorError).outcome, (e1 as Error).message], ["failed", "m365:auth"]);
  assert.ok(!(e1 as Error).message.includes("10.0.0.5"));
  const down = fakeGraph({ handler: (s) => (s.method === "PATCH" ? new Response("x", { status: 503 }) : undefined) });
  assert.equal(await failure(down.connector.invokeCapability("user.unlock", { userRef: "marie@client.exemple.fr" }, human().ctx)), "ConnectorError:unknown:m365:unavailable");
  const notTrue = fakeGraph({ handler: (s) => (s.path.endsWith("revokeSignInSessions") ? j({ value: false }) : undefined) });
  assert.equal(await failure(notTrue.connector.invokeCapability("user.revoke_sessions", { userRef: "marie@client.exemple.fr" }, human().ctx)), "ConnectorError:unknown:m365:bad_response");
});

Deno.test("M365 second facteur : supprime TOUTES les méthodes sauf le mot de passe (le salarié se réinscrira) ; identifiants hostiles et méthodes inconnues ne sont jamais devinés", async () => {
  const { connector, seen } = fakeGraph({ methods: [
    { "@odata.type": "#microsoft.graph.passwordAuthenticationMethod", id: PASSWORD },
    { "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod", id: "auth1" },
    { "@odata.type": "#microsoft.graph.phoneAuthenticationMethod", id: "3179e48a-750b-4051-897c-87b9720928f7" },
    { "@odata.type": "#microsoft.graph.softwareOathAuthenticationMethod", id: "oath1" },
    { "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "fido1" },
  ] });
  assert.deepEqual(await connector.invokeCapability("user.mfa_reregister", { userRef: "marie@client.exemple.fr" }, human().ctx), { ok: true });
  assert.deepEqual(calls(seen), ["GET /v1.0/users/marie@client.exemple.fr/authentication/methods",
    "DELETE /v1.0/users/marie@client.exemple.fr/authentication/microsoftAuthenticatorMethods/auth1",
    "DELETE /v1.0/users/marie@client.exemple.fr/authentication/phoneMethods/3179e48a-750b-4051-897c-87b9720928f7",
    "DELETE /v1.0/users/marie@client.exemple.fr/authentication/softwareOathMethods/oath1",
    "DELETE /v1.0/users/marie@client.exemple.fr/authentication/fido2Methods/fido1"]);
  assert.ok(!calls(seen).some((c) => c.includes(PASSWORD)), "le mot de passe n'est jamais supprimé");

  const hostile = fakeGraph({ methods: [{ "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "../../organization" }, { "@odata.type": "#microsoft.graph.autreMethode", id: "z" }] });
  assert.equal(await failure(hostile.connector.invokeCapability("user.mfa_reregister", { userRef: "marie@client.exemple.fr" }, human().ctx)), "ConnectorError:failed:m365:method_not_deletable");
  assert.equal(hostile.seen.filter((s) => s.method === "DELETE").length, 0, "rien de supprimé avec un identifiant hostile");

  const partial = fakeGraph({ methods: [{ "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "f1" }, { "@odata.type": "#microsoft.graph.autreMethode", id: "z" }] });
  assert.equal(await failure(partial.connector.invokeCapability("user.mfa_reregister", { userRef: "marie@client.exemple.fr" }, human().ctx)), "ConnectorError:unknown:m365:method_not_deletable", "une suppression faite puis une méthode restante = incertain");
});

Deno.test("M365 second facteur : le refus de Microsoft (second facteur récent exigé du technicien) AVANT toute suppression est un échec certain ; en cours de route, incertain", async () => {
  const refused = fakeGraph({ handler: (s) => (s.method === "DELETE" ? j({ error: { code: "Forbidden" } }, 403) : undefined) });
  assert.equal(await failure(refused.connector.invokeCapability("user.mfa_reregister", { userRef: "marie@client.exemple.fr" }, human().ctx)), "ConnectorError:failed:m365:auth", "refus explicite de la PREMIÈRE suppression : rien n'a changé");
  const halfway = fakeGraph({ methods: [{ "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "f1" }, { "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "f2" }], handler: (s) => (s.method === "DELETE" && s.path.endsWith("f2") ? new Response("x", { status: 500 }) : undefined) });
  assert.equal(await failure(halfway.connector.invokeCapability("user.mfa_reregister", { userRef: "marie@client.exemple.fr" }, human().ctx)), "ConnectorError:unknown:m365:unavailable");
  const halfwayRefused = fakeGraph({ methods: [{ "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "f1" }, { "@odata.type": "#microsoft.graph.fido2AuthenticationMethod", id: "f2" }], handler: (s) => (s.method === "DELETE" && s.path.endsWith("f2") ? j({}, 403) : undefined) });
  assert.equal(await failure(halfwayRefused.connector.invokeCapability("user.mfa_reregister", { userRef: "marie@client.exemple.fr" }, human().ctx)), "ConnectorError:unknown:m365:auth", "une suppression a RÉUSSI avant le refus : incertain");
});

Deno.test("M365 santé : application bien configurée et consentie = ok ; non configurée, consentement absent ou panne = faux avec la nature de l'échec, sans lever d'erreur", async () => {
  assert.equal((await fakeGraph().connector.health()).ok, true);
  const noApp = new M365Connector(ROW, { appCredentials: () => null });
  assert.deepEqual({ ok: (await noApp.health()).ok, detail: (await noApp.health()).detail }, { ok: false, detail: "config" });
  const noConsent = fakeGraph({ handler: (s) => (s.url.includes("login.microsoftonline") ? j({ error: "invalid_client" }, 401) : undefined) });
  const h = await noConsent.connector.health();
  assert.deepEqual({ ok: h.ok, detail: h.detail }, { ok: false, detail: "auth" });
  const bad = fakeGraph({ handler: (s) => (s.url.includes("login.microsoftonline") ? j({ access_token: "../x", expires_in: 3599 }) : undefined) });
  assert.equal((await bad.connector.health()).detail, "bad_response");
});

const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = (claims: Record<string, unknown>) => `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u(claims)}.${"s".repeat(30)}`;
const OID = "99999999-8888-4777-8666-555555555555";

Deno.test("lien du compte Microsoft : Microsoft vérifie le jeton (/me) ; on exige le tenant du connecteur et le MÊME identifiant d'objet", async () => {
  const { verifyDelegatedIdentity } = await import("./m365.ts");
  const seen: string[] = [];
  const me = (body: unknown, status = 200) => ({ fetch: ((u: string, i: RequestInit) => { seen.push(`${(i.headers as Record<string, string>).authorization}|${u}`); return Promise.resolve(j(body, status)); }) as unknown as typeof fetch });
  const good = tokenFor({ tid: TENANT, oid: OID, aud: "https://graph.microsoft.com" });
  assert.deepEqual(await verifyDelegatedIdentity(good, TENANT, me({ id: OID, userPrincipalName: "tech@client.exemple.fr" })), { tenantId: TENANT, objectId: OID, upn: "tech@client.exemple.fr" });
  assert.equal(seen[0], `Bearer ${good}|https://graph.microsoft.com/v1.0/me?$select=${encodeURIComponent("id,userPrincipalName")}`);

  seen.length = 0;
  for (const [label, token] of [["autre tenant", tokenFor({ tid: "22222222-2222-4222-8222-222222222222", oid: OID })], ["sans oid", tokenFor({ tid: TENANT })], ["illisible", "a.b.c" + "x".repeat(30)]] as const) {
    await assert.rejects(() => verifyDelegatedIdentity(token, TENANT, me({ id: OID, userPrincipalName: "t@c.fr" })), ConnectorHttpError, label);
  }
  assert.equal(seen.length, 0, "refus tôt : aucun appel à Microsoft");
  await assert.rejects(() => verifyDelegatedIdentity(good, TENANT, me({ id: "11111111-1111-4111-8111-111111111111", userPrincipalName: "autre@c.fr" })), ConnectorHttpError, "Microsoft renvoie un autre compte que celui du jeton");
  await assert.rejects(() => verifyDelegatedIdentity(good, TENANT, me({ error: { code: "InvalidAuthenticationToken" } }, 401)), ConnectorHttpError, "jeton refusé par Microsoft");
  await assert.rejects(() => verifyDelegatedIdentity(good, TENANT, me({ id: OID, userPrincipalName: "../x" })), ConnectorHttpError);
  for (const bad of [undefined, "", "court", 42]) await assert.rejects(() => verifyDelegatedIdentity(bad, TENANT, me({})), ConnectorHttpError);
});
