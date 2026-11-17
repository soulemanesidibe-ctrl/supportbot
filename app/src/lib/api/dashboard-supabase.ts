// Tableaux de bord en production : chiffres par les fonctions SQL des migrations 18 et 19 (aucun contenu, second facteur et droit
// vérifiés dans la base), gestes d'administration par la fonction « admin » (rôles, second facteur récent, journal). Jeton d'accès
// en mémoire seulement, session du personnel partagée par l'onglet.
import { createClient } from "@supabase/supabase-js";
import type { AccessOverview, AdminContext, AdminOp, CategoryQuality, DashboardApi, OrgSummary, PartnerClientRow, PartnerContext } from "./dashboard-types.ts";
import type { SessionClient } from "./session.ts";
import { claimsOf, createStaffAuth, staffSession } from "./staff.ts";
import { ApiError, functionsBase } from "./supabase.ts";
import type { Category } from "./types.ts";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
// Réponse JSON de la base : chaque champ est relu et converti explicitement avant usage.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const firstName = (full: string | undefined) => (full ?? "").trim().split(/\s+/)[0]?.split("@")[0] ?? "";

export function toOrgSummary(d: Row): OrgSummary {
  const s = (d.support ?? {}) as Row;
  return {
    days: num(d.days),
    support: {
      conversations: num(s.conversations), resolvedByReleve: num(s.resolved_by_releve), resolvedByTeam: num(s.resolved_by_team),
      waitingTechnician: num(s.waiting_technician), waitingUser: num(s.waiting_user), escalated: num(s.escalated), duringRelief: num(s.during_relief),
      firstAnswerMedianSeconds: numOrNull(s.first_answer_median_seconds), firstAnswerN: num(s.first_answer_n),
      resolutionMedianMinutes: numOrNull(s.resolution_median_minutes), resolutionN: num(s.resolution_n),
      satisfactionAvg: numOrNull(s.satisfaction_avg), satisfactionN: num(s.satisfaction_n),
    },
    categories: ((d.categories ?? []) as Row[]).map((c): CategoryQuality => {
      const st = (c.stats ?? {}) as Row;
      return {
        category: String(c.category) as Category, gate: c.gate === "direct" || c.gate === "advice_only" ? c.gate : "shadow",
        conversations: num(c.conversations), answers: num(st.answers), correct: num(st.correct), partial: num(st.partial), wrong: num(st.wrong),
        dangerous: num(st.dangerous), escalations: num(st.escalations), escalationsJustified: num(st.escalations_justified),
        missedEscalations: num(st.missed_escalations), barsMet: c.bars_met === true,
      };
    }),
  };
}

