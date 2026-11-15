// Registre des connecteurs : trouve, pour une organisation, le connecteur actif qui sait faire une capacité. Les connecteurs
// (GLPI, Microsoft 365, démo) s'enregistrent au jalon J4 par registerConnectorFactory ; sans fabrique, aucune capacité n'est disponible.
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import { CapabilityName, Connector } from "./types.ts";

export interface ConnectorRow {
  readonly id: string;
  readonly org_id: string;
  readonly type: string;
  readonly name: string;
  readonly environment: "test" | "production" | null;
  readonly status: string;
  readonly config: Record<string, unknown>;
  readonly tenant_id: string | null;
  readonly vault_secret_id: string | null;
}

export type ConnectorFactory = (row: ConnectorRow, auth: AuthContext) => Connector;

const factories = new Map<string, ConnectorFactory>();

export function registerConnectorFactory(type: string, factory: ConnectorFactory): void {
  factories.set(type, factory);
}

/** Pour les tests uniquement. */
export function clearConnectorFactories(): void {
  factories.clear();
}

export async function connectorFor(auth: AuthContext, name: CapabilityName, deps?: DbDeps): Promise<Connector> {
  if (auth.orgId === null) throw Errors.forbidden();
  const { data, error } = await serviceClient(auth, deps)
    .from("connectors")
    .select("id, org_id, type, name, environment, status, config, tenant_id, vault_secret_id")
    .eq("org_id", auth.orgId)
    .eq("status", "ok")
    .order("created_at", { ascending: true });
  if (error) throw Errors.unavailable();
  for (const row of (data ?? []) as ConnectorRow[]) {
    // Défense en profondeur : même si la requête se trompait d'organisation, un connecteur d'une autre organisation n'est jamais pris.
    if (row.org_id !== auth.orgId) continue;
    const factory = factories.get(row.type);
    if (!factory) continue;
    const connector = factory(row, auth);
    if (connector.capabilities().has(name)) return connector;
  }
  throw Errors.unavailable();
}
