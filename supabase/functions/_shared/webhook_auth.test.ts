// Garde du webhook signé (SEC-17) et contexte de tâche planifiée limité à une organisation.
import assert from "node:assert/strict";
import { OrgStateRow, requireWebhookSource, scopeCronToOrg, WEBHOOK_TOLERANCE_SECONDS } from "./auth.ts";
import { isAuthContext } from "./context.ts";
import { AppError } from "./errors.ts";
import {
  makeAuth,
  makeCronAuth,
  makeSourceAuth,
  signWebhook,
  TEST_NOW,
  TEST_ORG,
  TEST_SOURCE,
  TEST_SOURCE_SECRET,
  testWebhookDeps,
  testWebhookSource,
} from "./testing.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const BODY = '{"asset_name":"vpn-paris","severity":"critical"}';

async function req(body = BODY, over: { ts?: string; sig?: string; secret?: string } = {}): Promise<Request> {
  const ts = over.ts ?? String(TEST_NOW);
  return new Request(`https://projet.exemple.test/alerts-ingest/${TEST_SOURCE}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-releve-timestamp": ts,
      "x-releve-signature": over.sig ?? await signWebhook(over.secret ?? TEST_SOURCE_SECRET, ts, body),
    },
    body,
  });
}
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status} ${e.code} ${e.message}` : `autre:${(e as Error).message}`;
  }
  return "aucune erreur";
}

Deno.test("webhook : une livraison bien signée donne un contexte « source » dont l'organisation vient de la base", async () => {
  const deps = testWebhookDeps(testWebhookSource({ severityMap: { DISASTER: "critical" } }));
  const v = await requireWebhookSource(await req(), TEST_SOURCE, enc(BODY), deps);
  assert.ok(isAuthContext(v.auth));
  assert.equal(v.auth.kind, "source");
  assert.equal(v.auth.orgId, TEST_ORG);
  assert.equal(v.auth.sourceId, TEST_SOURCE);
  assert.equal(v.auth.userId, null);
  assert.equal(v.auth.role, null);
  assert.equal(v.auth.frozen, false);
  assert.equal(v.auth.activated, true);
  assert.deepEqual(v.severityMap, { DISASTER: "critical" });
  assert.match(v.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(deps.lookups, [TEST_SOURCE]);
  assert.ok(!JSON.stringify(v).includes(TEST_SOURCE_SECRET), "le secret ne sort jamais de la garde");
});

Deno.test("webhook : signature fausse, corps modifié, autre secret = 401", async () => {
  const unauthorized = "401 unauthorized Authentification requise.";
  assert.equal(await failure(requireWebhookSource(await req(BODY, { sig: "sha256=" + "0".repeat(64) }), TEST_SOURCE, enc(BODY), testWebhookDeps())), unauthorized);
  assert.equal(await failure(requireWebhookSource(await req(), TEST_SOURCE, enc(BODY.replace("critical", "warning")), testWebhookDeps())), unauthorized);
  assert.equal(await failure(requireWebhookSource(await req(BODY, { secret: "un-autre-secret".padEnd(40, "q") }), TEST_SOURCE, enc(BODY), testWebhookDeps())), unauthorized);
});

Deno.test("webhook : source inconnue (ou désactivée, ou suspendue) = MÊME réponse qu'une signature fausse", async () => {
  const unknown = await failure(requireWebhookSource(await req(), TEST_SOURCE, enc(BODY), testWebhookDeps(null)));
  const badSig = await failure(requireWebhookSource(await req(BODY, { sig: "sha256=" + "a".repeat(64) }), TEST_SOURCE, enc(BODY), testWebhookDeps()));
  assert.equal(unknown, badSig);
  assert.equal(unknown, "401 unauthorized Authentification requise.");
});

Deno.test("webhook : un secret trop court rendu par la base est refusé (on ne vérifie pas avec un secret faible)", async () => {
  const short = "court-mais-pas-assez".padEnd(31, "x");
  const deps = testWebhookDeps(testWebhookSource({ secret: short }));
  assert.equal(await failure(requireWebhookSource(await req(BODY, { secret: short }), TEST_SOURCE, enc(BODY), deps)), "401 unauthorized Authentification requise.");
});

Deno.test("webhook : horodatage hors des 5 minutes (passé ou futur), absent ou mal formé = 401, sans interroger la base", async () => {
  for (const ts of [String(TEST_NOW - WEBHOOK_TOLERANCE_SECONDS - 1), String(TEST_NOW + WEBHOOK_TOLERANCE_SECONDS + 1), "", "17e8", "-1800000000", "1800000000.5"]) {
    const deps = testWebhookDeps();
    assert.equal(await failure(requireWebhookSource(await req(BODY, { ts }), TEST_SOURCE, enc(BODY), deps)), "401 unauthorized Authentification requise.", ts);
    assert.equal(deps.lookups.length, 0, `aucune lecture de la base pour ${ts}`);
  }
  // Juste dans la fenêtre : accepté.
  for (const ts of [String(TEST_NOW - WEBHOOK_TOLERANCE_SECONDS), String(TEST_NOW + WEBHOOK_TOLERANCE_SECONDS)]) {
    await requireWebhookSource(await req(BODY, { ts }), TEST_SOURCE, enc(BODY), testWebhookDeps());
  }
});

Deno.test("webhook : en-tête de signature absent ou mal formé, identifiant de source invalide = 401 sans interroger la base", async () => {
  const good = await signWebhook(TEST_SOURCE_SECRET, TEST_NOW, BODY);
  for (const sig of ["", good.slice(7), "sha1=" + good.slice(7), good + "00", "sha256=" + "g".repeat(64)]) {
    const deps = testWebhookDeps();
    assert.equal(await failure(requireWebhookSource(await req(BODY, { sig }), TEST_SOURCE, enc(BODY), deps)), "401 unauthorized Authentification requise.", sig);
    assert.equal(deps.lookups.length, 0);
  }
  for (const id of ["", "pas-un-uuid", "../admin", `${TEST_SOURCE}x`]) {
    const deps = testWebhookDeps();
    assert.equal(await failure(requireWebhookSource(await req(), id, enc(BODY), deps)), "401 unauthorized Authentification requise.", id);
    assert.equal(deps.lookups.length, 0);
  }
});

Deno.test("webhook : la signature porte sur les OCTETS reçus (une marque d'ordre d'octets compte) ; hexadécimal en majuscules accepté", async () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(BODY)]);
  const sigBom = await signWebhook(TEST_SOURCE_SECRET, TEST_NOW, withBom);
  await requireWebhookSource(await req(BODY, { sig: sigBom }), TEST_SOURCE, withBom, testWebhookDeps());
  // Signée sur le texte sans la marque : refusée pour des octets qui la contiennent.
  assert.equal(await failure(requireWebhookSource(await req(), TEST_SOURCE, withBom, testWebhookDeps())), "401 unauthorized Authentification requise.");
  const upper = "sha256=" + (await signWebhook(TEST_SOURCE_SECRET, TEST_NOW, BODY)).slice(7).toUpperCase();
  await requireWebhookSource(await req(BODY, { sig: upper }), TEST_SOURCE, enc(BODY), testWebhookDeps());
});

