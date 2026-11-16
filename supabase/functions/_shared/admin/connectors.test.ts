// Opérations de connexion d'un serveur GLPI : adresse refusée si elle n'est pas publique (SSRF), jetons directement au coffre,
// statut du connecteur d'après un vrai test de connexion, aucun jeton ailleurs que dans le coffre.
import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { rig, VALID_BODY } from "./test_rig.ts";

const OP = "connector.create_glpi";
const who = { access: { org_role: "org_admin" } };

Deno.test("connexion GLPI : jetons au COFFRE sous forme JSON, adresse normalisée en configuration, statut « ok » après un test réussi", async () => {
  const r = rig();
  const res = await r.call(OP, VALID_BODY[OP], who);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { connectorId: "423e4567-e89b-12d3-a456-426614174000", status: "ok", detail: null });
  assert.deepEqual(r.calls.map((c) => c.method), ["createConnector", "setConnectorStatus"]);
  assert.deepEqual(r.calls[0].args[0], { type: "glpi", name: "GLPI du cabinet", baseUrl: "https://cabinet.glpi-network.cloud" });
  assert.deepEqual(r.secretCalls, [{ connectorId: "423e4567-e89b-12d3-a456-426614174000", secret: JSON.stringify({ user_token: "jeton-utilisateur-de-test", app_token: "jeton-application-test" }) }]);
  assert.deepEqual(r.calls[1].args, ["423e4567-e89b-12d3-a456-426614174000", { status: "ok", error: null }]);
  assert.deepEqual(r.healthCalls, ["423e4567-e89b-12d3-a456-426614174000"]);
});

Deno.test("connexion GLPI : le jeton d'application est facultatif", async () => {
  const r = rig();
  const { appToken: _a, ...body } = VALID_BODY[OP] as Record<string, unknown>;
  assert.equal((await r.call(OP, body, who)).status, 200);
  assert.equal(r.secretCalls[0].secret, JSON.stringify({ user_token: "jeton-utilisateur-de-test" }));
});

Deno.test("SSRF : une adresse de serveur qui n'est pas publique en https est refusée AVANT toute création ou écriture au coffre", async () => {
  for (const baseUrl of ["http://glpi.exemple.fr", "https://127.0.0.1", "https://169.254.169.254/latest", "https://10.0.0.8", "https://localhost", "https://glpi", "https://[::1]",
    "https://u:p@glpi.exemple.fr", "https://glpi.exemple.fr:8443", "https://serveur.internal", "ftp://glpi.exemple.fr", "javascript:alert(1)"]) {
    const r = rig();
    const res = await r.call(OP, { ...VALID_BODY[OP], baseUrl }, who);
    assert.equal(res.status, 400, baseUrl);
    assert.equal(r.calls.length, 0, `${baseUrl} : aucune création`);
    assert.equal(r.secretCalls.length, 0, `${baseUrl} : aucun secret écrit`);
  }
});

Deno.test("liste blanche de domaines : renseignée, seuls ces domaines sont acceptés", async () => {
  const r = rig({}, [], undefined, { suffixes: [".glpi-network.cloud"] });
  assert.equal((await r.call(OP, { ...VALID_BODY[OP], baseUrl: "https://autre.exemple.fr" }, who)).status, 400);
  assert.equal(r.calls.length, 0);
  assert.equal((await r.call(OP, VALID_BODY[OP], who)).status, 200);
});

Deno.test("jetons : 8 à 200 caractères, sans espace ni caractère de contrôle ; refus avant toute écriture", async () => {
  for (const userToken of ["court", "avec des espaces dedans", "x".repeat(201), "tab\tdans-le-jeton", "nul\u0000dans-le-jeton", "espace\u00a0insécable-1234", "espace\u2003large-123456", "", 42, null, undefined]) {
    const r = rig();
    const res = await r.call(OP, { ...VALID_BODY[OP], userToken }, who);
    assert.equal(res.status, 400, JSON.stringify(userToken));
    assert.equal(r.calls.length + r.secretCalls.length, 0);
  }
  const r = rig();
  assert.equal((await r.call(OP, { ...VALID_BODY[OP], appToken: "court" }, who)).status, 400);
  for (const name of ["", "a", "x".repeat(81), "ligne\nsuivante"]) assert.equal((await rig().call(OP, { ...VALID_BODY[OP], name }, who)).status, 400, JSON.stringify(name));
});

