// Fonction « console » : gestes du technicien sur une demande (jalon J5). Trois opérations, rien d'autre :
//   reply   {conversationId, text, internal?} : réponse au salarié (publique) ou note interne (visible des seuls techniciens) ;
//   take    {conversationId}                  : « je m'en occupe » (la demande lui est assignée) ;
//   resolve {conversationId}                  : demande close par l'équipe (résolution « par un humain »).
// Première instruction : l'authentification (requireOrgMember, rôles du personnel qui traitent les demandes, second facteur exigé
// par auth.ts). Le journal est écrit AVANT d'agir ; tout texte est masqué (secrets, données sensibles) avant d'être enregistré : un
// technicien ne colle jamais un mot de passe dans le fil, même par erreur (règle n° 2). Les validations d'actions sur un compte
// restent dans la fonction « actions », avec le jeton Microsoft du valideur.
import { AuthDeps, requireOrgMember, requestIdFrom } from "../auth.ts";
import type { AuditEvent } from "../audit.ts";
import { auditEvent } from "../audit.ts";
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { errorResponse, Errors } from "../errors.ts";
import { jsonResponse, readJsonBody } from "../http.ts";
import { sanitizeExternal } from "../llm/wrap.ts";
import type { Limiter } from "../ratelimit.ts";
import { redactText } from "../redact.ts";

