import assert from "node:assert/strict";
import { baseOf, ConnectorHttpError, requestJson, validateConnectorUrl } from "./http.ts";

function kind(f: () => unknown): string {
  try { f(); } catch (e) { return e instanceof ConnectorHttpError ? e.kind : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}
async function kindAsync(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof ConnectorHttpError ? `${e.kind}${e.status ? `:${e.status}` : ""}` : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}
const json = (body: unknown, status = 200, headers: Record<string, string> = { "content-type": "application/json" }) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

Deno.test("adresse d'un connecteur : seulement https, port 443, nom de domaine public ; tout le reste est refusé (SSRF)", () => {
  assert.equal(validateConnectorUrl("https://mon-entreprise.glpi-network.cloud/").hostname, "mon-entreprise.glpi-network.cloud");
  assert.equal(validateConnectorUrl("https://mon-entreprise.glpi-network.cloud:443/api").port, "");
  const refused = [
    "http://glpi.exemple.fr", "ftp://glpi.exemple.fr", "https://localhost", "https://localhost.", "https://glpi", "https://glpi.", "https://127.0.0.1", "https://127.1", "https://2130706433",
    "https://0x7f.0.0.1", "https://0177.0.0.1", "https://10.0.0.5", "https://192.168.1.10", "https://169.254.169.254", "https://[::1]", "https://[::ffff:127.0.0.1]",
    "https://[fd00::1]", "https://user:pass@glpi.exemple.fr", "https://glpi.exemple.fr:8443", "https://glpi.exemple.fr:80", "https://glpi.exemple.fr/#frag",
    "https://serveur.local", "https://glpi.internal", "https://glpi.corp", "https://x.home.arpa", "https://metadata.google.internal", "https://glpi.lan",
    "", "pas une adresse", "https://", "javascript:alert(1)", "file:///etc/passwd", "https://" + "a".repeat(300) + ".fr", 42, null, undefined, {},
  ];
  for (const u of refused) assert.equal(kind(() => validateConnectorUrl(u)), "config", String(u).slice(0, 50));
});

Deno.test("liste blanche de suffixes : quand elle est renseignée, seuls ces domaines sont acceptés (et pas un domaine qui les contient)", () => {
  const allowed = [".glpi-network.cloud"];
  assert.equal(validateConnectorUrl("https://client.glpi-network.cloud", allowed).hostname, "client.glpi-network.cloud");
  for (const u of ["https://glpi-network.cloud.evil.fr", "https://evilglpi-network.cloud", "https://autre.fr", "https://glpi-network.cloud.fr"]) {
    assert.equal(kind(() => validateConnectorUrl(u, allowed)), "config", u);
  }
  assert.equal(validateConnectorUrl("https://glpi-network.cloud", allowed).hostname, "glpi-network.cloud", "le domaine lui-même");
});

Deno.test("baseOf : normalisée, sans barre finale ni paramètres", () => {
  assert.equal(baseOf("https://glpi.exemple.fr/apirest.php/?a=1"), "https://glpi.exemple.fr/apirest.php");
  assert.equal(baseOf("https://glpi.exemple.fr"), "https://glpi.exemple.fr");
});

Deno.test("requestJson : ne suit JAMAIS une redirection, n'envoie pas de cookies, borne le délai ; l'adresse est revalidée à chaque appel", async () => {
  let seen: RequestInit | undefined;
  const ok = await requestJson("https://glpi.exemple.fr/x", { method: "GET", headers: { "session-token": "t" } }, { fetch: ((_u: string, i: RequestInit) => { seen = i; return Promise.resolve(json({ a: 1 })); }) as unknown as typeof fetch });
  assert.deepEqual(ok.json, { a: 1 });
  assert.equal(seen?.redirect, "manual");
  assert.equal(seen?.credentials, "omit");
  assert.ok(seen?.signal, "délai borné");
  assert.equal(await kindAsync(requestJson("https://glpi.exemple.fr/x", { method: "GET" }, { fetch: (() => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://evil.fr" } }))) as unknown as typeof fetch })), "rejected:302");
  let called = false;
  assert.equal(await kindAsync(requestJson("http://127.0.0.1/x", { method: "GET" }, { fetch: (() => { called = true; return Promise.resolve(json({})); }) as unknown as typeof fetch })), "config");
  assert.equal(called, false, "aucune requête n'est partie");
});

Deno.test("requestJson : statuts d'erreur typés, corps borné, JSON invalide, délai dépassé, réseau coupé", async () => {
  const f = (r: () => Response) => ({ fetch: (() => Promise.resolve(r())) as unknown as typeof fetch });
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json({}, 401)))), "auth:401");
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json({}, 403)))), "auth:403");
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json({}, 404)))), "not_found:404");
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json({}, 400)))), "rejected:400");
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json({}, 422)))), "rejected:422");
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json({}, 503)))), "unavailable:503");
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json("<html>pas du json</html>")))), "bad_response:200");
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => json("x".repeat(1_100_000))))), "too_large");
  assert.deepEqual((await requestJson("https://g.exemple.fr/", { method: "GET" }, f(() => new Response(null, { status: 204 })))).json, null);
  const timeout = (() => Promise.reject(Object.assign(new Error("délai"), { name: "TimeoutError" }))) as unknown as typeof fetch;
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET" }, { fetch: timeout })), "timeout");
  const down = (() => Promise.reject(new Error("ECONNREFUSED 10.0.0.5:443 avec Authorization: user_token secret-de-test"))) as unknown as typeof fetch;
  try { await requestJson("https://g.exemple.fr/", { method: "GET" }, { fetch: down }); assert.fail("devait échouer"); } catch (e) {
    assert.equal((e as ConnectorHttpError).kind, "unavailable");
    assert.ok(!/10\.0\.0\.5|secret-de-test|Authorization/.test((e as Error).message), "aucun détail sensible dans l'erreur");
  }
});

Deno.test("requestJson : un GET ne porte jamais de corps ; un corps est sérialisé en JSON", async () => {
  assert.equal(await kindAsync(requestJson("https://g.exemple.fr/", { method: "GET", body: { a: 1 } }, { fetch: (() => Promise.resolve(json({}))) as unknown as typeof fetch })), "config");
  let seen: RequestInit | undefined;
  await requestJson("https://g.exemple.fr/", { method: "POST", body: { input: { name: "x" } } }, { fetch: ((_u: string, i: RequestInit) => { seen = i; return Promise.resolve(json({ id: 1 }, 201)); }) as unknown as typeof fetch });
  assert.equal(seen?.body, JSON.stringify({ input: { name: "x" } }));
  assert.equal((seen?.headers as Record<string, string>)["content-type"], "application/json");
});
