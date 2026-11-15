import assert from "node:assert/strict";
import { AccessRow, AuthDeps, lastMfaAt, requestIdFrom, requireCronSecret, requireOrgMember, requireRecentMfa, requireUser } from "./auth.ts";
import { assertActivated, assertCanWrite, assertNotFrozen, isAuthContext } from "./context.ts";
import { AppError } from "./errors.ts";

const USER = "123e4567-e89b-12d3-a456-426614174000";
const ORG = "223e4567-e89b-12d3-a456-426614174000";
const JWT = "aaaaaaaa.bbbbbbbb.cccccccc";
const NOW = 1_800_000_000;

function req(headers: Record<string, string> = { authorization: `Bearer ${JWT}` }, url = "https://exemple.test/chat") {
  return new Request(url, { headers });
}
function access(over: Partial<AccessRow> = {}): AccessRow {
  return { org_role: "partner_technician", via: "partner", org_type: "client", org_state: "pilot", is_frozen: false, is_activated: true, read_only: false, ...over };
}
function deps(over: Partial<AuthDeps> = {}): AuthDeps {
  return {
    verifyToken: () => Promise.resolve({ userId: USER, aal: "aal2", amr: [{ method: "totp", timestamp: NOW - 30 }] }),
    resolveAccess: () => Promise.resolve(access()),
    cronSecret: () => "s".repeat(40),
    nowSeconds: () => NOW,
    ...over,
  };
}
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("requireUser : sans jeton, jeton mal formé, ou jeton dans l'URL = 401", async () => {
  assert.equal(await code(requireUser(req({}), deps())), "unauthorized");
  assert.equal(await code(requireUser(req({ authorization: "Bearer pas-un-jwt" }), deps())), "unauthorized");
  assert.equal(await code(requireUser(req({ authorization: `Basic ${JWT}` }), deps())), "unauthorized");
  assert.equal(await code(requireUser(req({}, `https://exemple.test/chat?access_token=${JWT}`), deps())), "unauthorized");
});

Deno.test("requireUser : un jeton refusé par le serveur d'authentification donne une 401 qui ne dit pas pourquoi", async () => {
  const d = deps({ verifyToken: () => Promise.reject(new Error("session révoquée pour u@exemple.test")) });
  try { await requireUser(req(), d); assert.fail("devait refuser"); } catch (e) {
    assert.ok(e instanceof AppError);
    assert.equal(e.status, 401);
    assert.ok(!e.message.includes("révoquée") && !e.message.includes("exemple.test"));
  }
});

Deno.test("requireUser : renvoie un AuthContext authentique, sans organisation ni rôle", async () => {
  const ctx = await requireUser(req(), deps());
  assert.ok(isAuthContext(ctx));
  assert.equal(ctx.kind, "user");
  assert.equal(ctx.userId, USER);
  assert.equal(ctx.orgId, null);
  assert.equal(ctx.role, null);
});

Deno.test("AuthContext : ni un littéral, ni une copie, ni un JSON ne passent pour authentiques", async () => {
  const real = await requireUser(req(), deps());
  assert.ok(!isAuthContext({ ...real }));
  assert.ok(!isAuthContext(JSON.parse(JSON.stringify(real))));
  assert.ok(!isAuthContext({ kind: "user", userId: USER, orgId: ORG, role: "org_admin" }));
  assert.ok(Object.isFrozen(real));
  assert.throws(() => { (real as unknown as { role: string }).role = "super_admin"; }, TypeError);
});

Deno.test("lastMfaAt : seul le second facteur compte, pas un mot de passe plus récent", () => {
  assert.equal(lastMfaAt([{ method: "password", timestamp: NOW }, { method: "totp", timestamp: NOW - 100 }]), NOW - 100);
  assert.equal(lastMfaAt([{ method: "password", timestamp: NOW }]), null);
  assert.equal(lastMfaAt([{ method: "totp", timestamp: "maintenant" }, { method: 42, timestamp: NOW }]), null);
  assert.equal(lastMfaAt([{ method: "totp", timestamp: NOW - 500 }, { method: "totp", timestamp: NOW - 20 }]), NOW - 20);
  assert.equal(lastMfaAt(undefined as never), null);
});

Deno.test("requireOrgMember : organisation invalide = 400, aucun droit = 403, base muette = 503", async () => {
  assert.equal(await code(requireOrgMember(req(), "pas-un-uuid", undefined, deps())), "bad_request");
  assert.equal(await code(requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.resolve(null) }))), "forbidden");
  assert.equal(await code(requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.reject(new Error("db down")) }))), "service_unavailable");
});

Deno.test("requireOrgMember : le refus est le même qu'on soit inconnu ou sans droit (pas d'énumération)", async () => {
  const a = await requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.resolve(null) })).catch((e) => e);
  assert.equal(a.status, 403);
  assert.equal(a.message, "Accès refusé.");
});

Deno.test("requireOrgMember : l'identité demandée à la base est celle du JETON, jamais celle d'un en-tête ou d'un paramètre", async () => {
  let asked: [string, string] | null = null;
  const d = deps({ resolveAccess: (u, o) => { asked = [u, o]; return Promise.resolve(access()); } });
  await requireOrgMember(req({ authorization: `Bearer ${JWT}`, "x-user-id": "autre", "x-org-id": "autre" }), ORG, undefined, d);
  assert.deepEqual(asked, [USER, ORG]);
});

