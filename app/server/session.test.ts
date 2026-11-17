// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, headersFile, securityHeaders } from "./headers.ts";
import { createNodeHandler, safePath } from "./node.ts";
import { cookieHeader, COOKIES, createSessionHandler, type SessionEnv } from "./session.ts";

const ORIGIN = "https://releve.exemple.fr";
const ENV: SessionEnv = { SUPABASE_URL: "https://projet.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_cle-de-test" };
const jwt = (n: string) => ["eyJhbGciOiJIUzI1NiJ9", `eyJzdWIiOiIke${n}J9`, "c2lnbmF0dXJlLWZhY3RpY2U"].join(".");
const USER = "123e4567-e89b-12d3-a456-426614174000";
const FACTOR = "223e4567-e89b-12d3-a456-426614174000";
const CHALLENGE = "323e4567-e89b-12d3-a456-426614174000";
const sessionReply = (n: string) => ({ access_token: jwt(n), refresh_token: `rt-${n}-abcdefgh`, expires_at: 1_800_000_600, user: { id: USER } });

type Call = { url: string; init: RequestInit };
function gateway(replies: Record<string, { status: number; body?: unknown }> = {}) {
  const calls: Call[] = [];
  const fetcher = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace(`${ENV.SUPABASE_URL}/auth/v1/`, "");
    const r = replies[path] ?? { status: 404, body: { msg: "inconnu" } };
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status }));
  };
  const h = createSessionHandler(ENV, fetcher);
  const post = (op: string, body: unknown, headers: Record<string, string> = {}) =>
    h(new Request(`${ORIGIN}/api/session/${op}`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify(body),
    }), op);
  return { calls, post, h };
}

