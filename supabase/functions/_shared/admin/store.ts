// Implémentation Supabase du AdminStore. Règles : toute écriture est filtrée par l'organisation du CONTEXTE (jamais par un identifiant
// du corps seul) ; les écritures sont conditionnelles (zéro ligne touchée = conflit ou introuvable) ; les refus de la base sont traduits
// en messages français FIXES : le texte brut d'une erreur de base (table, contrainte, valeur) n'est jamais renvoyé.
import { AuthContext, OrgRole } from "../context.ts";
import { acceptInvitationRpc, DbDeps, serviceClient } from "../db.ts";
import { AppError, Errors } from "../errors.ts";
import { AdminStore, ApprovalCategory, GateState, RelationshipRef, SupportCategory } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const DAY_MS = 86_400_000;
const REFUSED = "Opération refusée par les contrôles de sécurité.";

/** Refus connus de la base (messages des fonctions de la migration 13 et des verrous), traduits en erreurs publiques fixes. */
const KNOWN_REFUSALS: ReadonlyArray<readonly [string, () => AppError]> = [
  ["second facteur", () => Errors.mfaRequired()],
  ["plafond de clients", () => Errors.conflict("Le plafond de clients de votre offre est atteint.")],
  ["organisation gelée", () => Errors.orgFrozen()],
  ["invitation invalide ou expirée", () => Errors.badRequest("Invitation invalide ou expirée.")],
  ["déjà membre", () => Errors.conflict("Vous êtes déjà membre de cette organisation.")],
  ["dernier administrateur", () => Errors.conflict("Impossible de retirer le dernier administrateur de l'organisation.")],
  ["rôles approuvés ne peuvent que diminuer", () => Errors.forbidden()],
  ["au moins un rôle", () => Errors.badRequest("Une relation active doit approuver au moins un rôle.")],
  ["n'est pas active", () => Errors.conflict("La relation avec l'ESN n'est pas active.")],
  ["n'a pas approuvé le rôle", () => Errors.conflict("Le client n'a pas approuvé ce rôle pour son ESN.")],
  ["technicien actif de l'esn", () => Errors.conflict("Cette personne n'est pas un technicien actif de l'ESN.")],
  ["dépasser la fin de la relation", () => Errors.conflict("Une assignation ne peut pas dépasser la fin de la relation.")],
  ["barres de passage", () => Errors.conflict("Les barres de passage ne sont pas atteintes : ouverture refusée sans décision motivée (20 caractères minimum).")],
  ["nouveau motif", () => Errors.badRequest("Un nouveau motif est obligatoire pour fermer ou réduire une catégorie.")],
  ["client non activé", () => Errors.notActivated()],
  ["niveau 1", () => Errors.conflict("Le niveau 1 exige un client activé, non gelé, une offre qui l'inclut et un connecteur Microsoft 365 qualifié.")],
  ["suppléant doit être", () => Errors.conflict("Le suppléant doit être un technicien déjà habilité dans cette organisation.")],
  ["ne détient pas directement", () => Errors.conflict("Vous ne pouvez déléguer que les validations que vous détenez directement.")],
  ["droits insuffisants", () => Errors.forbidden()],
  ["seul un administrateur", () => Errors.forbidden()],
  ["en attente pour", () => Errors.conflict("Une invitation est déjà en attente pour cette adresse et ce rôle.")],
];

/** Traduit une erreur de la base en erreur publique. Un code inconnu ou une panne donne « indisponible » (échec fermé). */
export function fail(error: unknown): AppError {
  const e = (error ?? {}) as Row;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (code === "23505") return Errors.conflict("Cet élément existe déjà.");
  if (code === "42501") return Errors.forbidden();
  if (code === "23503") return Errors.badRequest("Un élément référencé n'existe pas.");
  if (code === "23514" || code === "23502" || code === "22P02" || code === "22007") return Errors.badRequest("Valeurs refusées.");
  if (code === "P0001") {
    for (const [needle, make] of KNOWN_REFUSALS) if (message.includes(needle)) return make();
    return new AppError(403, "forbidden", REFUSED);
  }
  return Errors.unavailable();
}

function orgOf(auth: AuthContext): string {
  if (auth.orgId === null) throw Errors.forbidden();
  return auth.orgId;
}
function userOf(auth: AuthContext): string {
  if (auth.userId === null) throw Errors.forbidden();
  return auth.userId;
}
function mfaIso(auth: AuthContext): string {
  if (auth.mfaAt === null) throw Errors.mfaRequired();
  return new Date(auth.mfaAt * 1000).toISOString();
}
const nowIso = () => new Date().toISOString();

async function rpc(auth: AuthContext, fn: string, args: Row, deps?: DbDeps): Promise<Row> {
  const { data, error } = await serviceClient(auth, deps).rpc(fn, args);
  if (error) throw fail(error);
  if (!data || typeof data !== "object") throw Errors.unavailable();
  return data as Row;
}

