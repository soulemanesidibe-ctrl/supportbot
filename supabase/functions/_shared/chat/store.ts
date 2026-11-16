// Implémentation du ChatStore sur Supabase (clé de service, toujours bornée à l'organisation et à l'utilisateur de l'AuthContext).
// La sécurité ne repose PAS sur ce fichier : la base impose elle-même les invariants (déclencheurs : mode ombre, appartenance des
// messages, immutabilité) ; ici on se contente de toujours filtrer par organisation et d'appeler les fonctions prévues.
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import { EMBEDDING_DIMENSION } from "../llm/mistral.ts";
import type { ChatStore, ConversationRow, GateState, KbHit, MessageToStore, TicketToCreate } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Le port parle de « notice » (texte fixe ou note interne) ; la table messages l'enregistre avec son rôle « system ».
const DB_ROLE = { user: "user", assistant: "assistant", notice: "system" } as const;
const GATES: readonly GateState[] = ["shadow", "direct", "advice_only"];

function orgOf(auth: AuthContext): string {
  if (auth.orgId === null || auth.userId === null) throw Errors.forbidden();
  return auth.orgId;
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function openConversation(auth: AuthContext, conversationId: string | null, deps?: DbDeps): Promise<ConversationRow> {
  const org = orgOf(auth);
  const db = serviceClient(auth, deps);
  if (conversationId === null) {
    const { data, error } = await db.from("conversations").insert({ org_id: org, requester_user_id: auth.userId, channel: "widget" }).select("id, state, category").single();
    if (error || !data) throw Errors.unavailable();
    return { id: (data as Row).id, state: (data as Row).state, category: (data as Row).category ?? null, messageCount: 0 };
  }
  if (!UUID.test(conversationId)) throw Errors.badRequest("Conversation invalide.");
  // Filtré par organisation ET par demandeur : la conversation d'un autre salarié est « introuvable », comme une inexistante.
  const { data, error } = await db.from("conversations").select("id, state, category").eq("id", conversationId).eq("org_id", org)
    .eq("requester_user_id", auth.userId).maybeSingle();
  if (error) throw Errors.unavailable();
  if (!data) throw Errors.notFound();
  const { count, error: e2 } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("org_id", org);
  if (e2) throw Errors.unavailable();
  return { id: (data as Row).id, state: (data as Row).state, category: (data as Row).category ?? null, messageCount: count ?? 0 };
}

async function history(auth: AuthContext, conversationId: string, limit: number, deps?: DbDeps): Promise<ReadonlyArray<{ role: "user" | "assistant"; content: string }>> {
  const org = orgOf(auth);
  const { data, error } = await serviceClient(auth, deps).from("messages").select("role, visibility, content").eq("conversation_id", conversationId)
    .eq("org_id", org).in("role", ["user", "assistant"]).eq("visibility", "public").order("created_at", { ascending: false }).limit(limit);
  if (error) throw Errors.unavailable();
  return ((data ?? []) as Row[]).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));
}

async function updateConversation(
  auth: AuthContext,
  conversationId: string,
  patch: { category?: string; urgency?: "low" | "normal" | "high" | "urgent"; state?: "open" | "waiting_technician" | "waiting_user"; escalate?: boolean },
  deps?: DbDeps,
): Promise<void> {
  const org = orgOf(auth);
  const row: Row = {};
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.urgency !== undefined) row.urgency = patch.urgency;
  if (patch.state !== undefined) row.state = patch.state;
  if (patch.escalate) row.escalated_at = new Date().toISOString();
  if (Object.keys(row).length === 0) return;
  const { error } = await serviceClient(auth, deps).from("conversations").update(row).eq("id", conversationId).eq("org_id", org)
    .eq("requester_user_id", auth.userId);
  if (error) throw Errors.unavailable();
}

async function addMessage(auth: AuthContext, conversationId: string, m: MessageToStore, deps?: DbDeps): Promise<{ id: string }> {
  const org = orgOf(auth);
  const { data, error } = await serviceClient(auth, deps).from("messages").insert({
    conversation_id: conversationId,
    org_id: org,
    role: DB_ROLE[m.role],
    visibility: m.visibility,
    content: m.content,
    redactions: m.redactions ?? 0,
    author_id: null,
    model: m.model ?? null,
    prompt_version: m.promptVersion ?? null,
    latency_ms: m.latencyMs === undefined ? null : Math.round(m.latencyMs),
  }).select("id").single();
  if (error || !data) throw Errors.unavailable();
  return { id: (data as Row).id };
}

async function gateState(auth: AuthContext, category: string, deps?: DbDeps): Promise<GateState> {
  const org = orgOf(auth);
  const { data, error } = await serviceClient(auth, deps).from("category_gates").select("state").eq("org_id", org).eq("category", category).maybeSingle();
  if (error) throw Errors.unavailable();
  const s = data ? (data as Row).state : null;
  return GATES.includes(s) ? (s as GateState) : "shadow"; // pas de ligne ou valeur inconnue : mode ombre
}

async function searchKb(auth: AuthContext, embedding: readonly number[], limit: number, minScore: number, deps?: DbDeps): Promise<readonly KbHit[]> {
  const org = orgOf(auth);
  if (embedding.length !== EMBEDDING_DIMENSION || !embedding.every((n) => Number.isFinite(n))) throw Errors.internal();
  // La fonction filtre par organisation à l'intérieur ; on lui passe l'organisation de l'AuthContext, jamais une valeur du client.
  const { data, error } = await serviceClient(auth, deps).rpc("match_kb_chunks", {
    p_org: org,
    p_query: JSON.stringify(embedding),
    p_limit: limit,
    p_min_score: minScore,
  });
  if (error) throw Errors.unavailable();
  return ((data ?? []) as Row[]).map((r) => ({ documentId: String(r.document_id), title: String(r.title), text: String(r.content), score: Number(r.score) }));
}

async function createTicket(auth: AuthContext, t: TicketToCreate, deps?: DbDeps): Promise<{ id: string }> {
  const org = orgOf(auth);
  const db = serviceClient(auth, deps);
  // Un seul ticket ouvert par conversation : un deuxième message de la même conversation reprend le même ticket.
  const existing = await db.from("tickets").select("id").eq("conversation_id", t.conversationId).eq("org_id", org)
    .in("status", ["new", "open", "pending"]).limit(1);
  if (existing.error) throw Errors.unavailable();
  const found = (existing.data as Row[] | null)?.[0];
  if (found) return { id: found.id };
  const { data, error } = await db.from("tickets").insert({
    org_id: org,
    conversation_id: t.conversationId,
    title: t.title.slice(0, 300),
    category: t.category,
    priority: t.priority,
    diagnostic: t.diagnostic,
    created_by_ai: true,
    security: t.security,
  }).select("id").single();
  if (error || !data) throw Errors.unavailable();
  return { id: (data as Row).id };
}

export function supabaseChatStore(deps?: DbDeps): ChatStore {
  return {
    openConversation: (auth, id) => openConversation(auth, id, deps),
    history: (auth, id, limit) => history(auth, id, limit, deps),
    updateConversation: (auth, id, patch) => updateConversation(auth, id, patch, deps),
    addMessage: (auth, id, m) => addMessage(auth, id, m, deps),
    gateState: (auth, category) => gateState(auth, category, deps),
    searchKb: (auth, embedding, limit, minScore) => searchKb(auth, embedding, limit, minScore, deps),
    createTicket: (auth, t) => createTicket(auth, t, deps),
  };
}
