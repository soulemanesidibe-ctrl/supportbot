// Connexion du personnel (console, écran ESN, écran administrateur) : UNE session par onglet (le jeton de rafraîchissement tourne
// à chaque usage : deux sessions concurrentes se gêneraient), mot de passe puis second facteur TOTP obligatoire, et nouvelle
// vérification du second facteur (moins de 10 minutes) avant une opération sensible.
import type { StaffAuthApi } from "./console-types.ts";
import { createSessionClient, type SessionClient } from "./session.ts";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
// Réponse JSON de Supabase Auth : chaque champ est relu et converti avant usage.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let shared: SessionClient | undefined;
export function staffSession(fetcher: Fetch = fetch): SessionClient {
  shared ??= createSessionClient("staff", fetcher);
  return shared;
}

/** Revendications du jeton d'accès (lues pour l'affichage seulement : la base et les fonctions les vérifient, pas l'interface). */
export function claimsOf(token: string): { sub?: string; aal?: string; name?: string } {
  try {
    const part = token.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    const meta = (json.user_metadata ?? {}) as Record<string, unknown>;
    return { sub: json.sub, aal: json.aal, name: typeof meta.full_name === "string" ? meta.full_name : undefined };
  } catch {
    return {};
  }
}

export class StaffAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("auth");
    this.status = status;
  }
}

export interface StaffAuth extends StaffAuthApi {
  /** Nouvelle vérification du second facteur dans la session ouverte (opérations sensibles : moins de 10 minutes). */
  stepUp(code: string): Promise<boolean>;
}

export function createStaffAuth(opts: { url: string; publishableKey: string; fetcher: Fetch; session: SessionClient }): StaffAuth {
  const { url, publishableKey: key, fetcher, session } = opts;
  let pendingAccess: string | null = null; // jeton sans second facteur, entre le mot de passe et le code TOTP

  const auth = async (path: string, init: RequestInit & { token: string }) => {
    const res = await fetcher(`${url}/auth/v1/${path}`, {
      ...init,
      headers: { apikey: key, authorization: `Bearer ${init.token}`, "content-type": "application/json" },
    });
    if (!res.ok) throw new StaffAuthError(res.status);
    return (await res.json()) as Row;
  };
  const verifiedTotp = async (token: string): Promise<string | null> => {
    const user = await auth("user", { method: "GET", token });
    const f = ((user.factors ?? []) as Row[]).find((x) => x.factor_type === "totp" && x.status === "verified");
    return f ? String(f.id) : null;
  };
  const mfa = async (token: string, factorId: string, code: string): Promise<boolean> => {
    const res = await fetcher("/api/session/mfa", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ factorId, code }),
    });
    if (!res.ok) return false;
    return await session.resume(); // le cookie personnel porte maintenant une session avec un second facteur frais
  };

  return {
    async resume() {
      if (!(await session.resume())) return false;
      return claimsOf(await session.accessToken()).aal === "aal2";
    },
    async password(email, password) {
      const res = await fetcher("/api/session/password", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return { ok: false };
      const d = (await res.json()) as { accessToken: string };
      pendingAccess = d.accessToken;
      return { ok: true, next: (await verifiedTotp(d.accessToken)) ? "mfa_verify" : "mfa_enroll" };
    },
    async enroll() {
      if (!pendingAccess) throw new StaffAuthError(401);
      const f = await auth("factors", { method: "POST", token: pendingAccess, body: JSON.stringify({ factor_type: "totp", friendly_name: `Relève ${new Date().toISOString().slice(0, 10)}` }) });
      return { factorId: String(f.id), qrSvg: String(f.totp?.qr_code ?? ""), secret: String(f.totp?.secret ?? "") };
    },
    async verify(factorId, code) {
      if (!pendingAccess) return false;
      const id = factorId ?? (await verifiedTotp(pendingAccess));
      if (!id || !(await mfa(pendingAccess, id, code))) return false;
      pendingAccess = null;
      return true;
    },
    async stepUp(code) {
      const token = await session.accessToken();
      const id = await verifiedTotp(token);
      return id ? await mfa(token, id, code) : false;
    },
    async signOut() {
      pendingAccess = null;
      await session.signOut();
    },
  };
}