/** Écriture conditionnelle : au moins une ligne doit avoir été touchée. */
function touched(data: unknown, none: AppError): void {
  if (!Array.isArray(data) || data.length === 0) throw none;
}

async function createClient(auth: AuthContext, a: { name: string; slug: string; adminEmail: string; tokenHash: string }, deps?: DbDeps) {
  const r = await rpc(auth, "admin_create_client", {
    p_actor: userOf(auth), p_partner_org: orgOf(auth), p_name: a.name, p_slug: a.slug, p_admin_email: a.adminEmail,
    p_token_hash: a.tokenHash, p_mfa_at: mfaIso(auth),
  }, deps);
  if (typeof r.client_org_id !== "string" || typeof r.relationship_id !== "string" || typeof r.invitation_id !== "string") throw Errors.unavailable();
  return { clientOrgId: r.client_org_id as string, relationshipId: r.relationship_id as string, invitationId: r.invitation_id as string };
}

async function createInvitation(auth: AuthContext, a: { email: string; role: OrgRole; tokenHash: string }, deps?: DbDeps) {
  const { data, error } = await serviceClient(auth, deps).from("invitations").insert({
    org_id: orgOf(auth), email: a.email, role: a.role, token_hash: a.tokenHash, invited_by: userOf(auth),
    expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
  }).select("id").single();
  if (error && (error as Row).code === "23505") throw Errors.conflict("Une invitation est déjà en attente pour cette adresse et ce rôle.");
  if (error || !data) throw error ? fail(error) : Errors.unavailable();
  return { invitationId: (data as Row).id as string };
}

async function acceptInvitation(auth: AuthContext, a: { email: string; tokenHash: string }, deps?: DbDeps) {
  const { data, error } = await acceptInvitationRpc(auth, a, deps);
  if (error) throw fail(error);
  const r = (data ?? {}) as Row;
  if (typeof r.org_id !== "string" || typeof r.role !== "string") throw Errors.unavailable();
  return { orgId: r.org_id as string, role: r.role as string };
}

async function activateClient(auth: AuthContext, deps?: DbDeps): Promise<void> {
  // Idempotent : un client déjà activé reste activé (la base interdit de le désactiver).
  const { error } = await serviceClient(auth, deps).from("organizations").update({ activated_at: nowIso() })
    .eq("id", orgOf(auth)).eq("type", "client").is("activated_at", null).select("id");
  if (error) throw fail(error);
}

async function activeRelationship(auth: AuthContext, deps?: DbDeps): Promise<RelationshipRef | null> {
  const { data, error } = await serviceClient(auth, deps).from("partner_relationships").select("id, expires_at, approved_roles")
    .eq("client_org_id", orgOf(auth)).in("status", ["active", "reduced"]).is("revoked_at", null).gt("expires_at", nowIso()).limit(1);
  if (error) throw Errors.unavailable();
  const row = (data as Row[] | null)?.[0];
  return row ? { id: row.id, expiresAt: row.expires_at, approvedRoles: row.approved_roles ?? [] } : null;
}

async function reduceRelationship(auth: AuthContext, roles: readonly string[], deps?: DbDeps): Promise<void> {
  const { data, error } = await serviceClient(auth, deps).from("partner_relationships").update({ approved_roles: roles, status: "reduced" })
    .eq("client_org_id", orgOf(auth)).in("status", ["active", "reduced"]).select("id");
  if (error) throw fail(error);
  touched(data, Errors.conflict("Aucune relation active à réduire."));
}

async function revokeRelationship(auth: AuthContext, deps?: DbDeps): Promise<void> {
  const { data, error } = await serviceClient(auth, deps).from("partner_relationships")
    .update({ status: "revoked", revoked_at: nowIso(), revoked_by: userOf(auth) })
    .eq("client_org_id", orgOf(auth)).in("status", ["proposed", "active", "reduced", "suspended"]).select("id");
  if (error) throw fail(error);
  touched(data, Errors.conflict("Aucune relation à révoquer."));
}

async function createAssignment(auth: AuthContext, a: { relationshipId: string; userId: string; endsAt: string }, deps?: DbDeps) {
  const db = serviceClient(auth, deps);
  // La relation doit être CELLE de ce client : on ne s'en remet pas à l'identifiant fourni par l'appelant.
  const rel = await db.from("partner_relationships").select("id").eq("id", a.relationshipId).eq("client_org_id", orgOf(auth)).limit(1);
  if (rel.error) throw Errors.unavailable();
  if (!Array.isArray(rel.data) || rel.data.length === 0) throw Errors.notFound();
  const { data, error } = await db.from("partner_assignments").insert({
    relationship_id: a.relationshipId, user_id: a.userId, role: "partner_technician", starts_at: nowIso(), ends_at: a.endsAt, created_by: userOf(auth),
  }).select("id").single();
  if (error || !data) throw error ? fail(error) : Errors.unavailable();
  return { assignmentId: (data as Row).id as string };
}

