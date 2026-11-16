// Microsoft 365 côté administration : connexion du tenant (jamais avant l'activation du client, SEC-30), lien du compte de CHAQUE technicien
// (T12) vérifié par Microsoft, aucun jeton conservé.
import assert from "node:assert/strict";
import { AppError } from "../errors.ts";
import { ConnectorHttpError } from "../connectors/http.ts";
import { MS_OID, rig, TENANT_ID, VALID_BODY } from "./test_rig.ts";

const tech = { access: { org_role: "org_technician" } };
const admin = { access: { org_role: "org_admin" } };

Deno.test("SEC-30 : un tenant Microsoft 365 ne se connecte PAS avant l'activation du client, même par l'ESN ; rien n'est créé", async () => {
  for (const who of [{ access: { org_role: "org_admin", is_activated: false } }, { access: { org_role: "partner_admin", via: "partner", is_activated: false } }]) {
    const r = rig();
    const res = await r.call("connector.create_m365", VALID_BODY["connector.create_m365"], who);
    assert.equal(res.status, 403);
    assert.equal(res.code, "not_activated");
    assert.equal(r.calls.length, 0);
  }
});

Deno.test("connexion du tenant : après activation, créé avec SON identifiant de tenant, testé, statut enregistré ; identifiant invalide refusé", async () => {
  const r = rig({}, [], undefined, { health: { ok: false, detail: "auth" } });
  const res = await r.call("connector.create_m365", VALID_BODY["connector.create_m365"], admin);
  assert.equal(res.status, 200);
  assert.deepEqual({ status: res.json.status, detail: res.json.detail }, { status: "error", detail: "auth" }, "consentement absent : visible, sans détail");
  assert.deepEqual(r.calls[0].args[0], { type: "m365", name: "Microsoft 365 du cabinet", tenantId: TENANT_ID });
  for (const tenantId of ["contoso.onmicrosoft.com", "", "../x", 42]) {
    assert.equal((await rig().call("connector.create_m365", { name: "M365", tenantId } as Record<string, unknown>, admin)).status, 400, String(tenantId));
  }
});

Deno.test("T12 lien du compte : le tenant vient du CONNECTEUR en base (jamais du corps), le jeton est vérifié par Microsoft, seul le lien est conservé", async () => {
  const r = rig();
  const res = await r.call("microsoft.link", { ...VALID_BODY["microsoft.link"], tenantId: "22222222-2222-4222-8222-222222222222", objectId: "pirate", upn: "admin@autre.fr" }, tech);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { linked: true, upn: "tech@client.exemple.fr" });
  assert.equal(r.verifyCalls[0].tenantId, TENANT_ID, "le tenant attendu est celui du connecteur");
  const link = r.calls.find((c) => c.method === "linkMicrosoftIdentity")!;
  assert.deepEqual(link.args[0], { connectorId: "423e4567-e89b-12d3-a456-426614174000", tenantId: TENANT_ID, objectId: MS_OID, upn: "tech@client.exemple.fr" });
  const token = String(VALID_BODY["microsoft.link"].microsoftToken);
  assert.ok(![res.text, JSON.stringify(r.calls), JSON.stringify(r.db.inserts)].join().includes(token), "le jeton n'est ni renvoyé, ni stocké, ni audité");
});

Deno.test("T12 : connecteur inconnu ou d'une autre organisation = 404 ; jeton refusé par Microsoft, d'un autre tenant ou d'un autre compte = 403 au message fixe ; panne = 503", async () => {
  const none = rig({ microsoftTenantOf: () => null });
  assert.equal((await none.call("microsoft.link", VALID_BODY["microsoft.link"], tech)).status, 404);
  assert.equal(none.verifyCalls.length, 0);
  const refused = rig({}, [], undefined, { verify: new ConnectorHttpError("auth", 403) });
  const res = await refused.call("microsoft.link", VALID_BODY["microsoft.link"], tech);
  assert.equal(res.status, 403);
  assert.match(String((res.json.error as { message: string }).message), /doit être le vôtre et appartenir au tenant du client/);
  assert.equal(refused.calls.some((c) => c.method === "linkMicrosoftIdentity"), false);
  const down = rig({}, [], undefined, { verify: new ConnectorHttpError("unavailable") });
  assert.equal((await down.call("microsoft.link", VALID_BODY["microsoft.link"], tech)).status, 503);
  for (const microsoftToken of [undefined, "", "court", 42, "x".repeat(6001)]) {
    const r = rig();
    assert.equal((await r.call("microsoft.link", { connectorId: VALID_BODY["microsoft.link"].connectorId, microsoftToken } as Record<string, unknown>, tech)).status, 400);
    assert.equal(r.verifyCalls.length, 0);
  }
});

Deno.test("T12 : délier son compte est toujours possible (même en arrêt d'urgence, sans second facteur) ; seulement le sien", async () => {
  const r = rig();
  assert.equal((await r.call("microsoft.unlink", VALID_BODY["microsoft.unlink"], { access: { org_role: "org_technician", is_frozen: true }, mfaAge: null })).status, 200);
  assert.deepEqual(r.calls.map((c) => c.method), ["unlinkMicrosoftIdentity"]);
  const missing = rig({ unlinkMicrosoftIdentity: () => { throw new AppError(404, "not_found", "Introuvable."); } });
  assert.equal((await missing.call("microsoft.unlink", VALID_BODY["microsoft.unlink"], tech)).status, 404);
});
