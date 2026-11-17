// Tableaux de bord en données FICTIVES (mode démo seulement, jamais dans le paquet de production). Une ESN inventée, Nord
// Numérique, et cinq clients inventés. Les effectifs sont volontairement modestes : la plupart des catégories n'ont pas encore les
// 300 notes qui permettraient de les ouvrir (docs/11 § 2), comme au début d'un vrai pilote.
import type { AccessOverview, AdminContext, AdminOp, CategoryQuality, DashboardApi, OrgSummary, PartnerClientRow, PartnerContext } from "./dashboard-types.ts";
import { ApiError } from "./supabase.ts";
import type { Category } from "./types.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const row = (over: Partial<PartnerClientRow> & Pick<PartnerClientRow, "orgId" | "name" | "slug">): PartnerClientRow => ({
  labels: [], orgState: "active", frozen: false, activated: true, relationshipStatus: "active", relationshipExpiresAt: inDays(240),
  reliefActive: false, reliefUntil: null, absences90d: 0, openIncidents: 0, majorIncidents: 0, pendingActions: 0, waitingTechnician: 0,
  slaAtRisk: 0, connectorsInError: 0, conversations30d: 0, resolvedByReleve30d: 0, satisfactionAvg30d: null, satisfactionN30d: 0,
  assignedTechnicians: 1, clientPriceCents: null, partnerPriceCents: null, ...over,
});

const CLIENTS: PartnerClientRow[] = [
  row({
    orgId: "c-tilleuls", name: "Clinique des Tilleuls", slug: "clinique-tilleuls", labels: ["santé", "Lyon"], reliefActive: true, reliefUntil: inHours(9),
    absences90d: 3, openIncidents: 2, majorIncidents: 1, pendingActions: 1, waitingTechnician: 4, conversations30d: 212, resolvedByReleve30d: 61,
    satisfactionAvg30d: 4.4, satisfactionN30d: 58, assignedTechnicians: 2, clientPriceCents: 39_000, partnerPriceCents: 24_500,
  }),
  row({
    orgId: "c-morel", name: "Transports Morel", slug: "transports-morel", labels: ["logistique"], pendingActions: 1, waitingTechnician: 2, slaAtRisk: 1,
    conversations30d: 147, resolvedByReleve30d: 39, satisfactionAvg30d: 4.1, satisfactionN30d: 33, clientPriceCents: 29_000, partnerPriceCents: 17_500,
  }),
  row({
    orgId: "c-bastide", name: "Fonderie Bastide", slug: "fonderie-bastide", labels: ["industrie"], pendingActions: 1, waitingTechnician: 1, connectorsInError: 1,
    conversations30d: 96, resolvedByReleve30d: 18, satisfactionAvg30d: 3.9, satisfactionN30d: 21, clientPriceCents: 24_000, partnerPriceCents: 14_000,
  }),
  row({
    orgId: "c-garonne", name: "Mutuelle Garonne", slug: "mutuelle-garonne", labels: ["assurance", "Toulouse"], orgState: "pilot", absences90d: 2,
    relationshipExpiresAt: inDays(34), conversations30d: 58, resolvedByReleve30d: 9, satisfactionAvg30d: 4.6, satisfactionN30d: 11,
  }),
  row({
    orgId: "c-vercors", name: "Mairie de Vercors-Sud", slug: "mairie-vercors-sud", labels: ["collectivité"], orgState: "pilot", relationshipExpiresAt: inDays(61),
    conversations30d: 23, resolvedByReleve30d: 2, satisfactionN30d: 3, satisfactionAvg30d: 4.0, assignedTechnicians: 1,
  }),
];

const q = (category: Category, gate: CategoryQuality["gate"], answers: number, correct: number, partial: number, wrong: number, dangerous: number, conversations: number): CategoryQuality => ({
  category, gate, answers, correct, partial, wrong, dangerous, conversations, escalations: Math.round(conversations * 0.2),
  escalationsJustified: Math.round(conversations * 0.18), missedEscalations: wrong > 3 ? 2 : 0, barsMet: answers >= 300 && dangerous === 0 && correct / answers >= 0.8,
});

function summary(id: string): OrgSummary {
  const c = CLIENTS.find((x) => x.orgId === id) ?? CLIENTS[0] as PartnerClientRow;
  const k = c.conversations30d / 212;
  const r = (n: number) => Math.round(n * k);
  return {
    days: 30,
    support: {
      conversations: c.conversations30d, resolvedByReleve: c.resolvedByReleve30d, resolvedByTeam: r(118), waitingTechnician: c.waitingTechnician,
      waitingUser: r(9), escalated: r(97), duringRelief: r(74), firstAnswerMedianSeconds: 2, firstAnswerN: c.conversations30d,
      resolutionMedianMinutes: 47, resolutionN: c.resolvedByReleve30d + r(118), satisfactionAvg: c.satisfactionAvg30d, satisfactionN: c.satisfactionN30d,
    },
    categories: [
      q("password", "shadow", r(342), r(301), r(29), r(12), 0, r(64)),
      q("printer", "direct", r(318), r(279), r(26), r(13), 0, r(41)),
      q("outlook", "shadow", r(184), r(151), r(21), r(12), 0, r(33)),
      q("vpn", "shadow", r(96), r(71), r(14), r(11), 0, r(29)),
      q("mfa", "advice_only", r(141), r(103), r(19), r(18), 1, r(18)),
      q("teams", "shadow", r(52), r(44), r(5), r(3), 0, r(14)),
      q("onedrive", "shadow", r(17), r(15), r(1), r(1), 0, r(7)),
      q("slow_pc", "shadow", 0, 0, 0, 0, 0, r(6)),
    ],
  };
}

