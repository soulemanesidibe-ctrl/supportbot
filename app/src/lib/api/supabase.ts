// Implémentation de production du widget : fonctions Edge `employee-auth` et `chat` (région UE), jeton d'accès en mémoire
// (session.ts). Le navigateur ne lit JAMAIS la base directement : depuis la migration 16, une session de salarié (sans second
// facteur) n'y voit rien ; la fonction `chat` lit pour lui, bornée à ses demandes.
import { createSessionClient, type SessionClient, SignedOut } from "./session.ts";
import type { ChatMessage, Conversation, EmployeeAuthApi, RequestSummary, SendResult, WidgetApi, WidgetContext } from "./types.ts";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function functionsBase(url: string | undefined): string {
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new Error("Adresse du serveur Relève absente ou invalide (VITE_SUPABASE_URL)");
  return `${url}/functions/v1`;
}

export function createSupabaseWidgetApi(opts: { url?: string; fetcher?: Fetch; session?: SessionClient } = {}): WidgetApi & EmployeeAuthApi {
  const base = functionsBase(opts.url ?? import.meta.env.VITE_SUPABASE_URL);
  const fetcher: Fetch = opts.fetcher ?? fetch;
  const session = opts.session ?? createSessionClient("employee", fetcher);
  let orgId: string | null = null;

  const call = async <T>(fn: "chat" | "employee-auth", body: Record<string, unknown>, token?: string): Promise<T> => {
    const res = await fetcher(`${base}/${fn}`, {
      method: "POST",
      credentials: "omit", // les fonctions lisent un jeton Bearer, jamais un cookie
      cache: "no-store",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: { code?: string } }) | null;
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error");
    return data as T;
  };

  const link = async (slug: string): Promise<boolean> => {
    try {
      const r = await call<{ orgId: string }>("employee-auth", { op: "link", slug }, await session.accessToken());
      orgId = typeof r.orgId === "string" ? r.orgId : null;
      return orgId !== null;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return false;
      throw e;
    }
  };

  const chat = async <T>(body: Record<string, unknown>): Promise<T> => {
    if (orgId === null) throw new SignedOut();
    return await call<T>("chat", { orgId, ...body }, await session.accessToken());
  };

  return {
    async publicOrg(slug) {
      try {
        const r = await call<{ name: string; brand: { name: string; accent?: string } }>("employee-auth", { op: "org", slug });
        return { name: r.name, brand: r.brand };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    async resume(slug) {
      if (!(await session.resume())) return false;
      return await link(slug);
    },
    async requestCode(slug, email) {
      await call("employee-auth", { op: "request_code", slug, email });
    },
    async verifyCode(slug, email, code) {
      if (!(await session.verifyOtp(email, code))) return false;
      return await link(slug);
    },
    async signOut() {
      orgId = null;
      await session.signOut();
    },

    async context(): Promise<WidgetContext> {
      const r = await chat<Omit<WidgetContext, "synthetic">>({ op: "context" });
      return { orgName: r.orgName, brand: r.brand, user: r.user, relief: r.relief, incidents: r.incidents, synthetic: false };
    },
    async listRequests(): Promise<readonly RequestSummary[]> {
      return (await chat<{ requests: RequestSummary[] }>({ op: "list" })).requests;
    },
    async conversation(id): Promise<Conversation> {
      return await chat<Conversation>({ op: "get", conversationId: id });
    },
    async send(conversationId, text, sendOpts): Promise<SendResult> {
      const r = await chat<{ conversationId: string; outcome: SendResult["outcome"]; messages: Array<Omit<ChatMessage, "at">> }>({
        op: "send",
        conversationId,
        message: text,
        direct: sendOpts?.direct === true,
      });
      const at = new Date().toISOString();
      return { conversationId: r.conversationId, outcome: r.outcome, messages: r.messages.map((m) => ({ ...m, at })) };
    },
    async escalate(id) {
      await chat({ op: "escalate", conversationId: id });
    },
    async confirm(id, worked) {
      await chat({ op: "confirm", conversationId: id, worked });
    },
    async rate(id, score) {
      await chat({ op: "rate", conversationId: id, score });
    },
  };
}
