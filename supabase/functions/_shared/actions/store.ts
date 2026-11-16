// Implémentation Supabase du ActionStore. La base impose le circuit (déclencheur action_requests_guard) : ici on filtre toujours par
// organisation, on fait des écritures CONDITIONNELLES (jamais de lecture puis écriture séparées) et on traduit les refus de la base en
// motifs français sans jamais renvoyer le texte brut.
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { AppError, Errors } from "../errors.ts";
import { ActionRow, ActionStore, IdentityMethod, MicrosoftBinding, REJECT_REASONS, RejectReason } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const REJECT_LABELS: Readonly<Record<RejectReason, string>> = {
  mauvaise_cible: "Mauvaise cible",
  mauvais_perimetre: "Mauvais périmètre",
  identite_non_confirmee: "Identité non confirmée",
  autre: "Autre",
};

/** Traduit un refus du déclencheur de la base en motif français. Le texte brut de la base n'est jamais renvoyé. */
export function guardErrorMessage(dbMessage: string): string {
  const m = dbMessage.toLowerCase();
  if (m.includes("auto-validation") || m.includes("propre compte")) return "un valideur ne valide pas une action sur son propre compte";
  if (m.includes("vérification d'identité") || m.includes("verification d'identite")) return "la vérification d'identité hors bande est obligatoire";
  if (m.includes("empreinte")) return "l'action a changé depuis son affichage";
  if (m.includes("éligible") || m.includes("eligible")) return "vous n'êtes pas (ou plus) éligible pour cette validation";
  if (m.includes("délégation") || m.includes("delegation")) return "la délégation déclarée n'est pas valide";
  if (m.includes("expir")) return "la demande a expiré";
  if (m.includes("gelée") || m.includes("gelee")) return "l'organisation est en arrêt d'urgence";
  if (m.includes("transition") || m.includes("état final") || m.includes("etat final")) return "la demande n'est plus dans un état permettant cette opération";
  return "refusée par les contrôles de sécurité";
}

function refusal(dbMessage: string): AppError {
  return new AppError(403, "forbidden", `Opération refusée : ${guardErrorMessage(dbMessage)}.`);
}

function orgOf(auth: AuthContext): string {
  if (auth.orgId === null || auth.userId === null) throw Errors.forbidden();
  return auth.orgId;
}

async function load(auth: AuthContext, actionId: string, deps?: DbDeps): Promise<ActionRow | null> {
  const { data, error } = await serviceClient(auth, deps).from("action_requests")
    .select("id, org_id, conversation_id, capability, category, target_ref, params, params_hash, status, approver_id, approved_hash, approved_via_delegation_id, expires_at")
    .eq("id", actionId).eq("org_id", orgOf(auth)).maybeSingle();
  if (error) throw Errors.unavailable();
  return (data as ActionRow | null) ?? null;
}

async function insert(auth: AuthContext, row: { conversationId: string; capability: string; directoryUserId: string; riskFlags: readonly string[] }, deps?: DbDeps): Promise<{ id: string }> {
  const org = orgOf(auth);
  const db = serviceClient(auth, deps);
  const { data, error } = await db.from("action_requests").insert({
    org_id: org,
    conversation_id: row.conversationId,
    capability: row.capability,
    target_directory_user_id: row.directoryUserId,
    params: {},
    requested_by_kind: "agent",
    risk_flags: row.riskFlags,
  }).select("id").single();
  if (!error && data) return { id: (data as Row).id };
  if (error && (error as Row).code === "23505") {
    // Une demande identique est déjà ouverte (double envoi) : on la reprend, on n'en crée pas une seconde (M13).
    const open = await db.from("action_requests").select("id").eq("org_id", org).eq("conversation_id", row.conversationId).eq("capability", row.capability)
      .in("status", ["pending_approval", "approved", "executing"]).limit(1);
    const found = (open.data as Row[] | null)?.[0];
    if (found) return { id: found.id };
  }
  throw Errors.unavailable();
}

async function transition(auth: AuthContext, actionId: string, from: string, patch: Row, deps?: DbDeps): Promise<void> {
  // Écriture CONDITIONNELLE : « .eq(status, from) » + « select » : zéro ligne touchée = l'état avait changé (deux validations simultanées).
  const { data, error } = await serviceClient(auth, deps).from("action_requests").update(patch).eq("id", actionId).eq("org_id", orgOf(auth))
    .eq("status", from).select("id");
  if (error) throw refusal(String((error as Row).message ?? ""));
  if (!data || (data as Row[]).length === 0) throw Errors.conflict("Cette action a déjà été traitée.");
}

