// Seul point d'accès à la clé service_role, qui CONTOURNE la sécurité par ligne. Deux entrées, aucune autre :
//   serviceClient(auth)      : exige un AuthContext authentique (fabriqué par auth.ts après vérification) ;
//   createAccessResolver()   : réservé à auth.ts, pour demander à la base « quel est le rôle de cet utilisateur ici ? ».
// Chaque requête porte l'acteur et l'identifiant de requête dans des en-têtes : la base les inscrit au journal d'audit
// (migration 11), seulement parce que la requête porte la clé service_role (un navigateur ne peut pas les faire croire).
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { AccessRow } from "./auth.ts";
import { AuthContext, isAuthContext } from "./context.ts";
import { Errors } from "./errors.ts";

type CreateClient = typeof createClient;

export interface DbDeps {
  createClient: CreateClient;
  url: () => string | undefined;
  serviceKey: () => string | undefined;
}

/**
 * Les clés « sb_secret_... » (nouvelle génération) arrivent dans SUPABASE_SECRET_KEYS, un dictionnaire JSON nommé ; les anciennes
 * clés « service_role » dans SUPABASE_SERVICE_ROLE_KEY, qui sera retirée (documentation Supabase, migration vers les nouvelles clés,
 * 15 novembre 2026). On lit la nouvelle d'abord, l'ancienne en repli ; jamais de valeur par défaut inventée.
 */
export function pickKey(dictionary: string | undefined, legacy: string | undefined, name = "default"): string | undefined {
  if (dictionary) {
    try {
      const parsed: unknown = JSON.parse(dictionary);
      const v = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[name] : undefined;
      if (typeof v === "string" && v.length > 0) return v;
    } catch {
      // dictionnaire illisible : on tente l'ancienne variable, sans journaliser la valeur
    }
  }
  return legacy || undefined;
}

const realDeps: DbDeps = {
  createClient,
  url: () => Deno.env.get("SUPABASE_URL"),
  serviceKey: () =>
    pickKey(
      // nosemgrep: releve-service-role-key-direct-use -- porte unique : cette lecture n'existe que dans db.ts, la clé ne sort jamais du module
      Deno.env.get("SUPABASE_SECRET_KEYS"),
      // nosemgrep: releve-service-role-key-direct-use -- porte unique : repli sur l'ancienne clé, lue seulement ici
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ),
};

function build(headers: Record<string, string>, deps: DbDeps): SupabaseClient {
  const url = deps.url();
  const key = deps.serviceKey();
  if (!url || !key) throw Errors.unavailable();
  return deps.createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers },
  });
}

/** Client service_role lié à UNE requête authentifiée. Refuse tout objet qui n'est pas un AuthContext fabriqué par auth.ts. */
export function serviceClient(auth: AuthContext, deps: DbDeps = realDeps): SupabaseClient {
  if (!isAuthContext(auth)) throw Errors.forbidden();
  // Un utilisateur doit avoir une organisation ET un rôle prouvés ; une source d'alertes une organisation ; seule une tâche
  // planifiée interne peut agir sans organisation.
  if (auth.kind === "user" && (auth.orgId === null || auth.role === null || auth.userId === null)) throw Errors.forbidden();
  if (auth.kind === "source" && auth.orgId === null) throw Errors.forbidden();
  const headers: Record<string, string> = { "x-releve-request-id": auth.requestId };
  if (auth.userId) headers["x-releve-actor"] = auth.userId;
  if (auth.orgId) headers["x-releve-org"] = auth.orgId;
  return build(headers, deps);
}

/**
 * Porte ÉTROITE pour une personne authentifiée qui n'est (encore) membre d'aucune organisation : elle n'obtient PAS de client de
 * service général (serviceClient le refuse), seulement l'appel de la fonction SQL qui accepte une invitation. Cette fonction vérifie
 * elle-même le jeton (empreinte), l'adresse e-mail confirmée, l'expiration et l'usage unique. L'identifiant de la personne est posé ICI,
 * à partir du contexte vérifié : l'appelant ne peut pas accepter une invitation « pour » quelqu'un d'autre.
 */
