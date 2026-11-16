// Gestes et lectures du salarié dans son widget (jalon J5.2). Tout est borné à SES demandes dans SON organisation : la fonction
// `chat` n'est ouverte qu'au rôle salarié (requireOrgMember), le store filtre par organisation ET demandeur, et la base le revérifie
// (fonctions de la migration 17). Aucune de ces opérations n'appelle le modèle.
//
// Ce que le salarié ne voit JAMAIS ici : un message réservé aux techniciens (mode ombre, note interne), le titre d'un incident
// (il peut reprendre le texte d'une alerte), la nature « suspecte » d'une demande sur un compte (décision du 16 novembre : la même
// réponse, le même état « avec un technicien », que la demande soit ordinaire ou suspecte).
import { AuthContext } from "../context.ts";
import { Errors } from "../errors.ts";
import { log } from "../log.ts";
import { CATEGORY_LABELS, TEXTS } from "./texts.ts";
import type { ChatPorts, ConversationRow, PublicMessage, WidgetMessageRow } from "./types.ts";

export const WIDGET_OPS = ["context", "list", "get", "escalate", "confirm", "rate"] as const;
export type WidgetOp = typeof WIDGET_OPS[number];

export type RequestStatus = "open" | "waiting_technician" | "waiting_user" | "resolved" | "closed";
const STATUSES: readonly RequestStatus[] = ["open", "waiting_technician", "waiting_user", "resolved", "closed"];
const CATEGORIES = Object.keys(CATEGORY_LABELS);
const LIST_LIMIT = 30;

/** État de la base vers l'état montré ; une valeur inconnue devient « en cours » (jamais « résolue » par erreur). */
export function statusOf(state: string): RequestStatus {
  return STATUSES.includes(state as RequestStatus) ? (state as RequestStatus) : "open";
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Titre d'une demande : les premiers mots du salarié (déjà masqués à l'enregistrement), sinon le nom de la catégorie. */
export function titleFrom(firstUserText: string | null, category: string | null): string {
  if (firstUserText && firstUserText.trim().length > 0) return oneLine(firstUserText, 80);
  return CATEGORY_LABELS[category ?? "other"] ?? CATEGORY_LABELS.other;
}

function writer(auth: AuthContext): void {
  if (auth.kind !== "user" || auth.orgId === null || auth.userId === null || auth.role !== "end_user") throw Errors.forbidden();
  if (auth.readOnly) throw Errors.readOnly();
}

// ---------------------------------------------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------------------------------------------
export async function widgetContext(auth: AuthContext, ports: ChatPorts) {
  const row = await ports.widget.context(auth);
  if (!row) throw Errors.forbidden(); // accès retiré entre la vérification et la lecture : même refus
  return {
    orgName: row.orgName,
    brand: row.accent ? { name: row.orgName, accent: row.accent } : { name: row.orgName },
    user: { firstName: row.firstName ?? "" },
    relief: row.reliefUntil ? { active: true, until: row.reliefUntil } : { active: false },
    incidents: row.incidents.map((i) => ({ id: i.id, category: CATEGORIES.includes(i.category) ? i.category : "other", since: i.since })),
    ai: true as const,
  };
}

export async function widgetList(auth: AuthContext, ports: ChatPorts) {
  const rows = await ports.widget.requests(auth, LIST_LIMIT);
  return {
    requests: rows.map((r) => ({
      id: r.id,
      title: titleFrom(r.title, r.category),
      status: statusOf(r.state),
      updatedAt: r.updatedAt,
      lastLine: r.lastLine ? oneLine(r.lastLine, 160) : "",
    })),
  };
}

const lastSpeaker = (messages: readonly WidgetMessageRow[]) =>
  [...messages].reverse().find((m) => m.role === "assistant" || m.role === "technician") ?? null;

