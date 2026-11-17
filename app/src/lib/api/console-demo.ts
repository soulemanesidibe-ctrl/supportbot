// Console du technicien en données FICTIVES (mode démo seulement, jamais dans le paquet de production). Trois clients inventés,
// les mêmes que les maquettes (docs/identite-visuelle/cockpits/Technicien.dc.html).
import type {
  ApprovalDetail, AwaySummary, ClientRef, ConsoleApi, ConsoleContext, ConsoleMessage, ConversationDetail, IncidentDetail, QueueItem,
  Rating, SearchHit, StaffAuthApi,
} from "./console-types.ts";
import { CAPABILITY_TITLE } from "./console-titles.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const inMin = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
let n = 0;
const nid = () => `d-${++n}`;

const TILLEULS: ClientRef = { id: "c-tilleuls", name: "Clinique des Tilleuls" };
const MOREL: ClientRef = { id: "c-morel", name: "Transports Morel" };
const BASTIDE: ClientRef = { id: "c-bastide", name: "Fonderie Bastide" };
const CLIENTS = [TILLEULS, MOREL, BASTIDE];

const SHADOW_NOTICE =
  "Votre demande est bien enregistrée. Un technicien va vous répondre dans les meilleurs délais. Relève, l'assistant IA du support, prépare votre demande pour l'équipe.";
const ESCALATED_NOTICE =
  "Je transmets votre demande à un technicien, qui reprendra la conversation. Vous n'aurez pas à répéter. Je suis un assistant IA : un humain prend le relais.";

interface DemoConv extends Omit<ConversationDetail, "messages"> {
  messages: ConsoleMessage[];
}

function seedConversations(): DemoConv[] {
  const m = (role: ConsoleMessage["role"], content: string, at: number, extra: Partial<ConsoleMessage> = {}): ConsoleMessage => ({
    id: nid(), role, visibility: "public", content, at: iso(at), rateable: false, ...extra,
  });
  return [
    {
      id: "v-morel-imprimante", client: MOREL, title: "Imprimante quai B : bourrage récurrent", state: "waiting_technician", category: "printer",
      requester: "Karim Benali", openedAt: iso(95), reliefActive: true, assignedToMe: false,
      ticket: { ref: "GLPI #48213", priority: "high", slaDueAt: inMin(25) },
      messages: [
        m("user", "L'imprimante du quai B fait encore un bourrage, c'est la quatrième fois cette semaine. Les bons de livraison ne sortent plus.", 95),
        m("notice", SHADOW_NOTICE, 95),
        m("assistant", "Ouvrez le capot arrière, retirez la feuille coincée en tirant vers vous, puis vérifiez que le bac 2 n'est pas chargé au-delà du repère. Si le bourrage revient dans la journée, le rouleau d'entraînement est probablement usé : un technicien doit le remplacer.", 94, { visibility: "technician", rateable: true }),
        m("notice", "Diagnostic de Relève : 4e signalement en 10 jours sur PRN-QUAI-B. Problème récurrent proposé au ticket.", 94, { visibility: "technician" }),
      ],
    },
    {
      id: "v-bastide-paie", client: BASTIDE, title: "Logiciel de paie : erreur de licence au lancement", state: "waiting_technician", category: "other",
      requester: "Sophie Laurent", openedAt: iso(48), reliefActive: false, assignedToMe: false,
      ticket: { ref: "JSM SUP-311", priority: "normal" },
      messages: [
        m("user", "Le logiciel de paie affiche « licence expirée » au démarrage depuis ce matin. On doit lancer les bulletins aujourd'hui.", 48),
        m("notice", ESCALATED_NOTICE, 47),
        m("notice", "Hors base de connaissance. Capture d'écran et version du poste (Windows 11 23H2, paie 14.2) jointes au ticket.", 47, { visibility: "technician" }),
      ],
    },
    {
      id: "v-tilleuls-vpn-1", client: TILLEULS, title: "VPN : impossible de se connecter depuis le domicile", state: "waiting_technician", category: "vpn",
      requester: "Lucie Perrin", openedAt: iso(36), reliefActive: true, assignedToMe: false,
      messages: [
        m("user", "Je n'arrive plus à me connecter au VPN depuis chez moi, ça tourne puis ça échoue.", 36),
        m("notice", "Un incident en cours touche le service « VPN » et l'équipe technique est prévenue. Votre demande y est rattachée : vous serez informé ici de son rétablissement.", 36),
      ],
    },
  ];
}

