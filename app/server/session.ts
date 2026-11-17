// Passerelle de session (docs/spec-mvp.md § 5.3, menace M15). Même origine que les écrans. Elle seule voit le jeton de
// RAFRAÎCHISSEMENT, qu'elle garde dans un cookie `__Host-` HttpOnly, Secure, SameSite=Lax : il n'est jamais lisible par du
// JavaScript ni stocké dans le navigateur. Le jeton d'ACCÈS (10 minutes) est rendu au navigateur, qui le garde en mémoire.
//
// Écrite en API web standard (Request -> Response) : la même fonction tourne en fonction Cloudflare Pages (functions/) ou
// derrière le petit serveur Node (server/node.ts) d'un hébergeur français, au choix du déploiement.
//
// Opérations (POST /api/session/<op>, JSON) :
//   otp       {email, code}        salarié : vérifie le code reçu par e-mail          -> cookie salarié (7 jours)
//   password  {email, password}    personnel : premier facteur                       -> cookie personnel (12 heures)
//   mfa       {factorId, code}     personnel : second facteur (jeton d'accès requis)  -> remplace le cookie personnel
//   refresh   {kind}               nouveau jeton d'accès depuis le cookie (rotation du jeton de rafraîchissement)
//   logout    {kind}               révoque la session côté Supabase et efface le cookie
// Défenses : POST seulement, en-tête Origin ÉGAL à l'origine de la passerelle, corps JSON borné, cookies distincts pour le salarié
// et pour le personnel (une session du widget n'ouvre jamais la console), réponses jamais mises en cache, aucun message d'erreur de
// Supabase renvoyé tel quel.

export interface SessionEnv {
  /** https://<projet>.supabase.co */
  readonly SUPABASE_URL?: string;
  /** Clé PUBLIABLE (sb_publishable_...) : elle n'ouvre rien sans jeton d'utilisateur. Jamais la clé secrète ici. */
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
}

export type SessionKind = "employee" | "staff";

export const COOKIES: Record<SessionKind, { name: string; maxAge: number }> = {
  employee: { name: "__Host-releve-e", maxAge: 7 * 24 * 3600 },
  staff: { name: "__Host-releve-s", maxAge: 12 * 3600 },
};

const MAX_BODY = 4_096;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const CODE = /^[0-9]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{4,2048}\.[A-Za-z0-9_-]{4,2048}\.[A-Za-z0-9_-]{4,2048}$/;
const REFRESH = /^[A-Za-z0-9_.-]{8,512}$/;
const SUPABASE_HOST = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

class Refusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(status: number, body: unknown, setCookie?: string): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export function cookieHeader(kind: SessionKind, value: string | null): string {
  const c = COOKIES[kind];
  return value === null
    ? `${c.name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    : `${c.name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${c.maxAge}`;
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return REFRESH.test(v) ? v : null;
    }
  }
  return null;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new Refusal(415, "bad_request");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Refusal(413, "bad_request");
  try {
    const v: unknown = JSON.parse(text || "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("forme");
    return v as Record<string, unknown>;
  } catch {
    throw new Refusal(400, "bad_request");
  }
}

function kindOf(v: unknown): SessionKind {
  if (v === "employee" || v === "staff") return v;
  throw new Refusal(400, "bad_request");
}

interface Tokens { accessToken: string; refreshToken: string; expiresAt: number; userId: string }

function tokensOf(data: unknown): Tokens {
  const d = (data ?? {}) as Record<string, unknown>;
  const user = (d.user ?? {}) as Record<string, unknown>;
  const at = d.access_token, rt = d.refresh_token, exp = d.expires_at, uid = user.id;
  if (typeof at !== "string" || !JWT.test(at) || typeof rt !== "string" || !REFRESH.test(rt) || typeof uid !== "string" || !UUID.test(uid)) {
    throw new Refusal(503, "unavailable"); // réponse inattendue : on ne devine pas
  }
  const expiresAt = typeof exp === "number" && Number.isFinite(exp) ? exp : Math.floor(Date.now() / 1000) + 600;
  return { accessToken: at, refreshToken: rt, expiresAt, userId: uid };
}

/** Réponse au navigateur : jeton d'accès et échéance ; le jeton de rafraîchissement ne part QUE dans le cookie. */
function session(kind: SessionKind, t: Tokens): Response {
  return json(200, { accessToken: t.accessToken, expiresAt: t.expiresAt, userId: t.userId }, cookieHeader(kind, t.refreshToken));
}

export function createSessionHandler(env: SessionEnv, fetcher: Fetch = fetch): (req: Request, op: string) => Promise<Response> {
  return async (req: Request, op: string): Promise<Response> => {
    try {
      if (req.method !== "POST") throw new Refusal(405, "method_not_allowed");
      // Contre la falsification de requête : seule une page de CETTE origine peut appeler (en plus de SameSite=Lax).
      const self = new URL(req.url).origin;
      if (req.headers.get("origin") !== self) throw new Refusal(403, "forbidden");
      const site = req.headers.get("sec-fetch-site");
      if (site !== null && site !== "same-origin") throw new Refusal(403, "forbidden");
      const base = env.SUPABASE_URL ?? "";
      const key = env.SUPABASE_PUBLISHABLE_KEY ?? "";
      if (!SUPABASE_HOST.test(base) || !key.startsWith("sb_publishable_")) throw new Refusal(503, "unavailable");
      const body = await readBody(req);

      const auth = async (path: string, payload: unknown, bearer?: string): Promise<{ status: number; data: unknown }> => {
        let res: Response;
        try {
          res = await fetcher(`${base}/auth/v1/${path}`, {
            method: "POST",
            headers: { apikey: key, "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
            body: JSON.stringify(payload),
            redirect: "error",
          });
        } catch {
          throw new Refusal(503, "unavailable");
        }
        if (res.status === 429) throw new Refusal(429, "rate_limited");
        if (res.status >= 500) throw new Refusal(503, "unavailable");
        const data: unknown = await res.json().catch(() => null);
        return { status: res.status, data };
      };
      const bearerOf = (): string => {
        const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
        if (!m || !JWT.test(m[1] as string)) throw new Refusal(401, "no_session");
        return m[1] as string;
      };

      switch (op) {
        case "otp": {
          const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          const code = typeof body.code === "string" ? body.code.trim() : "";
          if (!EMAIL.test(email) || !CODE.test(code)) throw new Refusal(400, "bad_request");
          const r = await auth("verify", { type: "email", email, token: code });
          if (r.status !== 200) throw new Refusal(401, "invalid_code");
          return session("employee", tokensOf(r.data));
        }
        case "password": {
          const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          const password = typeof body.password === "string" ? body.password : "";
          if (!EMAIL.test(email) || password.length < 1 || password.length > 256) throw new Refusal(400, "bad_request");
          const r = await auth("token?grant_type=password", { email, password });
          if (r.status !== 200) throw new Refusal(401, "invalid_credentials");
          return session("staff", tokensOf(r.data));
        }
        case "mfa": {
          const factorId = typeof body.factorId === "string" ? body.factorId : "";
          const code = typeof body.code === "string" ? body.code.trim() : "";
          if (!UUID.test(factorId) || !CODE.test(code)) throw new Refusal(400, "bad_request");
          const access = bearerOf();
          const ch = await auth(`factors/${factorId}/challenge`, {}, access);
          const challengeId = (ch.data as Record<string, unknown> | null)?.id;
          if (ch.status !== 200 || typeof challengeId !== "string" || !UUID.test(challengeId)) throw new Refusal(401, "mfa_invalid");
          const r = await auth(`factors/${factorId}/verify`, { challenge_id: challengeId, code }, access);
          if (r.status !== 200) throw new Refusal(401, "mfa_invalid");
          return session("staff", tokensOf(r.data));
        }
        case "refresh": {
          const kind = kindOf(body.kind);
          const current = readCookie(req, COOKIES[kind].name);
          if (!current) throw new Refusal(401, "no_session");
          const r = await auth("token?grant_type=refresh_token", { refresh_token: current });
          if (r.status !== 200) return json(401, { error: { code: "no_session" } }, cookieHeader(kind, null));
          return session(kind, tokensOf(r.data));
        }
        case "logout": {
          const kind = kindOf(body.kind);
          // Révocation côté Supabase avec le jeton d'accès s'il est fourni ; le cookie est effacé dans tous les cas.
          const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
          if (m && JWT.test(m[1] as string)) {
            try { await auth("logout?scope=local", {}, m[1]); } catch { /* le cookie part quand même */ }
          }
          return json(200, { ok: true }, cookieHeader(kind, null));
        }
        default:
          throw new Refusal(404, "not_found");
      }
    } catch (e) {
      if (e instanceof Refusal) return json(e.status, { error: { code: e.code } });
      return json(500, { error: { code: "internal" } });
    }
  };
}