Deno.test("requireOrgMember : une réponse inattendue de la base est refusée (échec fermé)", async () => {
  for (const bad of [access({ org_role: "root" }), access({ via: "magie" }), access({ org_role: "" })]) {
    assert.equal(await code(requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.resolve(bad) }))), "forbidden");
  }
});

Deno.test("requireOrgMember : la liste de rôles autorisés est appliquée", async () => {
  assert.equal(await code(requireOrgMember(req(), ORG, ["org_admin"], deps())), "forbidden");
  const ctx = await requireOrgMember(req(), ORG, ["org_admin", "partner_technician"], deps());
  assert.equal(ctx.role, "partner_technician");
  assert.equal(ctx.via, "partner");
  assert.equal(ctx.orgId, ORG);
  assert.ok(isAuthContext(ctx));
});

Deno.test("requireOrgMember : accès d'assistance = lecture seule ; organisation gelée et client non activé sont signalés", async () => {
  const support = await requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.resolve(access({ org_role: "super_admin", via: "support_access", read_only: true })) }));
  assert.equal(support.readOnly, true);
  assert.throws(() => assertCanWrite(support), (e: unknown) => (e as AppError).code === "read_only");

  const frozen = await requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.resolve(access({ is_frozen: true })) }));
  assert.throws(() => assertCanWrite(frozen), (e: unknown) => (e as AppError).code === "org_frozen");
  assert.throws(() => assertNotFrozen(frozen), (e: unknown) => (e as AppError).code === "org_frozen");

  const inactive = await requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.resolve(access({ is_activated: false })) }));
  assert.throws(() => assertActivated(inactive), (e: unknown) => (e as AppError).code === "not_activated");
});

Deno.test("requireOrgMember : même un champ read_only absent n'ouvre pas l'écriture à un accès d'assistance", async () => {
  const ctx = await requireOrgMember(req(), ORG, undefined, deps({ resolveAccess: () => Promise.resolve(access({ via: "support_access", read_only: false, org_role: "platform_support" })) }));
  assert.equal(ctx.readOnly, true);
});

Deno.test("requireRecentMfa : refuse aal1, un second facteur trop ancien ou venu du futur ; accepte un récent", async () => {
  const mk = (aal: "aal1" | "aal2", mfaAgo: number | null) =>
    requireOrgMember(req(), ORG, undefined, deps({
      verifyToken: () => Promise.resolve({ userId: USER, aal, amr: mfaAgo === null ? [] : [{ method: "totp", timestamp: NOW - mfaAgo }] }),
    }));
  const d = { nowSeconds: () => NOW };
  const verdict = async (ctx: ReturnType<typeof mk>, max: number): Promise<string> => {
    try { requireRecentMfa(await ctx, max, d); } catch (e) { return (e as AppError).code; }
    return "accepté";
  };
  assert.equal(await verdict(mk("aal1", 10), 600), "mfa_required", "aal1 même avec un horodatage récent");
  assert.equal(await verdict(mk("aal2", 100), 600), "accepté");
  assert.equal(await verdict(mk("aal2", 100), 50), "mfa_required", "limite plus stricte que l'âge");
  assert.equal(await verdict(mk("aal2", 700), 600), "mfa_required", "second facteur trop ancien");
  assert.equal(await verdict(mk("aal2", -3600), 600), "mfa_required", "horodatage dans le futur");
  assert.equal(await verdict(mk("aal2", null), 600), "mfa_required", "aucun second facteur dans amr");
  const ok = await mk("aal2", 100);
  assert.equal(requireRecentMfa(ok, 600, d), ok, "renvoie le même contexte");
});

Deno.test("requireCronSecret : sans secret configuré, trop court, absent ou faux = refus ; le bon secret passe", async () => {
  const good = "s".repeat(40);
  const withSecret = (v: string | undefined) => deps({ cronSecret: () => v });
  assert.equal(await code(requireCronSecret(req({ "x-cron-secret": good }), withSecret(undefined))), "unauthorized");
  assert.equal(await code(requireCronSecret(req({ "x-cron-secret": "court" }), withSecret("court"))), "unauthorized");
  assert.equal(await code(requireCronSecret(req({}), withSecret(good))), "unauthorized");
  assert.equal(await code(requireCronSecret(req({ "x-cron-secret": "x".repeat(40) }), withSecret(good))), "unauthorized");
  const ctx = await requireCronSecret(req({ "x-cron-secret": good }), withSecret(good));
  assert.equal(ctx.kind, "cron");
  assert.equal(ctx.userId, null);
  assert.equal(ctx.orgId, null);
  assert.ok(isAuthContext(ctx));
});

Deno.test("requestIdFrom : un identifiant inoffensif est repris, un identifiant dangereux est remplacé", () => {
  assert.equal(requestIdFrom(req({ "x-request-id": "req-abc_12345" })), "req-abc_12345");
  const injected = requestIdFrom(req({ "x-request-id": "ok\"},\"level\":\"info" }));
  assert.match(injected, /^[0-9a-f-]{36}$/);
  assert.match(requestIdFrom(req({ "x-request-id": "a".repeat(200) })), /^[0-9a-f-]{36}$/);
  assert.match(requestIdFrom(req({})), /^[0-9a-f-]{36}$/);
});