Deno.test("test de connexion échoué : le connecteur reste « erreur » avec la NATURE de l'échec (jamais un détail), la réponse ne contient aucun jeton", async () => {
  const r = rig({}, [], undefined, { health: { ok: false, detail: "auth" } });
  const res = await r.call(OP, VALID_BODY[OP], who);
  assert.equal(res.status, 200);
  assert.deepEqual({ status: res.json.status, detail: res.json.detail }, { status: "error", detail: "auth" });
  assert.deepEqual(r.calls[1].args, ["423e4567-e89b-12d3-a456-426614174000", { status: "error", error: "auth" }]);
  assert.ok(!res.text.includes("jeton-utilisateur-de-test") && !res.text.includes("jeton-application-test"));
  const thrown = rig({}, [], undefined, { health: new Error("réseau coupé vers 10.0.0.5 avec jeton-utilisateur-de-test") });
  const t = await thrown.call(OP, VALID_BODY[OP], who);
  assert.equal(t.json.status, "error");
  assert.ok(!t.text.includes("10.0.0.5") && !t.text.includes("jeton-utilisateur"));
});

Deno.test("coffre indisponible : le connecteur est marqué « erreur », la requête échoue (503), aucun test de connexion n'est tenté", async () => {
  const r = rig({}, [], undefined, { secretFails: true });
  const res = await r.call(OP, VALID_BODY[OP], who);
  assert.equal(res.status, 503);
  assert.deepEqual(r.calls.map((c) => c.method), ["createConnector", "setConnectorStatus"]);
  assert.deepEqual((r.calls[1].args[1] as { status: string }).status, "error");
  assert.equal(r.healthCalls.length, 0);
});

Deno.test("aucun jeton dans l'audit, ni dans les écritures du magasin, ni dans la réponse : ils n'existent que dans l'appel au coffre", async () => {
  const r = rig();
  const res = await r.call(OP, VALID_BODY[OP], who);
  const everywhere = [res.text, JSON.stringify(r.db.inserts), JSON.stringify(r.calls)].join("\n");
  assert.ok(!everywhere.includes("jeton-utilisateur-de-test") && !everywhere.includes("jeton-application-test"));
  assert.equal(r.db.inserts.filter((i) => i.table === "audit_logs").length, 1);
});

Deno.test("l'ESN peut PRÉPARER la connexion avant l'activation du client (voie ESN) ; un salarié, un technicien ou un lecteur ne le peuvent pas", async () => {
  assert.equal((await rig().call(OP, VALID_BODY[OP], { access: { org_role: "partner_admin", via: "partner", is_activated: false } })).status, 200);
  for (const org_role of ["end_user", "org_technician", "partner_technician", "org_viewer", "auditor"]) {
    const r = rig();
    assert.equal((await r.call(OP, VALID_BODY[OP], { access: { org_role } })).status, 403, org_role);
    assert.equal(r.calls.length + r.secretCalls.length, 0);
  }
});

Deno.test("connector.test : teste la connexion, met le statut à jour ; un connecteur d'une autre organisation est introuvable (404), sans effet", async () => {
  const r = rig({}, [], undefined, { health: { ok: false, detail: "timeout" } });
  const res = await r.call("connector.test", VALID_BODY["connector.test"], who);
  assert.deepEqual({ status: res.json.status, detail: res.json.detail }, { status: "error", detail: "timeout" });
  assert.deepEqual(r.calls.map((c) => c.method), ["setConnectorStatus"]);
  const missing = rig({}, [], undefined, { health: new AppError(404, "not_found", "Introuvable.") });
  const res2 = await missing.call("connector.test", VALID_BODY["connector.test"], who);
  assert.equal(res2.status, 404, "introuvable dans CETTE organisation : 404, et aucun statut n'est modifié");
  assert.equal(missing.calls.length, 0);
});