const ACCESS: AccessOverview = {
  relationship: { partnerName: "Nord Numérique", status: "active", approvedRoles: ["partner_admin", "partner_technician"], expiresAt: inDays(240) },
  technicians: [
    { assignmentId: "as-1", name: "Inès Martin", until: inDays(150) },
    { assignmentId: "as-2", name: "Hugo Lefèvre", until: inDays(20) },
  ],
  delegations: [{ id: "dl-1", from: "Thomas Girard", to: "Inès Martin", until: inDays(4), categories: ["accounts"] }],
  supportAccess: [{ id: "sa-1", reason: "Analyse d'un échec de synchronisation GLPI signalé par l'ESN", approved: false, until: inHours(4) }],
  connectors: [
    { id: "k-1", name: "GLPI de la clinique", type: "glpi", status: "ok", lastSyncAt: new Date(Date.now() - 4 * 60_000).toISOString() },
    { id: "k-2", name: "Microsoft 365", type: "m365", status: "ok", lastSyncAt: new Date(Date.now() - 11 * 60_000).toISOString() },
  ],
  autonomy: [{ category: "accounts", level: 1 }, { category: "tickets", level: 0 }],
  relief: [
    { kind: "night", startsAt: inHours(-6), endsAt: inHours(9) },
    { kind: "on_call", startsAt: inHours(-6), endsAt: inHours(9), who: "Inès Martin" },
    { kind: "leave", startsAt: inDays(12), endsAt: inDays(19) },
  ],
};

export function createDemoDashboardApi(opts: { latencyMs?: number } = {}): DashboardApi {
  const latency = opts.latencyMs ?? 300;
  let access: AccessOverview = ACCESS;
  let frozen = false;
  let steppedAt = 0;
  const gates = new Map<Category, CategoryQuality["gate"]>();
  let signedIn = false; // la démonstration garde la session le temps de l'onglet, comme le cookie en production
  const recent = () => Date.now() - steppedAt < 10 * 60_000;
  return {
    async resume() { return signedIn; },
    async password(_e, p) { await wait(latency); return p ? { ok: true, next: "mfa_verify" } : { ok: false }; },
    async enroll() { return { factorId: "demo", qrSvg: "", secret: "DEMO DEMO DEMO DEMO" }; },
    async verify(_f, code) { await wait(latency); signedIn = /^\d{6}$/.test(code); return signedIn; },
    async signOut() { signedIn = false; },
    async stepUp(code) { await wait(latency); if (!/^\d{6}$/.test(code)) return false; steppedAt = Date.now(); return true; },

    async partner(): Promise<PartnerContext> { await wait(latency / 2); return { partnerId: "p-nord", partnerName: "Nord Numérique", me: { firstName: "Claire" }, synthetic: true }; },
    async partnerClients() { await wait(latency); return CLIENTS; },
    async orgSummary(id) {
      await wait(latency);
      const s = summary(id);
      return { ...s, categories: s.categories.map((c) => ({ ...c, gate: gates.get(c.category) ?? c.gate })) };
    },
    async admin(): Promise<AdminContext> { await wait(latency / 2); return { orgId: "c-tilleuls", orgName: "Clinique des Tilleuls", frozen, me: { firstName: "Paul" }, synthetic: true }; },
    async access() { await wait(latency); return access; },
    async adminOp(_org, op: AdminOp) {
      await wait(latency);
      const needsMfa = (op.op === "autonomy.set" && op.level === 1) || op.op === "org.unfreeze" || op.op === "support_access.approve"
        || (op.op === "category.set_state" && op.state === "direct");
      if (needsMfa && !recent()) throw new ApiError(403, "mfa_required");
      if (op.op === "org.freeze") frozen = true;
      if (op.op === "org.unfreeze") frozen = false;
      if (op.op === "assignment.revoke") access = { ...access, technicians: access.technicians.filter((t) => t.assignmentId !== op.assignmentId) };
      if (op.op === "delegation.revoke") access = { ...access, delegations: access.delegations.filter((d) => d.id !== op.delegationId) };
      if (op.op === "support_access.revoke") access = { ...access, supportAccess: access.supportAccess.filter((g) => g.id !== op.grantId) };
      if (op.op === "support_access.approve") access = { ...access, supportAccess: access.supportAccess.map((g) => (g.id === op.grantId ? { ...g, approved: true } : g)) };
      if (op.op === "autonomy.set") access = { ...access, autonomy: access.autonomy.map((a) => (a.category === op.category ? { ...a, level: op.level } : a)) };
      if (op.op === "category.set_state") gates.set(op.category, op.state);
      if (op.op === "relationship.revoke") access = { ...access, relationship: null, technicians: [] };
    },
  };
}
