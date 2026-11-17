// CORS des fonctions (SEC-23, R3-06) : seules les adresses exactes des écrans de Relève reçoivent les en-têtes ; jamais « * », jamais
// de cookie ; sans liste, aucune origine n'est autorisée. Les appels de serveur à serveur (sans Origin) passent sans en-tête CORS.
import assert from "node:assert/strict";
import { parseAllowedOrigins, withCors } from "./cors.ts";

const ok = () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
const req = (method: string, origin?: string) => new Request("https://projet.supabase.co/functions/v1/chat", { method, headers: origin ? { origin } : {} });

Deno.test("liste blanche : seules des origines exactes ; joker, chemin, http public et entrées vides sont ignorés", () => {
  const set = parseAllowedOrigins(" https://app.releve.fr , *, https://*.releve.fr, http://releve.fr, https://app.releve.fr/console, ,HTTPS://Support.ESN.fr, http://localhost:5173 ");
  assert.deepEqual([...set].sort(), ["http://localhost:5173", "https://app.releve.fr", "https://support.esn.fr"]);
  assert.equal(parseAllowedOrigins(undefined).size, 0);
  assert.equal(parseAllowedOrigins("null").size, 0);
});

Deno.test("pré-vol : 204 avec POST seul pour une origine autorisée ; 403 sans aucun en-tête CORS sinon", async () => {
  const h = withCors(ok, parseAllowedOrigins("https://app.releve.fr"));
  const yes = await h(req("OPTIONS", "https://app.releve.fr"));
  assert.equal(yes.status, 204);
  assert.equal(yes.headers.get("access-control-allow-origin"), "https://app.releve.fr");
  assert.equal(yes.headers.get("access-control-allow-methods"), "POST");
  assert.equal(yes.headers.get("access-control-allow-credentials"), null);
  for (const origin of ["https://evil.example", "https://app.releve.fr.evil.example", "null", "http://app.releve.fr"]) {
    const no = await h(req("OPTIONS", origin));
    assert.equal(no.status, 403, origin);
    assert.equal(no.headers.get("access-control-allow-origin"), null, origin);
  }
});

Deno.test("réponse : l'origine autorisée est renvoyée telle quelle (jamais « * »), une autre n'obtient rien ; Vary: Origin toujours", async () => {
  const h = withCors(ok, parseAllowedOrigins("https://app.releve.fr"));
  const yes = await h(req("POST", "https://app.releve.fr"));
  assert.equal(yes.headers.get("access-control-allow-origin"), "https://app.releve.fr");
  assert.equal(yes.headers.get("access-control-allow-credentials"), null);
  assert.match(yes.headers.get("vary") ?? "", /Origin/);
  const no = await h(req("POST", "https://evil.example"));
  assert.equal(no.headers.get("access-control-allow-origin"), null);
  assert.match(no.headers.get("vary") ?? "", /Origin/);
  // Appel de serveur à serveur (webhook, tâche planifiée) : pas d'Origin, la fonction répond, sans en-tête CORS.
  const server = await h(req("POST"));
  assert.equal(server.status, 200);
  assert.equal(server.headers.get("access-control-allow-origin"), null);
});

Deno.test("sans liste configurée, aucune origine de navigateur n'est autorisée", async () => {
  const h = withCors(ok, parseAllowedOrigins(undefined));
  assert.equal((await h(req("OPTIONS", "https://app.releve.fr"))).status, 403);
  assert.equal((await h(req("POST", "https://app.releve.fr"))).headers.get("access-control-allow-origin"), null);
});