export async function widgetGet(auth: AuthContext, conversationId: string, ports: ChatPorts) {
  const c = await ports.widget.conversation(auth, conversationId);
  if (!c) throw Errors.notFound();
  const status = statusOf(c.state);
  const last = c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
  return {
    id: c.id,
    title: titleFrom(c.messages.find((m) => m.role === "user")?.content ?? null, c.category),
    status,
    messages: c.messages.map((m) => ({
      id: m.id,
      role: m.role === "system" ? ("notice" as const) : m.role,
      content: m.content,
      at: m.at,
      ...(m.role === "technician" && m.author ? { authorName: m.author } : {}),
    })),
    // « Est-ce que ça a fonctionné ? » : une réponse (de l'IA ou d'un technicien) est le dernier mot et attend le salarié.
    awaitingConfirmation: status === "waiting_user" && last !== null && (last.role === "assistant" || last.role === "technician"),
    // Demande d'action sur le compte en attente d'un humain : lue dans le message fixe, identique ordinaire ou suspecte.
    accountAction: (status === "open" || status === "waiting_technician" || status === "waiting_user")
      && c.messages.some((m) => m.role === "system" && m.content === TEXTS.accountAction),
    satisfaction: c.satisfaction,
    ai: true as const,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Passage à un technicien (bouton, « Non, toujours pas », message direct) : état, ticket local, copie GLPI, message fixe
// ---------------------------------------------------------------------------------------------------------------
export async function handOff(
  auth: AuthContext,
  ports: ChatPorts,
  conv: Pick<ConversationRow, "id" | "category" | "state">,
  opts: { notice: string; reason: string; body: string },
): Promise<PublicMessage[]> {
  writer(auth);
  // Journal AVANT d'agir : si l'audit est indisponible, rien ne change et le salarié peut réessayer.
  await ports.audit(auth, { event: "chat.handoff", actorKind: "user", subjectType: "conversation", subjectId: conv.id, details: { reason: opts.reason } });
  // L'état d'abord : même si la suite échoue, la demande est dans la file des techniciens.
  await ports.store.updateConversation(auth, conv.id, {
    state: "waiting_technician",
    escalate: true,
    reopen: conv.state === "resolved" || conv.state === "closed",
  });
  const category = conv.category && CATEGORIES.includes(conv.category) ? conv.category : "other";
  const snippet = oneLine(opts.body, 100);
  const title = `${CATEGORY_LABELS[category]} : ${snippet.length >= 3 ? snippet : "demande du salarié"}`;
  const diagnostic = { reason: opts.reason };
  const { id: ticketId } = await ports.store.createTicket(auth, { conversationId: conv.id, title, category, priority: "normal", diagnostic, security: false });
  try {
    await ports.ticketing.mirror(auth, { ticketId, conversationId: conv.id, title, category, priority: "normal", body: opts.body, security: false, diagnostic });
  } catch (e) {
    log.warn("copie_ticket_en_echec", { erreur: e }); // le ticket local existe : un technicien le voit quoi qu'il arrive
  }
  const { id } = await ports.store.addMessage(auth, conv.id, { role: "notice", visibility: "public", content: opts.notice });
  return [{ id, role: "notice", content: opts.notice }];
}

async function userText(auth: AuthContext, conversationId: string, ports: ChatPorts): Promise<string> {
  const h = await ports.store.history(auth, conversationId, 20);
  return h.filter((m) => m.role === "user").map((m) => m.content).join("\n\n");
}

/** « Parler à un technicien » sur une demande existante. Idempotent : déjà chez un technicien = rien de plus. */
export async function widgetEscalate(auth: AuthContext, conversationId: string, ports: ChatPorts, why: "asked" | "not_worked" = "asked") {
  writer(auth);
  const conv = await ports.store.openConversation(auth, conversationId); // celle d'un autre salarié : introuvable
  if (conv.state === "waiting_technician") return { ok: true as const };
  await handOff(auth, ports, conv, {
    notice: why === "asked" ? TEXTS.humanRequested : TEXTS.notWorked,
    reason: why === "asked" ? "demande_du_salarie" : "solution_insuffisante",
    body: await userText(auth, conv.id, ports),
  });
  return { ok: true as const };
}

/** Réponse au « Est-ce que ça a fonctionné ? ». Oui : résolue (par Relève, ou par un humain s'il a répondu en dernier). Non : un technicien. */
export async function widgetConfirm(auth: AuthContext, conversationId: string, worked: boolean, ports: ChatPorts) {
  writer(auth);
  if (!worked) return await widgetEscalate(auth, conversationId, ports, "not_worked");
  const c = await ports.widget.conversation(auth, conversationId);
  if (!c) throw Errors.notFound();
  const last = lastSpeaker(c.messages);
  if (c.state !== "waiting_user" || last === null) throw Errors.conflict("Cette demande n'attend pas de confirmation.");
  // « Résolue par Relève » ne compte que si la dernière réponse venait de l'IA ET que le salarié confirme (docs/10 § 6).
  const resolution = last.role === "technician" ? "human" : "ai_confirmed";
  await ports.audit(auth, { event: "chat.confirmed", actorKind: "user", subjectType: "conversation", subjectId: c.id, details: { resolution } });
  if (!(await ports.widget.resolve(auth, c.id, resolution))) throw Errors.conflict("Cette demande n'attend plus de confirmation.");
  return { ok: true as const };
}

export async function widgetRate(auth: AuthContext, conversationId: string, score: unknown, ports: ChatPorts) {
  writer(auth);
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) throw Errors.badRequest("Note invalide.");
  const c = await ports.widget.conversation(auth, conversationId);
  if (!c) throw Errors.notFound();
  if (c.state !== "resolved" && c.state !== "closed") throw Errors.conflict("Une demande se note une fois résolue.");
  await ports.audit(auth, { event: "chat.rated", actorKind: "user", subjectType: "conversation", subjectId: c.id, details: { score } });
  if (!(await ports.widget.rate(auth, c.id, score as 1 | 2 | 3 | 4 | 5))) throw Errors.conflict("Une demande se note une fois résolue.");
  return { ok: true as const };
}
