// Lectures et gestes du widget salarié sur Supabase. Les lectures passent par les fonctions SQL de la migration 17 (réservées au
// service, revérifiant que le demandeur est salarié actif) ; l'organisation et le demandeur viennent TOUJOURS de l'AuthContext,
// jamais de la requête. Les deux écritures (clôture confirmée, note) sont conditionnelles à l'état : la base ne change rien si la
// demande n'est pas dans l'état attendu (double clic, technicien qui a repris entre-temps).
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import type { WidgetContextRow, WidgetConversationRow, WidgetMessageRow, WidgetRequestRow, WidgetStore } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: ReadonlyArray<WidgetMessageRow["role"]> = ["user", "assistant", "system", "technician"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function scope(auth: AuthContext): { org: string; user: string } {
  // Seul un salarié a un widget ; le contrôle de rôle a déjà eu lieu (requireOrgMember), on le revérifie ici.
  if (auth.kind !== "user" || auth.orgId === null || auth.userId === null || auth.role !== "end_user") throw Errors.forbidden();
  return { org: auth.orgId, user: auth.userId };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function context(auth: AuthContext, deps?: DbDeps): Promise<WidgetContextRow | null> {
  const { org, user } = scope(auth);
  const { data, error } = await serviceClient(auth, deps).rpc("widget_context", { p_org: org, p_user: user });
  if (error) throw Errors.unavailable();
  if (data === null || typeof data !== "object") return null;
  const d = data as Row;
  if (typeof d.org_name !== "string") throw Errors.unavailable(); // forme inattendue : on ne devine pas
  const incidents = Array.isArray(d.incidents) ? (d.incidents as Row[]) : [];
  return {
    orgName: d.org_name,
    accent: str(d.accent),
    firstName: str(d.first_name),
    reliefUntil: str(d.relief_until),
    incidents: incidents
      .filter((i) => typeof i.id === "string" && typeof i.category === "string" && typeof i.since === "string")
      .map((i) => ({ id: i.id, category: i.category, since: i.since })),
  };
}

async function requests(auth: AuthContext, limit: number, deps?: DbDeps): Promise<readonly WidgetRequestRow[]> {
  const { org, user } = scope(auth);
  const { data, error } = await serviceClient(auth, deps).rpc("widget_requests", { p_org: org, p_user: user, p_limit: Math.max(1, Math.min(50, Math.floor(limit))) });
  if (error) throw Errors.unavailable();
  return ((data ?? []) as Row[])
    .filter((r) => typeof r.id === "string" && typeof r.state === "string")
    .map((r) => ({ id: r.id, state: r.state, category: str(r.category), updatedAt: String(r.updated_at), title: str(r.title), lastLine: str(r.last_line) }));
}

async function conversation(auth: AuthContext, conversationId: string, deps?: DbDeps): Promise<WidgetConversationRow | null> {
  const { org, user } = scope(auth);
  if (!UUID.test(conversationId)) throw Errors.badRequest("Conversation invalide.");
  const { data, error } = await serviceClient(auth, deps).rpc("widget_conversation", { p_org: org, p_user: user, p_conversation: conversationId });
  if (error) throw Errors.unavailable();
  if (data === null || typeof data !== "object") return null;
  const d = data as Row;
  const messages = Array.isArray(d.messages) ? (d.messages as Row[]) : [];
  return {
    id: String(d.id),
    state: String(d.state),
    category: str(d.category),
    satisfaction: typeof d.satisfaction === "number" ? d.satisfaction : null,
    resolution: str(d.resolution),
    messages: messages
      .filter((m) => typeof m.id === "string" && ROLES.includes(m.role) && typeof m.content === "string")
      .map((m) => ({ id: m.id, role: m.role, content: m.content, at: String(m.at), author: m.role === "technician" ? str(m.author) : null })),
  };
}

async function resolve(auth: AuthContext, conversationId: string, resolution: "ai_confirmed" | "human", deps?: DbDeps): Promise<boolean> {
  const { org, user } = scope(auth);
  if (!UUID.test(conversationId)) throw Errors.badRequest("Conversation invalide.");
  const { data, error } = await serviceClient(auth, deps).from("conversations")
    .update({ state: "resolved", resolution, resolved_at: new Date().toISOString() })
    .eq("id", conversationId).eq("org_id", org).eq("requester_user_id", user).eq("state", "waiting_user")
    .select("id");
  if (error) throw Errors.unavailable();
  return Array.isArray(data) && data.length === 1;
}

async function rate(auth: AuthContext, conversationId: string, score: 1 | 2 | 3 | 4 | 5, deps?: DbDeps): Promise<boolean> {
  const { org, user } = scope(auth);
  if (!UUID.test(conversationId)) throw Errors.badRequest("Conversation invalide.");
  if (![1, 2, 3, 4, 5].includes(score)) throw Errors.badRequest("Note invalide.");
  const { data, error } = await serviceClient(auth, deps).from("conversations")
    .update({ satisfaction: score })
    .eq("id", conversationId).eq("org_id", org).eq("requester_user_id", user).in("state", ["resolved", "closed"])
    .select("id");
  if (error) throw Errors.unavailable();
  return Array.isArray(data) && data.length === 1;
}

export function supabaseWidgetStore(deps?: DbDeps): WidgetStore {
  return {
    context: (auth) => context(auth, deps),
    requests: (auth, limit) => requests(auth, limit, deps),
    conversation: (auth, id) => conversation(auth, id, deps),
    resolve: (auth, id, resolution) => resolve(auth, id, resolution, deps),
    rate: (auth, id, score) => rate(auth, id, score, deps),
  };
}
