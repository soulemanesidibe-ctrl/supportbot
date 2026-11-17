import { describe, expect, it, vi } from "vitest";
import type { SessionClient } from "./session.ts";

vi.mock("./microsoft.ts", () => ({ microsoftToken: vi.fn().mockResolvedValue("jeton-microsoft-delegue") }));
const { createSupabaseConsoleApi, claimsOf } = await import("./console-supabase.ts");
const { microsoftToken } = await import("./microsoft.ts");

const URL_ = "https://projet.supabase.co";
const KEY = "sb_publishable_test";
const ME = "123e4567-e89b-12d3-a456-426614174000";
const ORG = "223e4567-e89b-12d3-a456-426614174000";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const token = (claims: Record<string, unknown>) => `${b64({ alg: "HS256" })}.${b64(claims)}.c2ln`;
const ACCESS = token({ sub: ME, aal: "aal2", user_metadata: { full_name: "Inès Martin" } });

const session: SessionClient = {
  accessToken: () => Promise.resolve(ACCESS),
  resume: () => Promise.resolve(true),
  verifyOtp: () => Promise.resolve(false),
  signOut: () => Promise.resolve(),
};

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
function backend(tables: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const fetcher = (input: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: input, method: init.method ?? "GET", body, headers });
    const rest = /\/rest\/v1\/([a-z_]+)/.exec(input);
    if (rest) {
      const rows = tables[rest[1] as string] ?? [];
      return Promise.resolve(new Response(init.method === "POST" ? "" : JSON.stringify(rows), { status: init.method === "POST" ? 201 : 200, headers: { "content-type": "application/json", "content-range": `0-${rows.length}/${rows.length}` } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ outcome: "succeeded", ok: true }), { status: 200 }));
  };
  return { calls, fetcher };
}

describe("console en production", () => {
  it("revendications du jeton : lues pour l'affichage seulement ; un jeton illisible ne casse rien", () => {
    expect(claimsOf(ACCESS)).toEqual({ sub: ME, aal: "aal2", name: "Inès Martin" });
    expect(claimsOf("pas-un-jeton")).toEqual({});
  });

  it("configuration : une clé secrète à la place de la clé publiable est refusée", () => {
    expect(() => createSupabaseConsoleApi({ url: URL_, publishableKey: "sb_secret_x", session })).toThrow();
  });

  it("file : incidents, actions à valider et demandes chez un technicien, lus dans la base avec le jeton en mémoire", async () => {
    const b = backend({
      organizations: [{ id: ORG, name: "Cabinet Alpha" }],
      incidents: [{ id: "i1", org_id: ORG, title: "VPN indisponible", severity: "major", opened_at: "2026-11-17T07:41:00Z" }],
      action_requests: [{ id: "a1", org_id: ORG, capability: "user.unlock", target_ref: "m.dubois@alpha.test", risk_flags: [], created_at: "2026-11-17T07:00:00Z" }],
      conversations: [{ id: "v1", org_id: ORG, category: "printer", created_at: "2026-11-17T06:00:00Z", escalated_at: "2026-11-17T06:01:00Z" }],
      tickets: [{ conversation_id: "v1", title: "Imprimante : bourrage", priority: "high", sla_due_at: "2026-11-17T09:00:00Z", external_ref: "GLPI #48213" }],
    });
    const api = createSupabaseConsoleApi({ url: URL_, publishableKey: KEY, fetcher: b.fetcher, session });
    const q = await api.queue();
    expect(q.map((i) => [i.kind, i.title, i.client.name])).toEqual([
      ["incident", "VPN indisponible", "Cabinet Alpha"],
      ["approval", "Débloquer le compte de m.dubois", "Cabinet Alpha"],
      ["sla", "Imprimante : bourrage", "Cabinet Alpha"],
    ]);
    const rest = b.calls.filter((c) => c.url.includes("/rest/v1/"));
    expect(rest.every((c) => c.headers.authorization === `Bearer ${ACCESS}`)).toBe(true);
    expect(rest.some((c) => c.url.includes("action_requests") && c.url.includes("status=eq.pending_approval"))).toBe(true);
  });

  it("validation : empreinte VUE, méthode d'identité, délégation et jeton Microsoft du valideur envoyés à la fonction actions", async () => {
    const b = backend({ connectors: [{ tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }] });
    const api = createSupabaseConsoleApi({ url: URL_, publishableKey: KEY, fetcher: b.fetcher, session });
    const action = {
      id: "a1", client: { id: ORG, name: "Alpha" }, capability: "user.reset_password", target: "j.martin@alpha.test", requestedAt: "", expiresAt: "",
      paramsHash: "f".repeat(64), context: [], riskFlags: [], identityRequired: true,
    };
    await api.approve(ORG, action, "manager_confirmation", "dl-1");
    expect(microsoftToken).toHaveBeenCalledWith({ tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", capability: "user.reset_password" });
    const call = b.calls.find((c) => c.url === `${URL_}/functions/v1/actions`);
    expect(call?.body).toEqual({
      orgId: ORG, op: "approve", actionId: "a1", seenHash: "f".repeat(64), identityMethod: "manager_confirmation", viaDelegationId: "dl-1", microsoftToken: "jeton-microsoft-delegue",
    });
    expect(call?.headers.authorization).toBe(`Bearer ${ACCESS}`);
  });

  it("gestes : réponse et note par la fonction console ; notation insérée au nom de la personne du jeton", async () => {
    const b = backend({});
    const api = createSupabaseConsoleApi({ url: URL_, publishableKey: KEY, fetcher: b.fetcher, session });
    await api.reply(ORG, "v1", "Je passe jeudi", true);
    await api.rate(ORG, "m1", "partial", "missing_source");
    expect(b.calls[0]?.url).toBe(`${URL_}/functions/v1/console`);
    expect(b.calls[0]?.body).toEqual({ orgId: ORG, op: "reply", conversationId: "v1", text: "Je passe jeudi", internal: true });
    const insert = b.calls.find((c) => c.url.includes("/rest/v1/response_ratings") && c.method === "POST");
    expect(insert?.body).toEqual({ org_id: ORG, message_id: "m1", kind: "answer", rating: "partial", reason: "missing_source", rated_by: ME });
  });
});
