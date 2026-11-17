// Jeton d'accès EN MÉMOIRE seulement (jamais localStorage ni sessionStorage : menace M15). Le jeton de rafraîchissement reste dans
// le cookie HttpOnly de la passerelle (server/session.ts), illisible ici. Après un rechargement, la mémoire est vide : on demande
// un nouveau jeton d'accès à la passerelle, qui lit le cookie.
export type SessionKind = "employee" | "staff";

export class SignedOut extends Error {
  constructor() {
    super("Session terminée");
    this.name = "SignedOut";
  }
}

export interface SessionClient {
  /** Jeton d'accès valable au moins une minute ; renouvelé si besoin. Jette SignedOut s'il n'y a plus de session. */
  accessToken(): Promise<string>;
  /** Reprise après un rechargement : vrai si le cookie de la passerelle donne une session. */
  resume(): Promise<boolean>;
  verifyOtp(email: string, code: string): Promise<boolean>;
  signOut(): Promise<void>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function createSessionClient(kind: SessionKind, fetcher: Fetch = fetch, now: () => number = () => Date.now()): SessionClient {
  let current: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<boolean> | null = null;

  const post = (op: string, body: unknown, bearer?: string) =>
    fetcher(`/api/session/${op}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });

  const take = async (res: Response): Promise<boolean> => {
    if (!res.ok) {
      current = null;
      return false;
    }
    const d = (await res.json()) as { accessToken?: unknown; expiresAt?: unknown };
    if (typeof d.accessToken !== "string" || typeof d.expiresAt !== "number") {
      current = null;
      return false;
    }
    current = { token: d.accessToken, expiresAt: d.expiresAt * 1000 };
    return true;
  };

  // Un seul renouvellement à la fois : plusieurs appels simultanés attendent le même (le jeton de rafraîchissement tourne).
  const refresh = (): Promise<boolean> => {
    refreshing ??= post("refresh", { kind })
      .then(take, () => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  return {
    async accessToken() {
      if (current && current.expiresAt - now() > 60_000) return current.token;
      if (await refresh()) return (current as unknown as { token: string }).token;
      throw new SignedOut();
    },
    resume: () => refresh(),
    async verifyOtp(email, code) {
      const res = await post("otp", { email, code });
      if (res.status === 401 || res.status === 400) return false;
      if (!res.ok) throw new Error("Service indisponible");
      return take(res);
    },
    async signOut() {
      const token = current?.token;
      current = null;
      await post("logout", { kind }, token).catch(() => undefined);
    },
  };
}
