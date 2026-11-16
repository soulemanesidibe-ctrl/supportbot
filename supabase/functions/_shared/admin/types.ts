// Types de la fonction `admin` : liste FERMÉE d'opérations, magasin d'accès à la base (remplaçable dans les tests).
import { AuthContext, OrgRole } from "../context.ts";
import type { DbDeps } from "../db.ts";
import type { SecretPort } from "../connectors/secrets.ts";

/** Catégories d'action soumises à validation (niveau d'autonomie, délégations) : celles de private.approval_categories(). */
export const APPROVAL_CATEGORIES = ["accounts", "mailboxes", "licenses", "scripts", "tickets"] as const;
export type ApprovalCategory = typeof APPROVAL_CATEGORIES[number];

/** Les 11 catégories de demande des salariés (portes du mode ombre) : celles de private.categories(). */
export const SUPPORT_CATEGORIES = [
  "password", "mfa", "vpn", "printer", "outlook", "teams", "onedrive", "slow_pc", "onboarding", "offboarding", "other",
] as const;
export type SupportCategory = typeof SUPPORT_CATEGORIES[number];

export const GATE_STATES = ["shadow", "direct", "advice_only"] as const;
/** Règles que la démo exécute : `suspicious-reset` est verrouillée (code de l'orchestrateur), `m365-outage` attend le backlog B25. */
export const AUTOMATION_KEYS = ["incident-grouped", "incident-resolved", "source-silent"] as const;
export const AUTOMATION_STATES = ["active", "dry_run", "disabled"] as const;
export type GateState = typeof GATE_STATES[number];

/** Rôles qu'un client peut approuver pour son ESN (colonne approved_roles). */
export const APPROVABLE_PARTNER_ROLES = ["partner_admin", "partner_manager", "partner_technician"] as const;

/** Qui peut inviter quel rôle, dans SA propre organisation. Le reste est refusé, quel que soit le corps de la requête. */
export const INVITABLE: Readonly<Record<string, readonly OrgRole[]>> = {
  partner_admin: ["partner_admin", "partner_manager", "partner_technician"],
  org_admin: ["org_admin", "org_technician", "org_viewer", "auditor"],
};

export const ENVIRONMENTS = ["test", "production"] as const;

export interface RelationshipRef { id: string; expiresAt: string; approvedRoles: readonly string[] }

/** Toutes les écritures de la fonction `admin`. Chaque méthode filtre par l'organisation du contexte : jamais par un identifiant du corps seul. */
export interface AdminStore {
  createClient(auth: AuthContext, a: { name: string; slug: string; adminEmail: string; tokenHash: string }): Promise<{ clientOrgId: string; relationshipId: string; invitationId: string }>;
  createInvitation(auth: AuthContext, a: { email: string; role: OrgRole; tokenHash: string }): Promise<{ invitationId: string }>;
  acceptInvitation(auth: AuthContext, a: { email: string; tokenHash: string }): Promise<{ orgId: string; role: string }>;
  activateClient(auth: AuthContext): Promise<void>;
  activeRelationship(auth: AuthContext): Promise<RelationshipRef | null>;
  reduceRelationship(auth: AuthContext, roles: readonly string[]): Promise<void>;
  revokeRelationship(auth: AuthContext): Promise<void>;
  createAssignment(auth: AuthContext, a: { relationshipId: string; userId: string; endsAt: string }): Promise<{ assignmentId: string }>;
  revokeAssignment(auth: AuthContext, assignmentId: string): Promise<void>;
  offboardTechnician(auth: AuthContext, userId: string): Promise<Record<string, number>>;
  setFreeze(auth: AuthContext, frozen: boolean): Promise<{ cancelledActions: number }>;
  setAutonomy(auth: AuthContext, a: { category: ApprovalCategory; level: 0 | 1 }): Promise<void>;
  setCategoryState(auth: AuthContext, a: { category: SupportCategory; state: GateState; reason: string | null; override: boolean }): Promise<void>;
  /** Copie de la règle de la plateforme pour CETTE organisation, active, en simulation ou désactivée. */
  setAutomationState(auth: AuthContext, a: { key: typeof AUTOMATION_KEYS[number]; state: typeof AUTOMATION_STATES[number] }): Promise<void>;
  requestSupportAccess(auth: AuthContext, a: { clientOrgId: string; reason: string; durationMinutes: number }): Promise<{ grantId: string }>;
  approveSupportAccess(auth: AuthContext, grantId: string): Promise<void>;
  revokeSupportAccess(auth: AuthContext, grantId: string): Promise<void>;
  createDelegation(auth: AuthContext, a: { delegatorId: string; delegateId: string; categories: readonly ApprovalCategory[]; days: number }): Promise<{ delegationId: string }>;
  revokeDelegation(auth: AuthContext, a: { delegationId: string; ownOnly: boolean }): Promise<void>;
  qualifyConnector(auth: AuthContext, a: { connectorId: string; environment: typeof ENVIRONMENTS[number] }): Promise<void>;
  createConnector(auth: AuthContext, a: { type: "glpi"; name: string; baseUrl: string } | { type: "m365"; name: string; tenantId: string }): Promise<{ connectorId: string }>;
  /** Tenant d'un connecteur Microsoft 365 DE CETTE organisation, ou null. */
  microsoftTenantOf(auth: AuthContext, connectorId: string): Promise<string | null>;
  /** Lie le compte Microsoft (déjà vérifié par Microsoft) de la personne du contexte, et d'elle seule. */
  linkMicrosoftIdentity(auth: AuthContext, a: { connectorId: string; tenantId: string; objectId: string; upn: string }): Promise<void>;
  unlinkMicrosoftIdentity(auth: AuthContext, connectorId: string): Promise<void>;
  setConnectorStatus(auth: AuthContext, connectorId: string, a: { status: "ok" | "error"; error: string | null }): Promise<void>;
}

export interface AdminDeps {
  store: AdminStore;
  /** Jeton d'invitation à usage unique : valeur secrète (renvoyée UNE fois) et son empreinte (seule chose stockée). */
  newToken(): Promise<{ token: string; hash: string }>;
  nowMs(): number;
  /** Accès à la base pour le journal d'audit (remplaçable dans les tests). */
  db?: DbDeps;
  /** Coffre des secrets de connecteur (les jetons d'un nouveau connecteur y vont, jamais en configuration). */
  secrets: SecretPort;
  /** Test de connexion d'un connecteur de l'organisation. */
  connectors: { health(auth: AuthContext, connectorId: string): Promise<{ ok: boolean; detail?: string }> };
  /** Vérification d'un jeton délégué Microsoft par Microsoft lui-même (/me) : tenant, identifiant d'objet, nom d'utilisateur. */
  microsoft: { verify(token: string, tenantId: string): Promise<{ tenantId: string; objectId: string; upn: string }> };
  /** Domaines autorisés pour les serveurs de connecteurs (liste blanche facultative). */
  allowedHostSuffixes: readonly string[];
}
