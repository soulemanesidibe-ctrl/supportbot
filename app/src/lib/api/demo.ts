// Adaptateur « démo » : données FICTIVES, sans réseau, pour présenter et tester les écrans. Il n'est chargé qu'en mode démo
// (VITE_RELEVE_DEMO=1) et n'entre jamais dans le paquet de production (import dynamique éliminé à la construction).
// Les textes fixes reprennent mot pour mot ceux de la fonction `chat` (supabase/functions/_shared/chat/texts.ts).
import type { ChatMessage, Conversation, EmployeeAuthApi, RequestSummary, SendResult, WidgetApi, WidgetContext } from "./types.ts";

const TEXTS = {
  shadow:
    "Votre demande est bien enregistrée. Un technicien va vous répondre dans les meilleurs délais. Relève, l'assistant IA du support, prépare votre demande pour l'équipe.",
  escalated:
    "Je transmets votre demande à un technicien, qui reprendra la conversation. Vous n'aurez pas à répéter. Je suis un assistant IA : un humain prend le relais.",
  accountAction:
    "Pour une action sur un compte (mot de passe, authentification à deux facteurs, déblocage), un technicien doit d'abord vérifier votre identité par un autre moyen. Votre demande lui est transmise : il vous contactera.",
  humanRequested:
    "Votre demande est transmise à un technicien, avec ce qui a déjà été vérifié : vous n'aurez pas à répéter. Il vous répondra ici.",
  direct:
    "Votre message est transmis directement à un technicien, qui vous répondra ici. Relève, l'assistant IA du support, ne répond pas à cette demande.",
  notWorked:
    "C'est noté : la solution proposée n'a pas suffi. Votre demande passe à un technicien, avec ce qui a déjà été essayé. Il vous répondra ici.",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const iso = (minutesAgo: number) => new Date(now() - minutesAgo * 60_000).toISOString();
const id = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`);

interface DemoConv {
  id: string;
  title: string;
  status: Conversation["status"];
  messages: ChatMessage[];
  awaitingConfirmation: boolean;
  accountAction: boolean;
  satisfaction: number | null;
}

function seed(): DemoConv[] {
  return [
    {
      id: "c-compta",
      title: "Accès au dossier Comptabilité",
      status: "waiting_technician",
      awaitingConfirmation: false,
      accountAction: false,
      satisfaction: null,
      messages: [
        { id: id(), role: "user", content: "Bonjour, je n'ai plus accès au dossier partagé Comptabilité depuis ce matin.", at: iso(42) },
        { id: id(), role: "notice", content: TEXTS.shadow, at: iso(42) },
        { id: id(), role: "technician", authorName: "Inès", content: "Bonjour, je vois la demande. Votre responsable doit valider l'accès : je lui ai écrit, comptez environ 15 minutes.", at: iso(18) },
      ],
    },
    {
      id: "c-imprimante",
      title: "Imprimante du 2e étage",
      status: "resolved",
      awaitingConfirmation: false,
      accountAction: false,
      satisfaction: 5,
      messages: [
        { id: id(), role: "user", content: "L'imprimante du 2e étage affiche une erreur 50.4.", at: iso(26 * 60) },
        {
          id: id(),
          role: "assistant",
          content:
            "L'erreur 50.4 vient en général de l'alimentation électrique. Éteignez l'imprimante, attendez 30 secondes, puis rallumez-la en la branchant directement sur une prise murale, sans multiprise.",
          at: iso(26 * 60 - 1),
        },
        { id: id(), role: "user", content: "C'est reparti, merci !", at: iso(26 * 60 - 4) },
      ],
    },
    {
      id: "c-ecran",
      title: "Écran qui scintille",
      status: "waiting_technician",
      awaitingConfirmation: false,
      accountAction: false,
      satisfaction: null,
      messages: [
        { id: id(), role: "user", content: "Mon second écran scintille toutes les deux ou trois minutes.", at: iso(3 * 24 * 60) },
        { id: id(), role: "notice", content: TEXTS.escalated, at: iso(3 * 24 * 60) },
        { id: id(), role: "technician", authorName: "Inès", content: "Je passe jeudi matin avec un câble de rechange.", at: iso(2 * 24 * 60) },
      ],
    },
  ];
}

const VPN_INCIDENT_NOTICE =
  "Un incident en cours touche le service « VPN » et l'équipe technique est prévenue. Votre demande y est rattachée : vous serez informé ici de son rétablissement. Message automatique de Relève, l'assistant IA du support ; vous pouvez toujours demander à parler à un technicien.";

/** Réponse déterministe, pour la démonstration seulement : la vraie décision est celle de l'orchestrateur (fonction chat). */
function reply(text: string): { outcome: SendResult["outcome"]; messages: ChatMessage[]; awaiting: boolean; account: boolean; status: Conversation["status"] } {
  const t = text.toLowerCase();
  const at = new Date().toISOString();
  if (/mot de passe|password|mfa|double authentification|authenticator|bloqu|verrouill/.test(t)) {
    return { outcome: "account_action", messages: [{ id: id(), role: "notice", content: TEXTS.accountAction, at }], awaiting: false, account: true, status: "waiting_technician" };
  }
  if (/vpn|forticlient|connexion à distance/.test(t)) {
    return { outcome: "escalated", messages: [{ id: id(), role: "notice", content: VPN_INCIDENT_NOTICE, at }], awaiting: false, account: false, status: "waiting_technician" };
  }
  if (/imprim|printer|bourrage|toner/.test(t)) {
    return {
      outcome: "answered",
      messages: [
        {
          id: id(),
          role: "assistant",
          content:
            "Commencez par vérifier que l'imprimante est allumée et sans voyant orange. Ensuite, sur votre poste : Paramètres, Imprimantes et scanners, choisissez l'imprimante puis « Ouvrir la file d'attente » et annulez les documents bloqués. Relancez l'impression.",
          at,
        },
      ],
      awaiting: true,
      account: false,
      status: "waiting_user",
    };
  }
  if (/outlook|teams|onedrive|mail/.test(t)) {
    return {
      outcome: "answered",
      messages: [
        {
          id: id(),
          role: "assistant",
          content:
            "Fermez complètement l'application (y compris l'icône près de l'horloge), puis rouvrez-la. Si le problème continue, déconnectez-vous du compte dans l'application et reconnectez-vous avec votre adresse professionnelle.",
          at,
        },
      ],
      awaiting: true,
      account: false,
      status: "waiting_user",
    };
  }
  return { outcome: "shadow", messages: [{ id: id(), role: "notice", content: TEXTS.shadow, at }], awaiting: false, account: false, status: "waiting_technician" };
}

export function createDemoWidgetApi(opts: { latencyMs?: number } = {}): WidgetApi & EmployeeAuthApi {
  const latency = opts.latencyMs ?? 900;
  const convs = seed();
  const find = (cid: string) => {
    const c = convs.find((x) => x.id === cid);
    if (!c) throw new Error("introuvable");
    return c;
  };
  const snapshot = (c: DemoConv): Conversation => ({ ...c, messages: [...c.messages] });
  return {
    async context(): Promise<WidgetContext> {
      await wait(latency / 3);
      const until = new Date();
      until.setHours(8, 0, 0, 0);
      if (until.getTime() < now()) until.setDate(until.getDate() + 1);
      return {
        orgName: "Cabinet Alpha",
        brand: { name: "Nord Numérique" },
        user: { firstName: "Camille" },
        relief: { active: true, until: until.toISOString() },
        incidents: [{ id: "i-vpn", category: "vpn", since: iso(34) }],
        synthetic: true,
      };
    },
    async listRequests(): Promise<readonly RequestSummary[]> {
      await wait(latency / 2);
      return [...convs]
        .sort((a, b) => (a.messages.at(-1)?.at ?? "") < (b.messages.at(-1)?.at ?? "") ? 1 : -1)
        .map((c) => ({ id: c.id, title: c.title, status: c.status, updatedAt: c.messages.at(-1)?.at ?? iso(0), lastLine: c.messages.at(-1)?.content ?? "" }));
    },
    async conversation(cid: string): Promise<Conversation> {
      await wait(latency / 3);
      return snapshot(find(cid));
    },
    async send(cid: string | null, text: string, opts?: { direct?: boolean }): Promise<SendResult> {
      await wait(latency);
      let c: DemoConv;
      if (cid === null) {
        c = { id: id(), title: text.slice(0, 60), status: "open", messages: [], awaitingConfirmation: false, accountAction: false, satisfaction: null };
        convs.unshift(c);
      } else c = find(cid);
      c.messages.push({ id: id(), role: "user", content: text, at: new Date().toISOString() });
      if (c.status === "waiting_technician" && cid !== null) return { conversationId: c.id, outcome: "escalated", messages: [] }; // l'IA se tait
      if (opts?.direct) {
        const notice: ChatMessage = { id: id(), role: "notice", content: TEXTS.direct, at: new Date().toISOString() };
        c.messages.push(notice);
        c.status = "waiting_technician";
        return { conversationId: c.id, outcome: "escalated", messages: [notice] };
      }
      const r = reply(text);
      c.messages.push(...r.messages);
      c.awaitingConfirmation = r.awaiting;
      c.accountAction = c.accountAction || r.account;
      c.status = r.status;
      return { conversationId: c.id, outcome: r.outcome, messages: r.messages };
    },
    async escalate(cid: string): Promise<void> {
      await wait(latency / 2);
      const c = find(cid);
      if (c.status === "waiting_technician") return;
      c.status = "waiting_technician";
      c.awaitingConfirmation = false;
      c.messages.push({ id: id(), role: "notice", content: TEXTS.humanRequested, at: new Date().toISOString() });
    },
    async confirm(cid: string, worked: boolean): Promise<void> {
      await wait(latency / 3);
      const c = find(cid);
      c.awaitingConfirmation = false;
      c.status = worked ? "resolved" : "waiting_technician";
      if (!worked) c.messages.push({ id: id(), role: "notice", content: TEXTS.notWorked, at: new Date().toISOString() });
    },
    async rate(cid: string, score: 1 | 2 | 3 | 4 | 5): Promise<void> {
      await wait(latency / 4);
      find(cid).satisfaction = score;
    },
    async publicOrg(slug: string) {
      await wait(latency / 4);
      return slug === "cabinet-alpha" || slug === "client-alpha" ? { name: "Cabinet Alpha", brand: { name: "Nord Numérique" } } : null;
    },
    async resume(): Promise<boolean> {
      return false; // démonstration : chaque visite commence par l'écran de connexion
    },
    async requestCode(): Promise<void> {
      await wait(latency / 2);
    },
    async verifyCode(_slug: string, _email: string, code: string): Promise<boolean> {
      await wait(latency / 2);
      return /^\d{6}$/.test(code);
    },
    async signOut(): Promise<void> {},
  };
}