export async function acceptInvitationRpc(
  auth: AuthContext,
  a: { email: string; tokenHash: string },
  deps: DbDeps = realDeps,
): Promise<{ data: unknown; error: unknown }> {
  if (!isAuthContext(auth) || auth.kind !== "user" || auth.userId === null || auth.orgId !== null) throw Errors.forbidden();
  const client = build({ "x-releve-request-id": auth.requestId, "x-releve-actor": auth.userId }, deps);
  return await client.rpc("admin_accept_invitation", { p_user: auth.userId, p_email: a.email, p_token_hash: a.tokenHash });
}

/**
 * Porte ÉTROITE du limiteur de débit : incrémente un compteur (fonction SQL `rate_limit_hit`) pour une personne authentifiée, avec ou sans
 * organisation (une personne qui accepte une invitation n'en a pas), ou pour une source d'alertes signée. Elle ne lit ni n'écrit rien d'autre ; la clé est composée par le
 * limiteur à partir du contexte vérifié, jamais par une requête.
 */
export async function rateLimitRpc(
  auth: AuthContext,
  a: { key: string; windowSeconds: number; limit: number },
  deps: DbDeps = realDeps,
): Promise<{ data: unknown; error: unknown }> {
  if (!isAuthContext(auth)) throw Errors.forbidden();
  // Une personne authentifiée, ou une source d'alertes dont la signature a été vérifiée (avec son organisation).
  const person = auth.kind === "user" && auth.userId !== null;
  const source = auth.kind === "source" && auth.sourceId !== null && auth.orgId !== null;
  if (!person && !source) throw Errors.forbidden();
  const headers: Record<string, string> = { "x-releve-request-id": auth.requestId };
  if (auth.userId) headers["x-releve-actor"] = auth.userId;
  if (auth.orgId) headers["x-releve-org"] = auth.orgId;
  return await build(headers, deps).rpc("rate_limit_hit", { p_key: a.key, p_window_seconds: a.windowSeconds, p_limit: a.limit });
}

/**
 * RÉSERVÉ à auth_deps.ts (garde du webhook) : retrouve la source désignée dans l'adresse AVANT de savoir qui appelle, pour vérifier la
 * signature. La fonction SQL ne rend quelque chose que pour une source active, avec secret, d'une organisation non suspendue. Le secret
 * rendu ne sort pas de la garde (auth.ts), qui ne le renvoie jamais à l'appelant.
 */
export function createWebhookSourceResolver(deps: DbDeps = realDeps): (sourceId: string) => Promise<WebhookSourceRow | null> {
  return async (sourceId) => {
    const { data, error } = await build({}, deps).rpc("alert_source_for_webhook", { p_source: sourceId });
    if (error) throw Errors.unavailable();
    if (data === null || data === undefined) return null;
    if (typeof data !== "object" || Array.isArray(data)) throw Errors.unavailable();
    const r = data as Record<string, unknown>;
    if (typeof r.org_id !== "string" || typeof r.secret !== "string") return null;
    return {
      orgId: r.org_id,
      secret: r.secret,
      severityMap: r.severity_map,
      fieldMapping: r.field_mapping,
      frozen: r.frozen === true,
      activated: r.activated === true,
    };
  };
}

export interface WebhookSourceRow { orgId: string; secret: string; severityMap: unknown; fieldMapping: unknown; frozen: boolean; activated: boolean }

/** RÉSERVÉ à auth.ts : résout le rôle d'un utilisateur DÉJÀ authentifié (jeton vérifié) dans une organisation. */
export function createAccessResolver(deps: DbDeps = realDeps): (userId: string, orgId: string) => Promise<AccessRow | null> {
  return async (userId, orgId) => {
    const client = build({ "x-releve-actor": userId }, deps);
    const { data, error } = await client.rpc("resolve_access", { p_user: userId, p_org: orgId });
    if (error) throw Errors.unavailable();
    const row = Array.isArray(data) ? data[0] : null;
    return row ? (row as AccessRow) : null;
  };
}
