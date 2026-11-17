import { describe, expect, it } from "vitest";
import { createSessionClient, SignedOut } from "./session.ts";
import { ApiError, createSupabaseWidgetApi, functionsBase } from "./supabase.ts";

const URL_ = "https://projet.supabase.co";
const ORG = "223e4567-e89b-12d3-a456-426614174000";
type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function server(handlers: Record<string, (body: Record<string, unknown>, init: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetcher = (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, init, body });
    const key = url.startsWith("/api/session/") ? url : `${url.replace(`${URL_}/functions/v1/`, "")}:${String(body.op)}`;
    const h = handlers[key];
    const r = h ? h(body, init) : { status: 404, body: { error: { code: "not_found" } } };
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 }));
  };
  return { calls, fetcher };
}

const token = (n: number) => ({ status: 200, body: { accessToken: `jeton-${n}`, expiresAt: Math.floor(Date.now() / 1000) + 600 } });

describe("session en mémoire", () => {
  it("rien n'est écrit dans le stockage du navigateur ; le jeton vit en mémoire et se renouvelle par la passerelle", async () => {
    let n = 0;
    const s = server({ "/api/session/refresh": () => token(++n) });
    const session = createSessionClient("employee", s.fetcher);
    expect(await session.resume()).toBe(true);
    expect(await session.accessToken()).toBe("jeton-1");
    expect(await session.accessToken()).toBe("jeton-1"); // encore valable : pas de nouvel appel
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.init.credentials).toBe("same-origin");
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it("appels simultanés : UN seul renouvellement (le jeton de rafraîchissement tourne à chaque usage)", async () => {
    let n = 0;
    const s = server({ "/api/session/refresh": () => token(++n) });
    const session = createSessionClient("staff", s.fetcher);
    const all = await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);
    expect(new Set(all).size).toBe(1);
    expect(s.calls.filter((c) => c.url === "/api/session/refresh")).toHaveLength(1);
    expect(s.calls[0]?.body).toEqual({ kind: "staff" });
  });

  it("jeton proche de l'échéance : renouvelé ; plus de session : SignedOut", async () => {
    let clock = 0;
    const s = server({ "/api/session/refresh": () => ({ status: 200, body: { accessToken: "court", expiresAt: 30 } }) });
    const session = createSessionClient("employee", s.fetcher, () => clock);
    await session.accessToken(); // échéance à 30 s : moins d'une minute de marge, renouvelé à chaque appel
    clock = 1;
    await session.accessToken();
    expect(s.calls).toHaveLength(2);
    const gone = createSessionClient("employee", server({ "/api/session/refresh": () => ({ status: 401 }) }).fetcher);
    await expect(gone.accessToken()).rejects.toBeInstanceOf(SignedOut);
  });

  it("code : faux = faux (pas d'erreur) ; passerelle en panne = erreur ; déconnexion avec le jeton courant", async () => {
    const s = server({
      "/api/session/otp": (b) => (b.code === "123456" ? token(7) : { status: 401 }),
      "/api/session/logout": () => ({ status: 200, body: { ok: true } }),
    });
    const session = createSessionClient("employee", s.fetcher);
    expect(await session.verifyOtp("a@b.test", "000000")).toBe(false);
    expect(await session.verifyOtp("a@b.test", "123456")).toBe(true);
    await session.signOut();
    const logout = s.calls.at(-1);
    expect(logout?.body).toEqual({ kind: "employee" });
    expect((logout?.init.headers as Record<string, string>).authorization).toBe("Bearer jeton-7");
    const down = createSessionClient("employee", server({ "/api/session/otp": () => ({ status: 503 }) }).fetcher);
    await expect(down.verifyOtp("a@b.test", "123456")).rejects.toThrow();
  });
});