async function revokeAssignment(auth: AuthContext, assignmentId: string, deps?: DbDeps): Promise<void> {
  const db = serviceClient(auth, deps);
  const rels = await db.from("partner_relationships").select("id").eq("client_org_id", orgOf(auth));
  if (rels.error) throw Errors.unavailable();
  const ids = ((rels.data as Row[] | null) ?? []).map((r) => r.id as string);
  if (ids.length === 0) throw Errors.notFound();
  const { data, error } = await db.from("partner_assignments").update({ revoked_at: nowIso(), revoked_by: userOf(auth) })
    .eq("id", assignmentId).in("relationship_id", ids).is("revoked_at", null).select("id");
  if (error) throw fail(error);
  touched(data, Errors.notFound());
}

async function offboardTechnician(auth: AuthContext, userId: string, deps?: DbDeps): Promise<Record<string, number>> {
  const r = await rpc(auth, "admin_offboard_technician", { p_actor: userOf(auth), p_partner_org: orgOf(auth), p_user: userId }, deps);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === "number") out[k] = v;
  return out;
}

async function setFreeze(auth: AuthContext, frozen: boolean, deps?: DbDeps): Promise<{ cancelledActions: number }> {
  const r = await rpc(auth, "admin_set_freeze", { p_actor: userOf(auth), p_org: orgOf(auth), p_frozen: frozen }, deps);
  return { cancelledActions: typeof r.cancelled_actions === "number" ? r.cancelled_actions : 0 };
}

async function setAutonomy(auth: AuthContext, a: { category: ApprovalCategory; level: 0 | 1 }, deps?: DbDeps): Promise<void> {
  // Le niveau 1 porte le second facteur et l'auteur (la base les exige) ; le niveau 0 ne porte rien.
  const row: Row = { org_id: orgOf(auth), category: a.category, level: a.level, set_by: userOf(auth), set_at: nowIso(), mfa_verified_at: a.level === 1 ? mfaIso(auth) : null };
  const { error } = await serviceClient(auth, deps).from("autonomy_settings").upsert(row, { onConflict: "org_id,category" });
  if (error) throw fail(error);
}

async function setCategoryState(auth: AuthContext, a: { category: SupportCategory; state: GateState; reason: string | null; override: boolean }, deps?: DbDeps): Promise<void> {
  const { data, error } = await serviceClient(auth, deps).from("category_gates")
    .update({ state: a.state, changed_by: userOf(auth), reason: a.reason, override_insufficient_data: a.state === "direct" && a.override })
    .eq("org_id", orgOf(auth)).eq("category", a.category).select("org_id");
  if (error) throw fail(error);
  touched(data, Errors.notFound());
}

async function requestSupportAccess(auth: AuthContext, a: { clientOrgId: string; reason: string; durationMinutes: number }, deps?: DbDeps) {
  const { data, error } = await serviceClient(auth, deps).from("support_access_grants").insert({
    client_org_id: a.clientOrgId, requested_by: userOf(auth), reason: a.reason, duration_minutes: a.durationMinutes,
  }).select("id").single();
  if (error || !data) throw error ? fail(error) : Errors.unavailable();
  return { grantId: (data as Row).id as string };
}

async function approveSupportAccess(auth: AuthContext, grantId: string, deps?: DbDeps): Promise<void> {
  const db = serviceClient(auth, deps);
  const grant = await db.from("support_access_grants").select("id, duration_minutes").eq("id", grantId).eq("client_org_id", orgOf(auth))
    .is("approved_by", null).is("revoked_at", null).maybeSingle();
  if (grant.error) throw Errors.unavailable();
  if (!grant.data) throw Errors.notFound();
  const start = Date.now();
  const { data, error } = await db.from("support_access_grants").update({
    approved_by: userOf(auth), approved_at: new Date(start).toISOString(), starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + (grant.data as Row).duration_minutes * 60_000).toISOString(),
  }).eq("id", grantId).eq("client_org_id", orgOf(auth)).is("approved_by", null).select("id");
  if (error) throw fail(error);
  touched(data, Errors.conflict("Cette demande a déjà été traitée."));
}

async function revokeSupportAccess(auth: AuthContext, grantId: string, deps?: DbDeps): Promise<void> {
  const { data, error } = await serviceClient(auth, deps).from("support_access_grants").update({ revoked_at: nowIso(), revoked_by: userOf(auth) })
    .eq("id", grantId).eq("client_org_id", orgOf(auth)).is("revoked_at", null).select("id");
  if (error) throw fail(error);
  touched(data, Errors.notFound());
}

