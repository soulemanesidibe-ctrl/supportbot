import { describe, expect, it } from "vitest";
import { createSupabaseDashboardApi, toOrgSummary } from "./dashboard-supabase.ts";
import type { SessionClient } from "./session.ts";
import { ApiError } from "./supabase.ts";

const URL_ = "https://projet.supabase.co";
const KEY = "sb_publishable_test";
const ME = "123e4567-e89b-12d3-a456-426614174000";
const ORG = "223e4567-e89b-12d3-a456-426614174000";
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const ACCESS = `${b64({ alg: "HS256" })}.${b64({ sub: ME, aal: "aal2", user_metadata: { full_name: "Claire Lambert" } })}.c2ln`;

const session: SessionClient = {
  accessToken: () => Promise.resolve(ACCESS),
  resume: () => Promise.resolve(true),
  verifyOtp: () => Promise.resolve(false),
  signOut: () => Promise.resolve(),
};

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function backend(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetcher = (input: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url: input, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, headers });
    const key = Object.keys(routes).find((r) => input.includes(r));
    return Promise.resolve(key ? (routes[key] as () => Response)() : json({ message: "inconnu" }, 404));
  };
  return { calls, fetcher };
}

describe("tableaux de bord en production", () => {
  it("configuration : une clé secrète à la place de la clé publiable est refusée", () => {
    expect(() => createSupabaseDashboardApi({ url: URL_, publishableKey: "sb_secret_x", session })).toThrow();
  });

  it("résumé : chaque champ relu et converti ; une médiane absente reste absente ; un état de catégorie inconnu redevient « mode ombre »", () => {
    const s = toOrgSummary({
      days: 30,
      support: { conversations: "12", resolved_by_releve: 3, resolved_by_team: 7, first_answer_median_seconds: null, satisfaction_avg: "4.5", satisfaction_n: 2 },
      categories: [
        { category: "password", gate: "direct", conversations: 5, bars_met: true, stats: { answers: 320, correct: 300, dangerous: 0 } },
        { category: "vpn", gate: "ouvert-a-tous", conversations: 1, bars_met: "true", stats: {} },
      ],
    });
    expect(s.support.conversations).toBe(12);
    expect(s.support.firstAnswerMedianSeconds).toBeNull();
    expect(s.support.satisfactionAvg).toBe(4.5);
    expect(s.categories[0]).toMatchObject({ category: "password", gate: "direct", answers: 320, correct: 300, barsMet: true });
    expect(s.categories[1]).toMatchObject({ gate: "shadow", answers: 0, barsMet: false });
  });

  it("clients de l'ESN : fonction SQL appelée avec le jeton en mémoire ; refus de la base traduit en « interdit »", async () => {
    const ok = backend({
      "/rest/v1/rpc/dashboard_partner_clients": () => json([{ org_id: ORG, name: "Cabinet Alpha", slug: "alpha", labels: ["santé"], org_state: "pilot", open_incidents: 2, satisfaction_avg_30d: null, client_price_cents: 39000 }]),
    });
    const api = createSupabaseDashboardApi({ url: URL_, publishableKey: KEY, fetcher: ok.fetcher, session });
    const rows = await api.partnerClients("p1");
    expect(rows[0]).toMatchObject({ orgId: ORG, name: "Cabinet Alpha", labels: ["santé"], openIncidents: 2, satisfactionAvg30d: null, clientPriceCents: 39000, partnerPriceCents: null });
    const call = ok.calls.find((c) => c.url.includes("/rpc/"));
    expect(call?.body).toEqual({ p_partner: "p1" });
    expect(call?.headers.authorization).toBe(`Bearer ${ACCESS}`);

    const denied = backend({ "/rest/v1/rpc/dashboard_org_summary": () => json({ code: "42501", message: "accès refusé" }, 403) });
    const api2 = createSupabaseDashboardApi({ url: URL_, publishableKey: KEY, fetcher: denied.fetcher, session });
    await expect(api2.orgSummary(ORG, 30)).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("geste d'administration : envoyé à la fonction « admin » ; « second facteur requis » remonte tel quel pour la revérification", async () => {
    const b = backend({ "/functions/v1/admin": () => json({ error: { code: "mfa_required" } }, 403) });
    const api = createSupabaseDashboardApi({ url: URL_, publishableKey: KEY, fetcher: b.fetcher, session });
    const err = await api.adminOp(ORG, { op: "autonomy.set", category: "accounts", level: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "mfa_required" });
    expect(b.calls[0]?.body).toEqual({ orgId: ORG, op: "autonomy.set", category: "accounts", level: 1 });
    expect(b.calls[0]?.headers.authorization).toBe(`Bearer ${ACCESS}`);
  });
});