describe("adaptateur Supabase du widget", () => {
  const ready = () => {
    let n = 0;
    return server({
      "/api/session/refresh": () => token(++n),
      "/api/session/otp": () => token(++n),
      "employee-auth:org": (b) => (b.slug === "client-alpha" ? { body: { name: "Cabinet Alpha", brand: { name: "Cabinet Alpha" } } } : { status: 404, body: { error: { code: "not_found" } } }),
      "employee-auth:link": (b) => (b.slug === "client-alpha" ? { body: { orgId: ORG } } : { status: 403, body: { error: { code: "forbidden" } } }),
      "employee-auth:request_code": () => ({ body: { ok: true } }),
      "chat:context": () => ({ body: { orgName: "Cabinet Alpha", brand: { name: "Cabinet Alpha" }, user: { firstName: "Camille" }, relief: { active: false }, incidents: [], ai: true } }),
      "chat:list": () => ({ body: { requests: [] } }),
      "chat:send": (b) => ({ body: { conversationId: "c1", outcome: b.direct ? "escalated" : "answered", messages: [{ id: "m1", role: "notice", content: "x" }], ai: true } }),
      "chat:rate": () => ({ body: { ok: true } }),
    });
  };

  it("adresse du serveur : seulement un projet Supabase en https", () => {
    expect(functionsBase(URL_)).toBe(`${URL_}/functions/v1`);
    for (const bad of [undefined, "", "http://projet.supabase.co", "https://evil.test", `${URL_}/x`]) expect(() => functionsBase(bad)).toThrow();
  });

  it("avant connexion : organisation publique (inconnue = null), demande de code sans jeton", async () => {
    const s = ready();
    const api = createSupabaseWidgetApi({ url: URL_, fetcher: s.fetcher });
    expect(await api.publicOrg("client-alpha")).toEqual({ name: "Cabinet Alpha", brand: { name: "Cabinet Alpha" } });
    expect(await api.publicOrg("inconnu")).toBeNull();
    await api.requestCode("client-alpha", "a@b.test");
    for (const c of s.calls) expect((c.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(s.calls.every((c) => c.init.credentials === "omit")).toBe(true);
  });

  it("après le code : rattachement, puis chaque appel porte l'organisation obtenue et le jeton en mémoire", async () => {
    const s = ready();
    const api = createSupabaseWidgetApi({ url: URL_, fetcher: s.fetcher });
    await expect(api.context()).rejects.toBeInstanceOf(SignedOut);
    expect(await api.verifyCode("client-alpha", "a@b.test", "123456")).toBe(true);
    const ctx = await api.context();
    expect(ctx.synthetic).toBe(false);
    const chatCall = s.calls.find((c) => c.url.endsWith("/chat"));
    expect(chatCall?.body).toEqual({ orgId: ORG, op: "context" });
    expect((chatCall?.init.headers as Record<string, string>).authorization).toMatch(/^Bearer jeton-/);
    const sent = await api.send(null, "Bonjour", { direct: true });
    expect(sent.outcome).toBe("escalated");
    expect(sent.messages[0]?.at).toBeTruthy();
    expect(s.calls.at(-1)?.body).toMatchObject({ op: "send", conversationId: null, message: "Bonjour", direct: true });
  });

  it("reprise : refusée si la personne n'est pas (ou plus) salariée de CETTE organisation ; déconnexion = plus d'appel possible", async () => {
    const s = ready();
    const api = createSupabaseWidgetApi({ url: URL_, fetcher: s.fetcher });
    expect(await api.resume("client-beta")).toBe(false);
    expect(await api.resume("client-alpha")).toBe(true);
    await api.signOut();
    await expect(api.listRequests()).rejects.toBeInstanceOf(SignedOut);
  });

  it("erreur du serveur : remontée avec son code, jamais avalée", async () => {
    const s = server({ "/api/session/otp": () => token(1), "employee-auth:link": () => ({ body: { orgId: ORG } }), "chat:rate": () => ({ status: 409, body: { error: { code: "conflict" } } }) });
    const api = createSupabaseWidgetApi({ url: URL_, fetcher: s.fetcher });
    await api.verifyCode("client-alpha", "a@b.test", "123456");
    const err = await api.rate("c1", 5).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("conflict");
  });
});