export function createSupabaseDashboardApi(opts: { url?: string; publishableKey?: string; fetcher?: Fetch; session?: SessionClient } = {}): DashboardApi {
  const url = opts.url ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const key = opts.publishableKey ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);
  const base = functionsBase(url);
  if (!key || !key.startsWith("sb_publishable_")) throw new Error("Clé publiable Supabase absente (VITE_SUPABASE_PUBLISHABLE_KEY)");
  const fetcher: Fetch = opts.fetcher ?? fetch;
  const session = opts.session ?? staffSession(fetcher);
  const staff = createStaffAuth({ url: url as string, publishableKey: key, fetcher, session });
  const db = createClient(url as string, key, { accessToken: () => session.accessToken(), global: { fetch: (i, init) => fetcher(String(i), init ?? {}) } });

  const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new ApiError((error as { code?: string }).code === "42501" ? 403 : 503, (error as { code?: string }).code === "42501" ? "forbidden" : "unavailable");
    return data;
  };
  const me = async () => claimsOf(await session.accessToken());
  const membership = async (roles: string[]): Promise<Row | null> => {
    const { data, error } = await db.from("memberships").select("org_id, role, organizations(name, frozen_at)").eq("user_id", (await me()).sub ?? "")
      .eq("status", "active").in("role", roles).limit(1);
    if (error) throw new ApiError(503, "unavailable");
    return ((data ?? []) as Row[])[0] ?? null;
  };

  return {
    resume: () => staff.resume(),
    password: (e, p) => staff.password(e, p),
    enroll: () => staff.enroll(),
    verify: (f, c) => staff.verify(f, c),
    signOut: () => staff.signOut(),
    stepUp: (code) => staff.stepUp(code),

    async partner(): Promise<PartnerContext | null> {
      const m = await membership(["partner_admin", "partner_manager"]);
      if (!m) return null;
      return { partnerId: String(m.org_id), partnerName: String(m.organizations?.name ?? "ESN"), me: { firstName: firstName((await me()).name) }, synthetic: false };
    },
    async partnerClients(partnerId): Promise<PartnerClientRow[]> {
      const rows = ((await rpc("dashboard_partner_clients", { p_partner: partnerId })) ?? []) as Row[];
      return rows.map((r) => ({
        orgId: String(r.org_id), name: String(r.name), slug: String(r.slug), labels: Array.isArray(r.labels) ? r.labels.map(String) : [],
        orgState: r.org_state, frozen: r.frozen === true, activated: r.activated === true, relationshipStatus: r.relationship_status,
        relationshipExpiresAt: String(r.relationship_expires_at), reliefActive: r.relief_active === true, reliefUntil: r.relief_until ? String(r.relief_until) : null,
        absences90d: num(r.absences_90d), openIncidents: num(r.open_incidents), majorIncidents: num(r.major_incidents), pendingActions: num(r.pending_actions),
        waitingTechnician: num(r.waiting_technician), slaAtRisk: num(r.sla_at_risk), connectorsInError: num(r.connectors_in_error),
        conversations30d: num(r.conversations_30d), resolvedByReleve30d: num(r.resolved_by_releve_30d), satisfactionAvg30d: numOrNull(r.satisfaction_avg_30d),
        satisfactionN30d: num(r.satisfaction_n_30d), assignedTechnicians: num(r.assigned_technicians),
        clientPriceCents: numOrNull(r.client_price_cents), partnerPriceCents: numOrNull(r.partner_price_cents),
      }));
    },
    async orgSummary(orgId, days) {
      return toOrgSummary(((await rpc("dashboard_org_summary", { p_org: orgId, p_days: days })) ?? {}) as Row);
    },
    async admin(): Promise<AdminContext | null> {
      const m = await membership(["org_admin"]);
      if (!m) return null;
      return { orgId: String(m.org_id), orgName: String(m.organizations?.name ?? "Organisation"), frozen: Boolean(m.organizations?.frozen_at), me: { firstName: firstName((await me()).name) }, synthetic: false };
    },
    async access(orgId): Promise<AccessOverview> {
      const d = ((await rpc("dashboard_org_access", { p_org: orgId })) ?? {}) as Row;
      const rel = d.relationship as Row | null;
      return {
        relationship: rel ? { partnerName: String(rel.partner_name), status: rel.status, approvedRoles: Array.isArray(rel.approved_roles) ? rel.approved_roles : [], expiresAt: String(rel.expires_at) } : null,
        technicians: ((d.technicians ?? []) as Row[]).map((t) => ({ assignmentId: String(t.assignment_id), name: String(t.name ?? ""), until: String(t.until) })),
        delegations: ((d.delegations ?? []) as Row[]).map((x) => ({ id: String(x.id), from: String(x.from ?? ""), to: String(x.to ?? ""), until: String(x.until), categories: Array.isArray(x.categories) ? x.categories.map(String) : [] })),
        supportAccess: ((d.support_access ?? []) as Row[]).map((g) => ({ id: String(g.id), reason: String(g.reason ?? ""), approved: g.approved === true, until: g.until ? String(g.until) : "" })),
        connectors: ((d.connectors ?? []) as Row[]).map((k) => ({ id: String(k.id), name: String(k.name), type: String(k.type), status: k.status, lastSyncAt: k.last_sync_at ? String(k.last_sync_at) : null })),
        autonomy: ((d.autonomy ?? []) as Row[]).map((a) => ({ category: a.category, level: num(a.level) === 1 ? 1 : 0 })),
        relief: ((d.relief ?? []) as Row[]).map((r) => ({ kind: r.kind, startsAt: String(r.starts_at), endsAt: String(r.ends_at), ...(r.who ? { who: String(r.who) } : {}) })),
      };
    },
    async adminOp(orgId, op: AdminOp) {
      const res = await fetcher(`${base}/admin`, {
        method: "POST", credentials: "omit", cache: "no-store",
        headers: { "content-type": "application/json", authorization: `Bearer ${await session.accessToken()}` },
        body: JSON.stringify({ orgId, ...op }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        throw new ApiError(res.status, data?.error?.code ?? "error");
      }
    },
  };
}