const MAX_BODY_BYTES = 20_000;
export const MAX_REPLY_CHARS = 4000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Qui traite les demandes : techniciens de l'ESN ou du client, et l'administrateur du client (petite DSI d'une seule personne). */
export const HANDLERS = ["partner_technician", "org_technician", "org_admin"] as const;
const OPEN_STATES = ["open", "waiting_technician", "waiting_user"];

export interface ConsoleConversation { readonly id: string; readonly state: string; readonly assignedTo: string | null }

export interface ConsoleStore {
  /** Dans l'organisation du contexte seulement ; null sinon. */
  conversation(auth: AuthContext, id: string): Promise<ConsoleConversation | null>;
  addMessage(auth: AuthContext, id: string, m: { content: string; visibility: "public" | "technician"; redactions: number }): Promise<{ id: string }>;
  /** Écriture conditionnelle : seulement si l'état est l'un de `fromStates`. Faux si rien n'a changé. */
  update(
    auth: AuthContext,
    id: string,
    patch: { state?: "waiting_user" | "resolved"; assignedTo?: string; resolution?: "human" },
    fromStates: readonly string[],
  ): Promise<boolean>;
}

export interface ConsoleDeps {
  readonly store: ConsoleStore;
  readonly audit: (auth: AuthContext, ev: AuditEvent) => Promise<void>;
}

function idOf(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw Errors.badRequest("Conversation invalide.");
  return v;
}

async function load(auth: AuthContext, deps: ConsoleDeps, id: string): Promise<ConsoleConversation> {
  const c = await deps.store.conversation(auth, id);
  if (!c) throw Errors.notFound(); // autre organisation ou inexistante : même réponse
  return c;
}

export async function reply(auth: AuthContext, deps: ConsoleDeps, a: { conversationId: unknown; text: unknown; internal: unknown }) {
  if (auth.readOnly) throw Errors.readOnly();
  const id = idOf(a.conversationId);
  if (a.internal !== undefined && typeof a.internal !== "boolean") throw Errors.badRequest("Paramètre invalide.");
  if (typeof a.text !== "string") throw Errors.badRequest("Message invalide.");
  const raw = sanitizeExternal(a.text).trim();
  if (raw.length === 0 || raw.length > MAX_REPLY_CHARS) throw Errors.badRequest("Message vide ou trop long (4 000 caractères au plus).");
  const clean = redactText(raw);
  const internal = a.internal === true;
  const c = await load(auth, deps, id);
  await deps.audit(auth, { event: "console.reply", actorKind: "user", subjectType: "conversation", subjectId: id, details: { internal, masked: clean !== raw } });
  const { id: messageId } = await deps.store.addMessage(auth, id, { content: clean, visibility: internal ? "technician" : "public", redactions: clean === raw ? 0 : 1 });
  // Une réponse publique attend le salarié (« Est-ce que ça a fonctionné ? ») et la demande revient à qui a répondu, si personne ne l'a.
  if (!internal && OPEN_STATES.includes(c.state)) {
    await deps.store.update(auth, id, { state: "waiting_user", ...(c.assignedTo ? {} : { assignedTo: auth.userId as string }) }, OPEN_STATES);
  }
  return { id: messageId, masked: clean !== raw };
}

export async function take(auth: AuthContext, deps: ConsoleDeps, a: { conversationId: unknown }) {
  if (auth.readOnly) throw Errors.readOnly();
  const id = idOf(a.conversationId);
  const c = await load(auth, deps, id);
  if (c.assignedTo === auth.userId) return { ok: true as const };
  await deps.audit(auth, { event: "console.take", actorKind: "user", subjectType: "conversation", subjectId: id, details: { from_other: c.assignedTo !== null } });
  if (!(await deps.store.update(auth, id, { assignedTo: auth.userId as string }, OPEN_STATES))) throw Errors.conflict("Cette demande est déjà close.");
  return { ok: true as const };
}

export async function resolve(auth: AuthContext, deps: ConsoleDeps, a: { conversationId: unknown }) {
  if (auth.readOnly) throw Errors.readOnly();
  const id = idOf(a.conversationId);
  const c = await load(auth, deps, id);
  if (!OPEN_STATES.includes(c.state)) throw Errors.conflict("Cette demande est déjà close.");
  await deps.audit(auth, { event: "console.resolve", actorKind: "user", subjectType: "conversation", subjectId: id });
  if (!(await deps.store.update(auth, id, { state: "resolved", resolution: "human" }, OPEN_STATES))) throw Errors.conflict("Cette demande est déjà close.");
  return { ok: true as const };
}

export function createConsoleHandler(opts: { deps: () => ConsoleDeps; authDeps?: AuthDeps; limit: Limiter }): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    try {
      if (req.method !== "POST") throw Errors.methodNotAllowed();
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const auth = await requireOrgMember(req, typeof body.orgId === "string" ? body.orgId : "", HANDLERS, opts.authDeps);
      await opts.limit(auth);
      const deps = opts.deps();
      switch (body.op) {
        case "reply":
          return jsonResponse(200, await reply(auth, deps, { conversationId: body.conversationId, text: body.text, internal: body.internal }), auth.requestId);
        case "take":
          return jsonResponse(200, await take(auth, deps, { conversationId: body.conversationId }), auth.requestId);
        case "resolve":
          return jsonResponse(200, await resolve(auth, deps, { conversationId: body.conversationId }), auth.requestId);
        default:
          throw Errors.badRequest("Opération inconnue.");
      }
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Branchement Supabase : toujours borné à l'organisation du contexte.
// ---------------------------------------------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export function supabaseConsoleStore(db?: DbDeps): ConsoleStore {
  const org = (auth: AuthContext) => {
    if (auth.orgId === null || auth.userId === null) throw Errors.forbidden();
    return auth.orgId;
  };
  return {
    async conversation(auth: AuthContext, id: string) {
      const { data, error } = await serviceClient(auth, db).from("conversations").select("id, state, assigned_to").eq("id", id).eq("org_id", org(auth)).maybeSingle();
      if (error) throw Errors.unavailable();
      if (!data) return null;
      const d = data as Row;
      return { id: String(d.id), state: String(d.state), assignedTo: typeof d.assigned_to === "string" ? d.assigned_to : null };
    },
    async addMessage(auth: AuthContext, id: string, m: { content: string; visibility: "public" | "technician"; redactions: number }) {
      const { data, error } = await serviceClient(auth, db).from("messages").insert({
        conversation_id: id,
        org_id: org(auth),
        role: "technician",
        visibility: m.visibility,
        content: m.content,
        redactions: m.redactions,
        author_id: auth.userId,
      }).select("id").single();
      if (error || !data) throw Errors.unavailable();
      return { id: String((data as Row).id) };
    },
    async update(auth: AuthContext, id: string, patch: { state?: "waiting_user" | "resolved"; assignedTo?: string; resolution?: "human" }, fromStates: readonly string[]) {
      const row: Row = {};
      if (patch.state) row.state = patch.state;
      if (patch.assignedTo) row.assigned_to = patch.assignedTo;
      if (patch.resolution) {
        row.resolution = patch.resolution;
        row.resolved_at = new Date().toISOString();
      }
      const { data, error } = await serviceClient(auth, db).from("conversations").update(row).eq("id", id).eq("org_id", org(auth))
        .in("state", [...fromStates]).select("id");
      if (error) throw Errors.unavailable();
      return Array.isArray(data) && data.length === 1;
    },
  };
}

export function defaultConsoleDeps(): ConsoleDeps {
  return { store: supabaseConsoleStore(), audit: (auth, ev) => auditEvent(auth, ev) };
}
