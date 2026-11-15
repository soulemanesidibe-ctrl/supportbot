// AuthContext : la preuve, par le type ET à l'exécution, qu'une authentification (et, pour un utilisateur, une appartenance
// à une organisation) a été vérifiée pour CETTE requête. Seul auth.ts peut en fabriquer un (règle Semgrep
// releve-mint-context-outside-auth). Un objet qui ressemble à un AuthContext sans l'avoir été (littéral, copie par
// décomposition, JSON désérialisé) est refusé par isAuthContext.
import { Errors } from "./errors.ts";

export type OrgRole =
  | "super_admin"
  | "platform_support"
  | "partner_admin"
  | "partner_manager"
  | "partner_technician"
  | "org_admin"
  | "org_technician"
  | "org_viewer"
  | "auditor"
  | "end_user";

export const ORG_ROLES: readonly OrgRole[] = [
  "super_admin",
  "platform_support",
  "partner_admin",
  "partner_manager",
  "partner_technician",
  "org_admin",
  "org_technician",
  "org_viewer",
  "auditor",
  "end_user",
];

/** Par quelle voie la personne agit dans l'organisation (calculé par la base, jamais déclaré par le client). */
export type AccessVia = "member" | "partner" | "support_access";

export interface ContextFields {
  /** user : session humaine ; source : source d'alertes signée ; cron : tâche planifiée interne. */
  readonly kind: "user" | "source" | "cron";
  readonly userId: string | null;
  /** Organisation dans laquelle la requête agit. Nul seulement pour un utilisateur « nu » (requireUser) ou une tâche planifiée. */
  readonly orgId: string | null;
  readonly role: OrgRole | null;
  readonly via: AccessVia | null;
  /** Vrai pour un accès d'assistance : aucune écriture. */
  readonly readOnly: boolean;
  /** Organisation en arrêt d'urgence : plus aucune action ni réponse de l'IA. */
  readonly frozen: boolean;
  /** Le client a été activé par son administrateur (aucune action de niveau 1 avant). */
  readonly activated: boolean;
  readonly aal: "aal1" | "aal2" | null;
  /** Dernière vérification du second facteur, en secondes depuis 1970. */
  readonly mfaAt: number | null;
  readonly requestId: string;
}

declare const brand: unique symbol;
export type AuthContext = Readonly<ContextFields> & { readonly [brand]: "AuthContext" };

const MINTED = new WeakSet<object>();

/** RÉSERVÉ à auth.ts. Toute autre utilisation est refusée par Semgrep. */
export function mintContext(fields: ContextFields): AuthContext {
  const ctx = Object.freeze({ ...fields });
  MINTED.add(ctx);
  return ctx as unknown as AuthContext;
}

export function isAuthContext(x: unknown): x is AuthContext {
  return typeof x === "object" && x !== null && MINTED.has(x) && Object.isFrozen(x);
}

/** Refuse toute écriture pour un accès en lecture seule (accès d'assistance) ou une organisation gelée. */
export function assertCanWrite(auth: AuthContext): void {
  if (auth.readOnly) throw Errors.readOnly();
  if (auth.frozen) throw Errors.orgFrozen();
}

export function assertNotFrozen(auth: AuthContext): void {
  if (auth.frozen) throw Errors.orgFrozen();
}

export function assertActivated(auth: AuthContext): void {
  if (!auth.activated) throw Errors.notActivated();
}