function seedApprovals(): ApprovalDetail[] {
  return [
    {
      id: "a-morel-mfa", client: MOREL, capability: "user.mfa_reregister", target: "lucie.perrin@transports-morel.test",
      requestedAt: iso(22), expiresAt: inMin(22 * 60), paramsHash: "a".repeat(64),
      context: ["Nouveau téléphone, ancien appareil remis au service", "Identité confirmée par son manager (appel à 07:52)", "Connexion habituelle : Lyon, poste PC-LOG-07"],
      riskFlags: [], conversationId: undefined, identityRequired: true,
    },
    {
      id: "a-tilleuls-unlock", client: TILLEULS, capability: "user.unlock", target: "m.dubois@clinique-tilleuls.test",
      requestedAt: iso(70), expiresAt: inMin(18 * 60), paramsHash: "b".repeat(64),
      context: ["Compte bloqué après 5 essais à 06:58", "Aucune connexion depuis un pays inhabituel", "Dernier changement de mot de passe il y a 41 jours"],
      riskFlags: [], identityRequired: true,
    },
    {
      id: "a-bastide-reset", client: BASTIDE, capability: "user.reset_password", target: "j.martin@fonderie-bastide.test",
      requestedAt: iso(15), expiresAt: inMin(23 * 60), paramsHash: "c".repeat(64),
      context: ["Mot de passe expiré, salarié en déplacement", "Deuxième demande de réinitialisation en 7 jours"],
      riskFlags: ["Deuxième demande en 7 jours : vérifiez l'identité par un rappel au numéro de l'annuaire"], identityRequired: true,
    },
  ];
}

const INCIDENT: IncidentDetail = {
  id: "i-tilleuls-vpn", client: TILLEULS, title: "VPN siège indisponible", category: "vpn", severity: "major", state: "open",
  openedAt: iso(48), requests: 14,
  timeline: [
    { at: iso(48), kind: "alert", text: "Alerte de supervision : pare-feu du siège injoignable (confirmée après 2 événements)" },
    { at: iso(45), kind: "request", text: "3 demandes « le VPN ne marche pas » : incident créé, ticket parent GLPI #48190" },
    { at: iso(44), kind: "notice", text: "Message envoyé aux salariés concernés ; astreinte prévenue" },
    { at: iso(27), kind: "request", text: "14 demandes rattachées au ticket parent" },
  ],
};

const CERTIFICATE: IncidentDetail = {
  id: "i-tilleuls-certificat", client: TILLEULS, title: "Certificat du portail patients : expire dans 12 jours", category: "other", severity: "warning",
  state: "open", openedAt: iso(600), requests: 0,
  timeline: [
    { at: iso(600), kind: "alert", text: "Supervision : le certificat de portail.clinique-tilleuls.test expire dans 12 jours" },
    { at: iso(598), kind: "notice", text: "Aucun salarié prévenu : alerte préventive, visible des techniciens seulement" },
  ],
};