async function approve(auth: AuthContext, actionId: string, patch: { approvedHash: string; identityMethod: IdentityMethod; viaDelegationId: string | null }, deps?: DbDeps): Promise<void> {
  await transition(auth, actionId, "pending_approval", {
    status: "approved",
    approver_id: auth.userId,
    approved_hash: patch.approvedHash,
    // La vérification d'identité est enregistrée par le valideur LUI-MÊME : la base refuse sinon (SEC-12).
    identity_check: { method: patch.identityMethod, performed_by: auth.userId, at: new Date().toISOString() },
    approved_via_delegation_id: patch.viaDelegationId,
  }, deps);
}

async function markExecuting(auth: AuthContext, actionId: string, deps?: DbDeps): Promise<void> {
  await transition(auth, actionId, "approved", { status: "executing" }, deps);
}

async function finish(auth: AuthContext, actionId: string, status: "succeeded" | "failed" | "unknown", result: Record<string, unknown>, deps?: DbDeps): Promise<void> {
  await transition(auth, actionId, "executing", { status, result }, deps);
}

async function reject(auth: AuthContext, actionId: string, reason: RejectReason, deps?: DbDeps): Promise<void> {
  if (!REJECT_REASONS.includes(reason)) throw Errors.badRequest("Motif de refus invalide.");
  await transition(auth, actionId, "pending_approval", { status: "rejected", reason: REJECT_LABELS[reason] }, deps);
}

async function autonomyLevel(auth: AuthContext, category: string, deps?: DbDeps): Promise<number> {
  const { data, error } = await serviceClient(auth, deps).from("autonomy_settings").select("level").eq("org_id", orgOf(auth)).eq("category", category).maybeSingle();
  if (error) throw Errors.unavailable();
  const level = data ? Number((data as Row).level) : 0;
  return level === 1 ? 1 : 0; // le niveau 2 n'existe pas : toute autre valeur vaut 0
}

async function directoryUserFor(auth: AuthContext, conversationId: string, deps?: DbDeps): Promise<{ id: string; email: string } | null> {
  const org = orgOf(auth);
  const db = serviceClient(auth, deps);
  const { data, error } = await db.from("directory_users").select("id, email").eq("org_id", org).eq("linked_user_id", auth.userId).eq("active", true).maybeSingle();
  if (error) throw Errors.unavailable();
  if (!data) return null;
  // Rattache la conversation à la fiche de l'annuaire (une seule fois) : c'est ce rattachement que la base compare à la cible de l'action.
  const upd = await db.from("conversations").update({ directory_user_id: (data as Row).id }).eq("id", conversationId).eq("org_id", org)
    .eq("requester_user_id", auth.userId).is("directory_user_id", null);
  if (upd.error) throw Errors.unavailable();
  return { id: (data as Row).id, email: (data as Row).email };
}

async function recentRequestsOnTarget(auth: AuthContext, directoryUserId: string, hours: number, deps?: DbDeps): Promise<number> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { count, error } = await serviceClient(auth, deps).from("action_requests").select("id", { count: "exact", head: true })
    .eq("org_id", orgOf(auth)).eq("target_directory_user_id", directoryUserId).gte("created_at", since);
  if (error) throw Errors.unavailable();
  return count ?? 0;
}

async function microsoftBinding(auth: AuthContext, connectorId: string, deps?: DbDeps): Promise<MicrosoftBinding | null> {
  const org = orgOf(auth);
  const db = serviceClient(auth, deps);
  const ident = await db.from("microsoft_identities").select("object_id").eq("org_id", org).eq("user_id", auth.userId).eq("connector_id", connectorId)
    .is("revoked_at", null).maybeSingle();
  if (ident.error) throw Errors.unavailable();
  const conn = await db.from("connectors").select("tenant_id").eq("id", connectorId).eq("org_id", org).maybeSingle();
  if (conn.error) throw Errors.unavailable();
  const objectId = ident.data ? (ident.data as Row).object_id : null;
  const tenantId = conn.data ? (conn.data as Row).tenant_id : null;
  return typeof objectId === "string" && typeof tenantId === "string" ? { tenantId, objectId } : null;
}

export function supabaseActionStore(deps?: DbDeps): ActionStore {
  return {
    load: (auth, id) => load(auth, id, deps),
    insert: (auth, row) => insert(auth, row, deps),
    approve: (auth, id, patch) => approve(auth, id, patch, deps),
    markExecuting: (auth, id) => markExecuting(auth, id, deps),
    finish: (auth, id, status, result) => finish(auth, id, status, result, deps),
    reject: (auth, id, reason) => reject(auth, id, reason, deps),
    autonomyLevel: (auth, category) => autonomyLevel(auth, category, deps),
    directoryUserFor: (auth, conversationId) => directoryUserFor(auth, conversationId, deps),
    recentRequestsOnTarget: (auth, id, hours) => recentRequestsOnTarget(auth, id, hours, deps),
    microsoftBinding: (auth, connectorId) => microsoftBinding(auth, connectorId, deps),
  };
}