describe("passerelle de session", () => {
  it("code du salarié : le jeton de rafraîchissement part SEULEMENT dans un cookie __Host- HttpOnly ; jamais dans la réponse", async () => {
    const g = gateway({ verify: { status: 200, body: sessionReply("a") } });
    const res = await g.post("otp", { email: " Camille@Client.test ", code: "123456" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("rt-a-");
    expect(JSON.parse(text)).toEqual({ accessToken: jwt("a"), expiresAt: 1_800_000_600, userId: USER });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toBe(`__Host-releve-e=rt-a-abcdefgh; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIES.employee.maxAge}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(String(g.calls[0]?.init.body))).toEqual({ type: "email", email: "camille@client.test", token: "123456" });
    expect((g.calls[0]?.init.headers as Record<string, string>).apikey).toBe(ENV.SUPABASE_PUBLISHABLE_KEY);
  });

  it("code faux : 401 « invalid_code », sans cookie et sans le message de Supabase", async () => {
    const g = gateway({ verify: { status: 403, body: { msg: "Token has expired or is invalid for user camille@client.test" } } });
    const res = await g.post("otp", { email: "camille@client.test", code: "000000" });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"error":{"code":"invalid_code"}}');
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("falsification de requête : autre origine, origine absente, appel inter-sites, autre type de corps = refus SANS appel à Supabase", async () => {
    const g = gateway({ verify: { status: 200, body: sessionReply("a") } });
    const body = { email: "camille@client.test", code: "123456" };
    expect((await g.post("otp", body, { origin: "https://evil.test" })).status).toBe(403);
    expect((await g.post("otp", body, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    const noOrigin = await g.h(new Request(`${ORIGIN}/api/session/otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "otp");
    expect(noOrigin.status).toBe(403);
    expect((await g.post("otp", body, { "content-type": "text/plain" })).status).toBe(415);
    const get = await g.h(new Request(`${ORIGIN}/api/session/refresh`, { method: "GET", headers: { origin: ORIGIN } }), "refresh");
    expect(get.status).toBe(405);
    expect(g.calls).toHaveLength(0);
  });

  it("entrées : adresse, code (6 chiffres), facteur ; corps trop gros ; opération inconnue", async () => {
    const g = gateway();
    for (const body of [{ email: "pas-une-adresse", code: "123456" }, { email: "a@b.test", code: "12345" }, { email: "a@b.test", code: "12345a" }, { email: 4, code: "123456" }]) {
      expect((await g.post("otp", body)).status).toBe(400);
    }
    expect((await g.post("otp", { email: "a@b.test", code: "1".repeat(5000) })).status).toBe(413);
    expect((await g.post("mfa", { factorId: "x", code: "123456" }, { authorization: `Bearer ${jwt("a")}` })).status).toBe(400);
    expect((await g.post("supprimer", {})).status).toBe(404);
    expect(g.calls).toHaveLength(0);
  });

  it("configuration absente ou clé SECRÈTE à la place de la publiable : refus (503), aucun appel", async () => {
    for (const env of [{}, { SUPABASE_URL: "https://projet.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_jamais_ici" }, { SUPABASE_URL: "https://evil.test", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }]) {
      let called = 0;
      const h = createSessionHandler(env, () => { called++; return Promise.resolve(new Response("{}")); });
      const res = await h(new Request(`${ORIGIN}/api/session/otp`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: '{"email":"a@b.test","code":"123456"}' }), "otp");
      expect(res.status).toBe(503);
      expect(called).toBe(0);
    }
  });

  it("rafraîchissement : lit le cookie DE SON TYPE seulement, fait tourner le jeton ; refusé = cookie effacé", async () => {
    const g = gateway({ "token?grant_type=refresh_token": { status: 200, body: sessionReply("b") } });
    const res = await g.post("refresh", { kind: "employee" }, { cookie: "autre=1; __Host-releve-e=rt-a-abcdefgh; __Host-releve-s=rt-staff-abcdefgh" });
    expect(res.status).toBe(200);
    expect(JSON.parse(String(g.calls[0]?.init.body))).toEqual({ refresh_token: "rt-a-abcdefgh" });
    expect(res.headers.get("set-cookie")).toContain("__Host-releve-e=rt-b-abcdefgh;");

    const staffOnly = gateway({ "token?grant_type=refresh_token": { status: 200, body: sessionReply("c") } });
    const none = await staffOnly.post("refresh", { kind: "employee" }, { cookie: "__Host-releve-s=rt-staff-abcdefgh" });
    expect(none.status).toBe(401);
    expect(staffOnly.calls).toHaveLength(0);

    const revoked = gateway({ "token?grant_type=refresh_token": { status: 400, body: { msg: "Invalid Refresh Token" } } });
    const r = await revoked.post("refresh", { kind: "staff" }, { cookie: "__Host-releve-s=rt-staff-abcdefgh" });
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBe(cookieHeader("staff", null));
    expect((await g.post("refresh", { kind: "admin" })).status).toBe(400);
  });

  it("cookie mal formé (caractères interdits) : ignoré, jamais transmis à Supabase", async () => {
    const g = gateway();
    const res = await g.post("refresh", { kind: "employee" }, { cookie: "__Host-releve-e=rt\"%0d%0aset-cookie:x" });
    expect(res.status).toBe(401);
    expect(g.calls).toHaveLength(0);
  });

  it("personnel : mot de passe puis second facteur (défi puis vérification avec le jeton d'accès) ; cookie personnel de 12 h", async () => {
    const g = gateway({
      "token?grant_type=password": { status: 200, body: sessionReply("p") },
      [`factors/${FACTOR}/challenge`]: { status: 200, body: { id: CHALLENGE } },
      [`factors/${FACTOR}/verify`]: { status: 200, body: sessionReply("m") },
    });
    const pw = await g.post("password", { email: "tech1@esn.test", password: "un mot de passe" });
    expect(pw.headers.get("set-cookie")).toContain(`__Host-releve-s=rt-p-abcdefgh; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIES.staff.maxAge}`);
    const mfa = await g.post("mfa", { factorId: FACTOR, code: "654321" }, { authorization: `Bearer ${jwt("p")}` });
    expect(mfa.status).toBe(200);
    expect(mfa.headers.get("set-cookie")).toContain("__Host-releve-s=rt-m-abcdefgh;");
    expect(JSON.parse(String(g.calls[2]?.init.body))).toEqual({ challenge_id: CHALLENGE, code: "654321" });
    expect((g.calls[2]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${jwt("p")}`);
    expect((await g.post("mfa", { factorId: FACTOR, code: "654321" })).status).toBe(401);
  });

  it("mauvais mot de passe : 401 générique ; Supabase saturé = 429 ; panne = 503", async () => {
    expect((await gateway({ "token?grant_type=password": { status: 400 } }).post("password", { email: "a@b.test", password: "x" })).status).toBe(401);
    expect((await gateway({ verify: { status: 429 } }).post("otp", { email: "a@b.test", code: "123456" })).status).toBe(429);
    expect((await gateway({ verify: { status: 502 } }).post("otp", { email: "a@b.test", code: "123456" })).status).toBe(503);
    const odd = await gateway({ verify: { status: 200, body: { access_token: "pas-un-jwt", refresh_token: "x", user: {} } } }).post("otp", { email: "a@b.test", code: "123456" });
    expect(odd.status).toBe(503);
    expect(odd.headers.get("set-cookie")).toBeNull();
  });

  it("déconnexion : révoque côté Supabase avec le jeton d'accès, efface le cookie même sans jeton", async () => {
    const g = gateway({ "logout?scope=local": { status: 204 } });
    const res = await g.post("logout", { kind: "employee" }, { authorization: `Bearer ${jwt("a")}` });
    expect(res.headers.get("set-cookie")).toBe(cookieHeader("employee", null));
    expect(g.calls[0]?.url).toBe(`${ENV.SUPABASE_URL}/auth/v1/logout?scope=local`);
    const blind = gateway();
    expect((await blind.post("logout", { kind: "staff" })).headers.get("set-cookie")).toBe(cookieHeader("staff", null));
    expect(blind.calls).toHaveLength(0);
  });
});

describe("en-têtes de sécurité", () => {
  it("politique stricte : aucun script extérieur ni en ligne, aucun cadre, connexions limitées ; projet invalide ignoré", () => {
    const csp = contentSecurityPolicy("https://projet.supabase.co");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toMatch(/unsafe-eval|\*/);
    // Une seule exception « unsafe-inline » : les éléments <style> (dialogue accessible), jamais les scripts ni les attributs.
    expect(csp.split("; ").filter((d) => d.includes("unsafe-inline"))).toEqual(["style-src-elem 'self' 'unsafe-inline'"]);
    expect(csp).toContain("style-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' https://projet.supabase.co wss://projet.supabase.co https://login.microsoftonline.com");
    expect(contentSecurityPolicy("https://evil.test; script-src *")).not.toContain("evil");
    const h = securityHeaders(undefined);
    expect(h["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(headersFile(undefined)).toMatch(/^\/\*\n {2}Content-Security-Policy: /);
  });
});

describe("serveur Node", () => {
  it("chemins : jamais en dehors du dossier servi", () => {
    const root = "/srv/dist";
    expect(safePath(root, "/assets/app.js")).toBe("/srv/dist/assets/app.js");
    for (const evil of ["/../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/assets/../../etc/passwd", "/%00", "/%E0%A4%A"]) {
      const p = safePath(root, evil);
      expect(p === null || p.startsWith("/srv/dist/") || p === "/srv/dist").toBe(true);
    }
    expect(safePath(root, "/%2e%2e/secret")).toBeNull();
  });

  it("la passerelle derrière Node : l'origine vient de la configuration, pas de l'en-tête Host", async () => {
    const handler = createNodeHandler({ root: "/inexistant", publicOrigin: ORIGIN, env: ENV, fetcher: () => Promise.resolve(new Response("{}", { status: 400 })) });
    const out: { status?: number; headers?: Record<string, string>; body?: string } = {};
    const res = {
      writeHead(s: number, h: Record<string, string>) { out.status = s; out.headers = h; },
      end(b?: Buffer | string) { out.body = b ? String(b) : ""; },
    };
    async function* chunks() { yield Buffer.from('{"email":"a@b.test","code":"123456"}'); }
    const req = Object.assign(chunks(), { url: "/api/session/otp", method: "POST", headers: { host: "evil.test", origin: "https://evil.test", "content-type": "application/json" } });
    await handler(req as never, res as never);
    expect(out.status).toBe(403);
    expect(out.headers?.["Content-Security-Policy"]).toContain("default-src 'none'");
  });
});