export function createDemoConsoleApi(opts: { latencyMs?: number } = {}): ConsoleApi & StaffAuthApi {
  const latency = opts.latencyMs ?? 350;
  const convs = seedConversations();
  let approvals = seedApprovals();
  const ratings = new Map<string, Rating>();
  const find = (id: string) => {
    const c = convs.find((x) => x.id === id);
    if (!c) throw new Error("introuvable");
    return c;
  };

  const queue = (): QueueItem[] => {
    const items: QueueItem[] = [
      {
        key: `incident:${INCIDENT.id}`, kind: "incident", client: TILLEULS, title: INCIDENT.title, priority: "urgent", since: INCIDENT.openedAt,
        detail: `${INCIDENT.requests} demandes regroupées · message automatique envoyé aux salariés`, target: { type: "incident", id: INCIDENT.id },
      },
      ...approvals.map((a): QueueItem => ({
        key: `approval:${a.id}`, kind: "approval", client: a.client, title: CAPABILITY_TITLE[a.capability]?.(a.target) ?? a.capability,
        detail: a.context[0] ?? "", priority: a.riskFlags.length ? "high" : "normal", since: a.requestedAt, target: { type: "approval", id: a.id },
      })),
      ...convs.filter((c) => c.state === "waiting_technician" || c.state === "open").map((c): QueueItem => ({
        key: `conversation:${c.id}`,
        kind: c.ticket?.slaDueAt ? "sla" : "escalation",
        client: c.client, title: c.title, priority: c.ticket?.priority ?? "normal", since: c.openedAt, ticketRef: c.ticket?.ref, slaDueAt: c.ticket?.slaDueAt,
        detail: c.messages.find((m) => m.visibility === "technician" && m.role === "notice")?.content.replace(/^Diagnostic de Relève : /, "")
          ?? `« ${c.messages.find((m) => m.role === "user")?.content ?? ""} »`,
        target: { type: "conversation", id: c.id },
      })),
      {
        key: "prevention:cert", kind: "prevention", client: TILLEULS, title: "Certificat du portail patients : expire dans 12 jours", priority: "low",
        since: iso(600), detail: "portail.clinique-tilleuls.test · renouvellement à planifier", target: { type: "incident", id: CERTIFICATE.id },
      },
    ];
    return items;
  };

  return {
    // ---------------------------------------------------------------- connexion (démo : tout code à 6 chiffres convient)
    async resume() { return false; },
    async password(_e, p) { await wait(latency); return p.length > 0 ? { ok: true, next: "mfa_verify" } : { ok: false }; },
    async enroll() { return { factorId: "demo", qrSvg: "", secret: "DEMO DEMO DEMO DEMO" }; },
    async verify(_f, code) { await wait(latency); return /^\d{6}$/.test(code); },
    async signOut() {},

    // ---------------------------------------------------------------- console
    async context(): Promise<ConsoleContext> {
      await wait(latency / 2);
      const until = new Date();
      until.setHours(8, 0, 0, 0);
      if (until.getTime() < Date.now()) until.setDate(until.getDate() + 1);
      return {
        me: { firstName: "Inès", onCallUntil: until.toISOString() },
        clients: CLIENTS,
        actingFor: [{ delegationId: "dl-1", forName: "Thomas Girard", until: inMin(4 * 24 * 60), clientId: MOREL.id }],
        synthetic: true,
      };
    },
    async queue() { await wait(latency); return queue(); },
    async away(): Promise<AwaySummary> {
      await wait(latency / 2);
      return {
        since: iso(11 * 60), resolvedByReleve: 23, resolvedByTeam: 2, toApprove: approvals.length, escalated: 2,
        watch: [
          { title: INCIDENT.title, client: TILLEULS, target: { type: "incident", id: INCIDENT.id } },
          { title: "Imprimante quai B : 4e signalement en 10 jours", client: MOREL, target: { type: "conversation", id: "v-morel-imprimante" } },
        ],
      };
    },
    async conversation(_c, id) {
      await wait(latency / 2);
      const c = find(id);
      return { ...c, messages: c.messages.map((m) => ({ ...m, myRating: ratings.get(m.id) })) };
    },
    async reply(_c, id, text, internal) {
      await wait(latency);
      const c = find(id);
      c.messages.push({ id: nid(), role: "technician", visibility: internal ? "technician" : "public", content: text, at: new Date().toISOString(), authorName: "Inès", rateable: false });
      if (!internal) Object.assign(c, { state: "waiting_user", assignedToMe: true });
    },
    async take(_c, id) { await wait(latency / 2); Object.assign(find(id), { assignedToMe: true }); },
    async resolve(_c, id) { await wait(latency / 2); Object.assign(find(id), { state: "resolved" }); },
    async rate(_c, messageId, rating) { await wait(latency / 3); ratings.set(messageId, rating); },
    async approval(_c, id) {
      await wait(latency / 2);
      const a = approvals.find((x) => x.id === id);
      if (!a) throw new Error("introuvable");
      return a;
    },
    async approve(_c, a: ApprovalDetail) {
      await wait(latency * 2);
      approvals = approvals.filter((x) => x.id !== a.id);
      return { outcome: "succeeded" };
    },
    async reject(_c, id) { await wait(latency); approvals = approvals.filter((x) => x.id !== id); },
    async incident(_c, id) { await wait(latency / 2); return id === CERTIFICATE.id ? CERTIFICATE : INCIDENT; },
    async search(q): Promise<SearchHit[]> {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      const hits: SearchHit[] = [
        ...CLIENTS.filter((c) => c.name.toLowerCase().includes(s)).map((c): SearchHit => ({ kind: "client", label: c.name, hint: "Client", client: c })),
        ...queue().filter((i) => `${i.title} ${i.client.name} ${i.ticketRef ?? ""}`.toLowerCase().includes(s))
          .map((i): SearchHit => ({ kind: i.target.type, label: i.title, hint: `${i.client.name}${i.ticketRef ? ` · ${i.ticketRef}` : ""}`, client: i.client, target: i.target })),
      ];
      return hits.slice(0, 12);
    },
  };
}
