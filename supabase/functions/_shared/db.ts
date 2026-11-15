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

const realDeps: DbDeps = {
  createClient,
  url: () => Deno.env.get("SUPABASE_URL"),
  // nosemgrep: releve-service-role-key-direct-use -- porte unique : cette lecture n'existe que dans db.ts, la clé ne sort jamais du module
  serviceKey: () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
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
