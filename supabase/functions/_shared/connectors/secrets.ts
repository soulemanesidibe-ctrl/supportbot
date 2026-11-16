// Lecture et écriture des secrets de connecteur (coffre Vault) par le service, via les fonctions SQL de la migration 14. Le secret n'est
// jamais journalisé, jamais renvoyé à un utilisateur, jamais conservé : il est lu à chaque appel et reste dans la mémoire de la requête.
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import { ConnectorHttpError } from "./http.ts";

export interface SecretPort {
  /** Secret du connecteur (organisation du contexte). Jette « unavailable » si la base ne répond pas, « config » s'il n'y en a pas. */
  get(auth: AuthContext, connectorId: string): Promise<string>;
  set(auth: AuthContext, connectorId: string, secret: string): Promise<void>;
}

export function supabaseSecretPort(deps?: DbDeps): SecretPort {
  return {
    get: (auth, connectorId) => getSecret(auth, connectorId, deps),
    set: (auth, connectorId, secret) => setSecret(auth, connectorId, secret, deps),
  };
}

async function getSecret(auth: AuthContext, connectorId: string, deps?: DbDeps): Promise<string> {
  if (auth.orgId === null) throw Errors.forbidden();
  const { data, error } = await serviceClient(auth, deps).rpc("connector_secret_get", { p_org: auth.orgId, p_connector: connectorId });
  if (error) throw new ConnectorHttpError("unavailable");
  if (typeof data !== "string" || data.length === 0) throw new ConnectorHttpError("config");
  return data;
}

async function setSecret(auth: AuthContext, connectorId: string, secret: string, deps?: DbDeps): Promise<void> {
  if (auth.orgId === null) throw Errors.forbidden();
  const { error } = await serviceClient(auth, deps).rpc("connector_secret_set", { p_org: auth.orgId, p_connector: connectorId, p_secret: secret });
  if (error) throw new ConnectorHttpError("unavailable");
}
