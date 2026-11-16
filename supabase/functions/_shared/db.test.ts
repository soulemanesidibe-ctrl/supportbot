import assert from "node:assert/strict";
import { AuthDeps, requireCronSecret, requireOrgMember, requireUser } from "./auth.ts";
import { acceptInvitationRpc, createAccessResolver, DbDeps, pickKey, rateLimitRpc, serviceClient } from "./db.ts";
import { AppError } from "./errors.ts";

const USER = "123e4567-e89b-12d3-a456-426614174000";
const ORG = "223e4567-e89b-12d3-a456-426614174000";
const JWT = "aaaaaaaa.bbbbbbbb.cccccccc";

const authDeps: AuthDeps = {
  verifyToken: () => Promise.resolve({ userId: USER, aal: "aal2", amr: [] }),
  resolveAccess: () =>
    Promise.resolve({ org_role: "partner_technician", via: "partner", org_type: "client", org_state: "pilot", is_frozen: false, is_activated: true, read_only: false }),
  cronSecret: () => "s".repeat(40),
  nowSeconds: () => 1_800_000_000,
};
const req = (h: Record<string, string> = { authorization: `Bearer ${JWT}` }) => new Request("https://exemple.test/x", { headers: h });

interface Captured { url: string; key: string; opts: { auth: Record<string, unknown>; global: { headers: Record<string, string> } } }
function fakeDeps(over: Partial<DbDeps> = {}): { deps: DbDeps; calls: Captured[]; rpcs: Array<{ fn: string; args: unknown }> } {
  const calls: Captured[] = [];
  const rpcs: Array<{ fn: string; args: unknown }> = [];
  const deps: DbDeps = {
    createClient: ((url: string, key: string, opts: Captured["opts"]) => {
      calls.push({ url, key, opts });
      return { rpc: (fn: string, args: unknown) => { rpcs.push({ fn, args }); return Promise.resolve({ data: [{ org_role: "org_admin" }], error: null }); } };
    }) as unknown as DbDeps["createClient"],
    url: () => "https://projet.exemple.test",
    serviceKey: () => "cle-de-service-factice",
    ...over,
  };
  return { deps, calls, rpcs };
}
function codeOf(f: () => unknown): string {
  try { f(); } catch (e) { return e instanceof AppError ? e.code : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("serviceClient : un faux AuthContext (littéral, copie, JSON, null) est refusé", async () => {
  const { deps } = fakeDeps();
  const real = await requireOrgMember(req(), ORG, undefined, authDeps);
  const forged = [
    { kind: "user", userId: USER, orgId: ORG, role: "org_admin", via: "member", readOnly: false, frozen: false, activated: true, aal: "aal2", mfaAt: 1, requestId: "req-12345678" },
    { ...real },
    JSON.parse(JSON.stringify(real)),
    null,
    undefined,
    "super_admin",
  ];
  for (const f of forged) assert.equal(codeOf(() => serviceClient(f as never, deps)), "forbidden", JSON.stringify(f)?.slice(0, 40));
});

Deno.test("serviceClient : un utilisateur sans organisation (requireUser seul) n'obtient PAS la clé de service", async () => {
  const { deps, calls } = fakeDeps();
  const bare = await requireUser(req(), authDeps);
  assert.equal(codeOf(() => serviceClient(bare, deps)), "forbidden");
  assert.equal(calls.length, 0, "aucun client créé");
});

Deno.test("serviceClient : un utilisateur de l'organisation obtient un client qui porte l'acteur, l'organisation et la requête", async () => {
  const { deps, calls } = fakeDeps();
  const ctx = await requireOrgMember(req(), ORG, undefined, authDeps);
  serviceClient(ctx, deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://projet.exemple.test");
  assert.equal(calls[0].key, "cle-de-service-factice");
  assert.deepEqual(calls[0].opts.global.headers, { "x-releve-request-id": ctx.requestId, "x-releve-actor": USER, "x-releve-org": ORG });
  assert.equal(calls[0].opts.auth.persistSession, false);
  assert.equal(calls[0].opts.auth.autoRefreshToken, false);
});

Deno.test("serviceClient : une tâche planifiée authentique agit sans organisation et sans acteur", async () => {
  const { deps, calls } = fakeDeps();
  const cron = await requireCronSecret(req({ "x-cron-secret": "s".repeat(40) }), authDeps);
  serviceClient(cron, deps);
  assert.deepEqual(Object.keys(calls[0].opts.global.headers), ["x-releve-request-id"]);
});

Deno.test("serviceClient : sans URL ou sans clé configurée = indisponible, jamais un client sans clé", async () => {
  const ctx = await requireOrgMember(req(), ORG, undefined, authDeps);
  assert.equal(codeOf(() => serviceClient(ctx, fakeDeps({ serviceKey: () => undefined }).deps)), "service_unavailable");
  assert.equal(codeOf(() => serviceClient(ctx, fakeDeps({ url: () => "" }).deps)), "service_unavailable");
});

Deno.test("createAccessResolver : appelle resolve_access avec l'utilisateur et l'organisation, renvoie la première ligne ou null", async () => {
  const { deps, rpcs } = fakeDeps();
  const row = await createAccessResolver(deps)(USER, ORG);
  assert.deepEqual(rpcs, [{ fn: "resolve_access", args: { p_user: USER, p_org: ORG } }]);
  assert.equal(row?.org_role, "org_admin");

  const empty = fakeDeps({ createClient: (() => ({ rpc: () => Promise.resolve({ data: [], error: null }) })) as never });
  assert.equal(await createAccessResolver(empty.deps)(USER, ORG), null);
});

Deno.test("createAccessResolver : une erreur de la base est une indisponibilité, jamais un accès accordé", async () => {
  const broken = fakeDeps({ createClient: (() => ({ rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) })) as never });
  await assert.rejects(createAccessResolver(broken.deps)(USER, ORG), (e: unknown) => (e as AppError).code === "service_unavailable");
});

Deno.test("pickKey : la nouvelle clé nommée d'abord, l'ancienne en repli, jamais une valeur inventée", () => {
  assert.equal(pickKey('{"default":"sb_secret_nouvelle","autre":"x"}', "ancienne"), "sb_secret_nouvelle");
  assert.equal(pickKey('{"default":"sb_secret_nouvelle","billing":"b"}', undefined, "billing"), "b");
  assert.equal(pickKey(undefined, "ancienne"), "ancienne");
  assert.equal(pickKey("pas du json", "ancienne"), "ancienne", "dictionnaire illisible : repli");
  assert.equal(pickKey('{"autre":"x"}', "ancienne"), "ancienne", "nom absent : repli");
  assert.equal(pickKey('{"default":42}', undefined), undefined, "valeur non textuelle : rien");
  assert.equal(pickKey('["a"]', undefined), undefined);
  assert.equal(pickKey(undefined, undefined), undefined);
  assert.equal(pickKey("", ""), undefined);
});

Deno.test("acceptInvitationRpc : seule une personne authentifiée SANS organisation l'obtient ; un membre, une tâche ou un faux contexte sont refusés", async () => {
  const bare = await requireUser(req(), authDeps);
  const member = await requireOrgMember(req(), ORG, undefined, authDeps);
  const cron = await requireCronSecret(req({ "x-cron-secret": "s".repeat(40) }), authDeps);
  for (const [label, ctx] of [["membre", member], ["tâche planifiée", cron], ["objet fabriqué", { ...bare }], ["null", null], ["chaîne", USER]] as const) {
    const { deps, calls } = fakeDeps();
    let code = "aucune erreur";
    try { await acceptInvitationRpc(ctx as never, { email: "a@b.test", tokenHash: "h".repeat(64) }, deps); } catch (e) { code = e instanceof AppError ? e.code : "autre"; }
    assert.equal(code, "forbidden", label);
    assert.equal(calls.length, 0, `${label} : aucun client créé`);
  }
});

Deno.test("acceptInvitationRpc : n'appelle QUE la fonction d'acceptation, avec l'identifiant de la personne posé par le code (jamais par l'appelant)", async () => {
  const { deps, calls, rpcs } = fakeDeps();
  const bare = await requireUser(req(), authDeps);
  await acceptInvitationRpc(bare, { email: "a@b.test", tokenHash: "h".repeat(64), ...{ p_user: "00000000-0000-4000-8000-000000000000" } } as never, deps);
  assert.deepEqual(rpcs, [{ fn: "admin_accept_invitation", args: { p_user: USER, p_email: "a@b.test", p_token_hash: "h".repeat(64) } }]);
  assert.deepEqual(calls[0].opts.global.headers, { "x-releve-request-id": bare.requestId, "x-releve-actor": USER });
});

Deno.test("rateLimitRpc : réservée à une PERSONNE authentifiée (avec ou sans organisation) ; n'appelle que rate_limit_hit", async () => {
  const bare = await requireUser(req(), authDeps);
  const member = await requireOrgMember(req(), ORG, undefined, authDeps);
  const cron = await requireCronSecret(req({ "x-cron-secret": "s".repeat(40) }), authDeps);
  for (const [label, ctx] of [["tâche planifiée", cron], ["objet fabriqué", { ...bare }], ["null", null]] as const) {
    const { deps, calls } = fakeDeps();
    let code = "aucune erreur";
    try { await rateLimitRpc(ctx as never, { key: "chat:u:x", windowSeconds: 60, limit: 12 }, deps); } catch (e) { code = e instanceof AppError ? e.code : "autre"; }
    assert.equal(code, "forbidden", label);
    assert.equal(calls.length, 0, `${label} : aucun client créé`);
  }
  const a = fakeDeps();
  await rateLimitRpc(bare, { key: "admin:u:x", windowSeconds: 60, limit: 30 }, a.deps);
  assert.deepEqual(a.rpcs, [{ fn: "rate_limit_hit", args: { p_key: "admin:u:x", p_window_seconds: 60, p_limit: 30 } }]);
  assert.deepEqual(a.calls[0].opts.global.headers, { "x-releve-request-id": bare.requestId, "x-releve-actor": USER });
  const b = fakeDeps();
  await rateLimitRpc(member, { key: "chat:o:y", windowSeconds: 60, limit: 120 }, b.deps);
  assert.deepEqual(b.calls[0].opts.global.headers, { "x-releve-request-id": member.requestId, "x-releve-actor": USER, "x-releve-org": ORG });
});