async function createDelegation(auth: AuthContext, a: { delegatorId: string; delegateId: string; categories: readonly ApprovalCategory[]; days: number }, deps?: DbDeps) {
  const { data, error } = await serviceClient(auth, deps).from("approval_delegations").insert({
    org_id: orgOf(auth), delegator_id: a.delegatorId, delegate_id: a.delegateId, categories: a.categories,
    ends_at: new Date(Date.now() + a.days * DAY_MS).toISOString(), created_by: userOf(auth), mfa_verified_at: mfaIso(auth),
  }).select("id").single();
  if (error || !data) throw error ? fail(error) : Errors.unavailable();
  return { delegationId: (data as Row).id as string };
}

async function revokeDelegation(auth: AuthContext, a: { delegationId: string; ownOnly: boolean }, deps?: DbDeps): Promise<void> {
  const uid = userOf(auth); // un UUID vérifié par requireUser : sûr dans le filtre ci-dessous
  let q = serviceClient(auth, deps).from("approval_delegations").update({ revoked_at: nowIso(), revoked_by: uid })
    .eq("id", a.delegationId).eq("org_id", orgOf(auth)).is("revoked_at", null);
  if (a.ownOnly) q = q.or(`delegator_id.eq.${uid},delegate_id.eq.${uid}`);
  const { data, error } = await q.select("id");
  if (error) throw fail(error);
  touched(data, Errors.notFound());
}

async function qualifyConnector(auth: AuthContext, a: { connectorId: string; environment: "test" | "production" }, deps?: DbDeps): Promise<void> {
  const { data, error } = await serviceClient(auth, deps).from("connectors")
    .update({ environment: a.environment, qualified_by: userOf(auth), qualified_at: nowIso() })
    .eq("id", a.connectorId).eq("org_id", orgOf(auth)).eq("type", "m365").select("id");
  if (error) throw fail(error);
  touched(data, Errors.notFound());
}

async function createConnector(auth: AuthContext, a: { type: "glpi"; name: string; baseUrl: string }, deps?: DbDeps) {
  // La configuration ne contient QUE l'adresse du serveur : la base refuse tout nom de clé qui ressemble à un secret.
  const { data, error } = await serviceClient(auth, deps).from("connectors").insert({
    org_id: orgOf(auth), type: a.type, name: a.name, status: "draft", config: { base_url: a.baseUrl },
  }).select("id").single();
  if (error && (error as Row).code === "23505") throw Errors.conflict("Un connecteur porte déjà ce nom.");
  if (error || !data) throw error ? fail(error) : Errors.unavailable();
  return { connectorId: (data as Row).id as string };
}

async function setConnectorStatus(auth: AuthContext, connectorId: string, a: { status: "ok" | "error"; error: string | null }, deps?: DbDeps): Promise<void> {
  const { data, error } = await serviceClient(auth, deps).from("connectors")
    .update({ status: a.status, last_error: a.error, last_sync_at: nowIso() })
    .eq("id", connectorId).eq("org_id", orgOf(auth)).select("id");
  if (error) throw fail(error);
  touched(data, Errors.notFound());
}

export function supabaseAdminStore(deps?: DbDeps): AdminStore {
  return {
    createClient: (auth, a) => createClient(auth, a, deps),
    createInvitation: (auth, a) => createInvitation(auth, a, deps),
    acceptInvitation: (auth, a) => acceptInvitation(auth, a, deps),
    activateClient: (auth) => activateClient(auth, deps),
    activeRelationship: (auth) => activeRelationship(auth, deps),
    reduceRelationship: (auth, roles) => reduceRelationship(auth, roles, deps),
    revokeRelationship: (auth) => revokeRelationship(auth, deps),
    createAssignment: (auth, a) => createAssignment(auth, a, deps),
    revokeAssignment: (auth, id) => revokeAssignment(auth, id, deps),
    offboardTechnician: (auth, userId) => offboardTechnician(auth, userId, deps),
    setFreeze: (auth, frozen) => setFreeze(auth, frozen, deps),
    setAutonomy: (auth, a) => setAutonomy(auth, a, deps),
    setCategoryState: (auth, a) => setCategoryState(auth, a, deps),
    requestSupportAccess: (auth, a) => requestSupportAccess(auth, a, deps),
    approveSupportAccess: (auth, id) => approveSupportAccess(auth, id, deps),
    revokeSupportAccess: (auth, id) => revokeSupportAccess(auth, id, deps),
    createDelegation: (auth, a) => createDelegation(auth, a, deps),
    revokeDelegation: (auth, a) => revokeDelegation(auth, a, deps),
    qualifyConnector: (auth, a) => qualifyConnector(auth, a, deps),
    createConnector: (auth, a) => createConnector(auth, a, deps),
    setConnectorStatus: (auth, id, a) => setConnectorStatus(auth, id, a, deps),
  };
}