Deno.test("webhook : l'empreinte de livraison est stable pour une même livraison, différente pour un autre horodatage", async () => {
  const a = await requireWebhookSource(await req(), TEST_SOURCE, enc(BODY), testWebhookDeps());
  const b = await requireWebhookSource(await req(), TEST_SOURCE, enc(BODY), testWebhookDeps());
  const c = await requireWebhookSource(await req(BODY, { ts: String(TEST_NOW - 1) }), TEST_SOURCE, enc(BODY), testWebhookDeps());
  assert.equal(a.digest, b.digest);
  assert.notEqual(a.digest, c.digest);
});

Deno.test("webhook : la base ne répond pas = 503 (rien n'est deviné) ; arrêt d'urgence transmis au contexte", async () => {
  const down = { lookupSource: () => Promise.reject(new Error("panne")), nowSeconds: () => TEST_NOW };
  assert.equal(await failure(requireWebhookSource(await req(), TEST_SOURCE, enc(BODY), down)), "503 service_unavailable Service momentanément indisponible.");
  const frozen = await makeSourceAuth({ frozen: true, activated: false });
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.activated, false);
});

Deno.test("webhook : une organisation rendue par la base qui n'est pas un identifiant valide est refusée", async () => {
  assert.equal(
    await failure(requireWebhookSource(await req(), TEST_SOURCE, enc(BODY), testWebhookDeps(testWebhookSource({ orgId: "pas-un-uuid" })))),
    "401 unauthorized Authentification requise.",
  );
});

Deno.test("tâche planifiée : limitée à UNE organisation dont l'état est relu en base ; jamais à partir d'un autre contexte", async () => {
  const cron = await makeCronAuth();
  const read = (row: OrgStateRow | null) => () => Promise.resolve(row);
  const ctx = await scopeCronToOrg(cron, TEST_ORG, read({ state: "pilot", frozen: true, activated: true }));
  assert.ok(isAuthContext(ctx));
  assert.equal(ctx.kind, "cron");
  assert.equal(ctx.orgId, TEST_ORG);
  assert.equal(ctx.frozen, true);
  assert.equal(await failure(scopeCronToOrg(cron, TEST_ORG, read({ state: "suspended", frozen: false, activated: true }))), "403 forbidden Accès refusé.");
  assert.equal(await failure(scopeCronToOrg(cron, TEST_ORG, read(null))), "403 forbidden Accès refusé.");
  assert.equal(await failure(scopeCronToOrg(cron, "pas-un-uuid", read({ state: "pilot", frozen: false, activated: true }))), "403 forbidden Accès refusé.");
  // Contexte d'utilisateur, de source, déjà limité, ou imitation : refusé.
  assert.equal(await failure(scopeCronToOrg(await makeAuth(), TEST_ORG, read({ state: "pilot", frozen: false, activated: true }))), "403 forbidden Accès refusé.");
  assert.equal(await failure(scopeCronToOrg(await makeSourceAuth(), TEST_ORG, read({ state: "pilot", frozen: false, activated: true }))), "403 forbidden Accès refusé.");
  assert.equal(await failure(scopeCronToOrg(ctx, TEST_ORG, read({ state: "pilot", frozen: false, activated: true }))), "403 forbidden Accès refusé.");
  assert.equal(await failure(scopeCronToOrg({ ...cron } as never, TEST_ORG, read({ state: "pilot", frozen: false, activated: true }))), "403 forbidden Accès refusé.");
  assert.equal(await failure(scopeCronToOrg(cron, TEST_ORG, () => Promise.reject(new Error("panne")))), "503 service_unavailable Service momentanément indisponible.");
});
