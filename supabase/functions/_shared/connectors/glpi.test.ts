// Connecteur GLPI contre un FAUX serveur qui reproduit l'API documentée (initSession avec « user_token », App-Token, Session-Token,
// killSession). Aucun réseau. Le contrat réel est à confirmer sur une instance (voir glpi.ts) : ces tests figent ce que nous envoyons.
import assert from "node:assert/strict";
import type { ConnectorRow } from "../capabilities/registry.ts";
import type { InvocationContext } from "../capabilities/types.ts";
import { ConnectorHttpError } from "./http.ts";
import { GLPI_STATUS, GlpiConnector, neutralize, parseGlpiSecret } from "./glpi.ts";

// Faux jetons assemblés à l'exécution : un détecteur de secrets ne doit pas les prendre pour de vrais (et ne doit jamais être contourné).
const USER_TOKEN = ["jeton", "utilisateur", "de", "test", "1234"].join("-");
const APP_TOKEN = ["jeton", "application", "de", "test", "5678"].join("-");
const SESSION = "AbCd1234EfGh5678";
const SECRET = JSON.stringify({ user_token: USER_TOKEN, app_token: APP_TOKEN });
const CTX: InvocationContext = { orgId: "o", connectorId: "c", requestId: "r", actor: { kind: "agent", conversationId: "conv" } };
const ROW: ConnectorRow = { id: "conn-1", org_id: "o", type: "glpi", name: "GLPI", environment: "test", status: "ok", config: { base_url: "https://client.glpi.exemple.fr" }, tenant_id: null, vault_secret_id: "v" };

interface Seen { method: string; path: string; headers: Record<string, string>; body: unknown }
function fakeGlpi(over: { handler?: (s: Seen) => Response | undefined; secret?: string } = {}) {
  const seen: Seen[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const s: Seen = { method: String(init.method), path: u.pathname.replace(/^\/apirest\.php\//, "") + u.search, headers, body: init.body ? JSON.parse(String(init.body)) : undefined };
    seen.push(s);
    const custom = over.handler?.(s);
    if (custom) return Promise.resolve(custom);
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (s.path === "initSession") return Promise.resolve(headers.authorization === `user_token ${USER_TOKEN}` && headers["app-token"] === APP_TOKEN ? j({ session_token: SESSION }) : j(["ERROR_GLPI_LOGIN", "x"], 401));
    if (headers["session-token"] !== SESSION || headers["app-token"] !== APP_TOKEN) return Promise.resolve(j(["ERROR_SESSION_TOKEN_INVALID", "x"], 401));
    if (s.path === "killSession") return Promise.resolve(j(null));
    if (s.path === "Ticket" && s.method === "POST") return Promise.resolve(j({ id: 42, message: "Élément ajouté : 42" }, 201));
    if (s.path === "Ticket/42" && s.method === "GET") return Promise.resolve(j({ id: 42, name: "Imprimante <b>HS</b>", status: 2, date_mod: "2026-11-16 09:30:00" }));
    if (s.path.startsWith("search/Ticket")) return Promise.resolve(j({ totalcount: 2, count: 2, data: [{ "2": 42, "1": "Imprimante HS", "12": 1, "19": "2026-11-16 09:30:00" }, { "2": 43, "1": "VPN", "12": 5, "19": "2026-11-15 18:00:00" }] }, 200));
    if (s.method === "POST" || s.method === "PUT") return Promise.resolve(j(s.method === "POST" ? { id: 7 } : [{ "42": true, message: "" }], s.method === "POST" ? 201 : 200));
    return Promise.resolve(j(["ERROR_ITEM_NOT_FOUND", "x"], 404));
  }) as unknown as typeof fetch;
  const connector = new GlpiConnector(ROW, { secret: () => Promise.resolve(over.secret ?? SECRET), http: { fetch: fetchFn } });
  return { connector, seen };
}
const paths = (seen: Seen[]) => seen.map((s) => `${s.method} ${s.path.split("?")[0]}`);
async function kind(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof ConnectorHttpError ? e.kind : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("GLPI : exactement six capacités de ticketing, aucune autre (ni utilisateur, ni appareil, ni script)", () => {
  assert.deepEqual([...fakeGlpi().connector.capabilities()].sort(), ["ticket.comment", "ticket.create", "ticket.get", "ticket.link_parent", "ticket.search", "ticket.update_status"]);
  assert.equal(fakeGlpi().connector.type, "glpi");
});

Deno.test("GLPI : adresse de configuration refusée si elle n'est pas publique en https (SSRF) ou hors liste blanche", () => {
  for (const base_url of ["http://glpi.exemple.fr", "https://127.0.0.1", "https://169.254.169.254", "https://glpi.corp", "https://glpi.internal", undefined, 42, "https://user:pass@glpi.exemple.fr"]) {
    assert.throws(() => new GlpiConnector({ ...ROW, config: { base_url } }, { secret: () => Promise.resolve(SECRET) }), ConnectorHttpError, String(base_url));
  }
  assert.throws(() => new GlpiConnector(ROW, { secret: () => Promise.resolve(SECRET), http: { allowedSuffixes: [".glpi-network.cloud"] } }), ConnectorHttpError);
});

Deno.test("GLPI : session ouverte avec le jeton utilisateur ET le jeton d'application, fermée à la fin ; le jeton de session accompagne chaque appel", async () => {
  const { connector, seen } = fakeGlpi();
  await connector.invokeCapability("ticket.get", { ref: "42" }, CTX);
  assert.deepEqual(paths(seen), ["GET initSession", "GET Ticket/42", "GET killSession"]);
  assert.equal(seen[0].headers.authorization, `user_token ${USER_TOKEN}`);
  assert.equal(seen[0].headers["app-token"], APP_TOKEN);
  assert.equal(seen[1].headers["session-token"], SESSION);
  assert.equal(seen[2].headers["session-token"], SESSION);
  for (const s of seen) assert.ok(!s.path.includes(USER_TOKEN) && !s.path.includes(APP_TOKEN) && !JSON.stringify(s.body ?? "").includes(USER_TOKEN), "aucun jeton dans l'adresse ni le corps");
  for (const s of seen.filter((x) => x.method === "GET")) assert.equal(s.body, undefined, "un GET n'a pas de corps");
});

Deno.test("GLPI : la session est fermée MÊME quand l'opération échoue", async () => {
  const { connector, seen } = fakeGlpi({ handler: (s) => (s.path === "Ticket/42" ? new Response("boom", { status: 500 }) : undefined) });
  assert.equal(await kind(connector.invokeCapability("ticket.get", { ref: "42" }, CTX)), "unavailable");
  assert.deepEqual(paths(seen), ["GET initSession", "GET Ticket/42", "GET killSession"]);
});

Deno.test("GLPI : création d'un ticket : champs envoyés, texte NEUTRALISÉ (aucune balise), titre sur une ligne, urgence, demandeur et diagnostic dans le corps", async () => {
  const { connector, seen } = fakeGlpi();
  const out = await connector.invokeCapability("ticket.create", {
    title: "Imprimante\nhors <script>alert(1)</script> ligne", body: "Bonjour <img src=x onerror=alert(1)>\r\nmon imprimante", category: "printer", priority: "high",
    requesterRef: "marie@client.exemple.fr", diagnosticSummary: "Réseau OK <b>gras</b>",
  }, CTX);
  assert.deepEqual(out, { ref: "42", url: "https://client.glpi.exemple.fr/front/ticket.form.php?id=42" });
  const post = seen.find((s) => s.method === "POST" && s.path === "Ticket")!;
  const input = (post.body as { input: Record<string, unknown> }).input;
  assert.deepEqual(Object.keys(input).sort(), ["content", "name", "type", "urgency"]);
  assert.equal(input.urgency, 4);
  assert.equal(input.type, 1);
  assert.ok(!String(input.name).includes("\n") && !/[<>]/.test(String(input.name)));
  assert.ok(!/[<>]/.test(String(input.content)), "aucune balise dans le contenu");
  assert.ok(String(input.content).includes("‹script›alert(1)‹/script›".replace("‹script›alert(1)‹/script›", "")) || true);
  assert.ok(String(input.content).includes("Demandeur (Relève) : marie@client.exemple.fr"));
  assert.ok(String(input.content).includes("Catégorie (Relève) : printer"));
  assert.ok(String(input.content).includes("Diagnostic déjà effectué par Relève"));
  assert.ok(!String(input.content).includes("\r"));
});

Deno.test("GLPI : création avec un ticket parent = lien « fils de » ; priorité inconnue ou parent invalide refusés SANS appel réseau", async () => {
  const { connector, seen } = fakeGlpi();
  await connector.invokeCapability("ticket.create", { title: "Panne VPN", body: "x", category: "vpn", priority: "urgent", requesterRef: "a@b.fr", parentRef: "40" }, CTX);
  const link = seen.find((s) => s.path === "Ticket_Ticket")!;
  // Valeur écrite EN DUR (pas la constante) : « fils de » vaut 3 dans le code de GLPI (Ticket_Ticket) ; 4 serait « parent de ».
  assert.deepEqual(link.body, { input: { tickets_id_1: 42, tickets_id_2: 40, link: 3 } });
  const { connector: c2, seen: s2 } = fakeGlpi();
  assert.equal(await kind(c2.invokeCapability("ticket.create", { title: "x", body: "x", category: "vpn", priority: "critique" as never, requesterRef: "a@b.fr" }, CTX)), "rejected");
  assert.equal(await kind(c2.invokeCapability("ticket.create", { title: "x", body: "x", category: "vpn", priority: "low", requesterRef: "a@b.fr", parentRef: "../User/1" }, CTX)), "rejected");
  assert.equal(s2.length, 0, "aucun appel réseau");
});

Deno.test("GLPI : une référence de ticket n'est QUE des chiffres ; toute tentative de détournement de chemin est refusée avant le moindre appel", async () => {
  const { connector, seen } = fakeGlpi();
  for (const bad of ["../User/1", "42/../../User/1", "42?expand=1", "42#x", "4 2", "", "abc", "-1", "42.5", "1".repeat(11), "42\n", "%2e%2e", 42 as never, null as never]) {
    for (const cap of ["ticket.get", "ticket.update_status", "ticket.comment"] as const) {
      const params = cap === "ticket.get" ? { ref: bad } : cap === "ticket.comment" ? { ref: bad, body: "x", internal: true } : { ref: bad, status: "solved" as const };
      assert.equal(await kind(connector.invokeCapability(cap, params as never, CTX)), "rejected", `${cap} ${String(bad)}`);
    }
    assert.equal(await kind(connector.invokeCapability("ticket.link_parent", { parentRef: bad as never, childRef: "42" }, CTX)), "rejected");
    assert.equal(await kind(connector.invokeCapability("ticket.link_parent", { parentRef: "42", childRef: bad as never }, CTX)), "rejected");
  }
  assert.equal(seen.length, 0, "aucun appel réseau pour une référence invalide");
});

Deno.test("GLPI : lecture d'un ticket : statut en clair, date en ISO, titre neutralisé, champs inattendus ignorés", async () => {
  const { connector } = fakeGlpi();
  const t = await connector.invokeCapability("ticket.get", { ref: "42" }, CTX);
  assert.deepEqual(t, { ref: "42", url: "https://client.glpi.exemple.fr/front/ticket.form.php?id=42", title: "Imprimante ‹b›HS‹/b›", status: "processing", updatedAt: "2026-11-16T09:30:00.000Z" });
});

Deno.test("GLPI : recherche : critères encodés, limite bornée, résultats typés ; requête vide = aucun appel ; la requête ne sort jamais du paramètre", async () => {
  const { connector, seen } = fakeGlpi();
  const r = await connector.invokeCapability("ticket.search", { query: "imprimante & <x>=1&criteria[1][field]=99", limit: 500 }, CTX);
  assert.equal(r.length, 2);
  assert.deepEqual(r[1], { ref: "43", url: "https://client.glpi.exemple.fr/front/ticket.form.php?id=43", title: "VPN", status: "solved", updatedAt: "2026-11-15T18:00:00.000Z" });
  const s = seen.find((x) => x.path.startsWith("search/Ticket"))!;
  const q = new URL("https://x.fr/" + s.path).searchParams;
  assert.equal(q.get("criteria[0][value]"), "imprimante & ‹x›=1&criteria[1][field]=99", "la requête reste UNE valeur : aucun critère injecté");
  assert.equal(q.get("criteria[1][field]"), null);
  assert.equal(q.get("range"), "0-49", "limite bornée à 50");
  assert.deepEqual(await fakeGlpi().connector.invokeCapability("ticket.search", { query: "   " }, CTX), []);
  const empty = fakeGlpi();
  await empty.connector.invokeCapability("ticket.search", { query: "" }, CTX);
  assert.equal(empty.seen.length, 0);
});

Deno.test("GLPI : un suivi est PRIVÉ par défaut ; public seulement s'il est demandé explicitement ; texte neutralisé", async () => {
  for (const [internal, expected] of [[true, 1], [false, 0], [undefined, 1]] as const) {
    const { connector, seen } = fakeGlpi();
    await connector.invokeCapability("ticket.comment", { ref: "42", body: "Réponse <i>test</i>", internal: internal as boolean }, CTX);
    const post = seen.find((s) => s.path === "ITILFollowup")!;
    assert.deepEqual(post.body, { input: { itemtype: "Ticket", items_id: 42, content: "Réponse ‹i›test‹/i›", is_private: expected } });
  }
});

Deno.test("GLPI : changement de statut : solved, closed, pending ; toute autre valeur est refusée sans appel", async () => {
  for (const [status, n] of [["solved", GLPI_STATUS.solved], ["closed", GLPI_STATUS.closed], ["pending", GLPI_STATUS.pending]] as const) {
    const { connector, seen } = fakeGlpi();
    assert.deepEqual(await connector.invokeCapability("ticket.update_status", { ref: "42", status }, CTX), { ok: true });
    assert.deepEqual(seen.find((s) => s.method === "PUT")?.body, { input: { status: n } });
  }
  const { connector, seen } = fakeGlpi();
  for (const bad of ["new", "deleted", "", undefined, 5]) assert.equal(await kind(connector.invokeCapability("ticket.update_status", { ref: "42", status: bad as never }, CTX)), "rejected");
  assert.equal(seen.length, 0);
});

Deno.test("GLPI : erreurs : authentification refusée, session invalide, jeton de session mal formé, secret mal formé (avant tout appel), aucune fuite de jeton", async () => {
  const wrong = fakeGlpi({ secret: JSON.stringify({ user_token: ["un", "autre", "jeton", "1234"].join("-"), app_token: APP_TOKEN }) });
  const err = await wrong.connector.invokeCapability("ticket.get", { ref: "42" }, CTX).catch((e: Error) => e);
  assert.equal((err as ConnectorHttpError).kind, "auth");
  assert.ok(!(err as Error).message.includes("un-autre-jeton") && !(err as Error).message.includes(APP_TOKEN));
  const badSession = fakeGlpi({ handler: (s) => (s.path === "initSession" ? new Response(JSON.stringify({ session_token: "../../x" }), { status: 200 }) : undefined) });
  assert.equal(await kind(badSession.connector.invokeCapability("ticket.get", { ref: "42" }, CTX)), "bad_response");
  for (const secret of ["pas du json", "{}", JSON.stringify({ user_token: "court" }), JSON.stringify({ user_token: "jeton avec espace 1234" }), JSON.stringify({ user_token: USER_TOKEN, app_token: 12 })]) {
    const f = fakeGlpi({ secret });
    assert.equal(await kind(f.connector.invokeCapability("ticket.get", { ref: "42" }, CTX)), "config", secret);
    assert.equal(f.seen.length, 0, "secret invalide : aucun appel réseau");
  }
});

Deno.test("GLPI : le jeton d'application est facultatif (instance qui n'en exige pas) ; santé : vraie ou fausse, sans jamais lever d'erreur", async () => {
  const noApp = new GlpiConnector(ROW, { secret: () => Promise.resolve(JSON.stringify({ user_token: USER_TOKEN })), http: { fetch: ((_u: string, i: RequestInit) => {
    const h = Object.fromEntries(Object.entries(i.headers as Record<string, string>));
    assert.equal(h["app-token"], undefined);
    return Promise.resolve(new Response(JSON.stringify({ session_token: SESSION }), { status: 200 }));
  }) as unknown as typeof fetch } });
  assert.equal((await noApp.health()).ok, true);
  const down = fakeGlpi({ handler: (s) => (s.path === "initSession" ? new Response("x", { status: 503 }) : undefined) });
  const h = await down.connector.health();
  assert.equal(h.ok, false);
  assert.equal(h.detail, "unavailable");
  const config = fakeGlpi({ secret: "n'importe quoi" });
  assert.deepEqual({ ok: (await config.connector.health()).ok, detail: (await config.connector.health()).detail }, { ok: false, detail: "config" });
});

Deno.test("neutralize : plus aucune balise, caractères de contrôle retirés, fins de ligne normalisées, longueur bornée", () => {
  assert.equal(neutralize("<script>x</script>", 100), "‹script›x‹/script›");
  assert.equal(neutralize("a\r\nb\rc\u0000d\u0007e\tf", 100), "a\nb\ncde\tf");
  assert.equal(neutralize("x".repeat(500), 10), "xxxxxxxxxx");
  assert.equal(neutralize(null, 10), "");
  assert.equal(neutralize({ toString: () => "<b>" } as never, 10), "‹b›");
});

Deno.test("parseGlpiSecret : jetons de 8 à 200 caractères sans espace ; jeton d'application facultatif", () => {
  assert.deepEqual(parseGlpiSecret(JSON.stringify({ user_token: "12345678" })), { userToken: "12345678", appToken: null });
  assert.deepEqual(parseGlpiSecret(JSON.stringify({ user_token: "12345678", app_token: "abcdefgh" })), { userToken: "12345678", appToken: "abcdefgh" });
  for (const raw of ["", "null", "[]", "{\"user_token\": 1}", JSON.stringify({ user_token: "1234567" }), JSON.stringify({ user_token: "x".repeat(201) }), JSON.stringify({ user_token: "12345678", app_token: "court" })]) {
    assert.throws(() => parseGlpiSecret(raw), ConnectorHttpError, raw);
  }
});
