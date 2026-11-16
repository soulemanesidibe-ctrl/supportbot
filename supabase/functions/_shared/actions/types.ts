// Circuit des actions de niveau 1 (docs/spec-mvp.md § 9). L'IA PRÉPARE, un humain nommé VALIDE, l'action s'exécute avec l'identité de
// CE humain. La machine à états, l'empreinte, l'éligibilité du valideur et l'interdiction de s'auto-valider sont imposées PAR LA BASE
// (déclencheur action_requests_guard) : ce code ne les réécrit pas, il les respecte et traduit leurs refus.
import type { AuthContext } from "../context.ts";
import type { PrivilegedCapability } from "../capabilities/types.ts";

export type ActionStatus = "pending_approval" | "approved" | "executing" | "succeeded" | "failed" | "unknown" | "rejected" | "expired" | "cancelled";
export type IdentityMethod = "callback" | "manager_confirmation" | "in_person";
export const IDENTITY_METHODS: readonly IdentityMethod[] = ["callback", "manager_confirmation", "in_person"];

/** Ce que l'agent peut DEMANDER : une liste fermée, jamais une valeur libre venue d'un message. */
export type RequestedAction = "reset_password" | "unlock" | "revoke_sessions" | "mfa_reregister";
export const REQUESTED_ACTIONS: readonly RequestedAction[] = ["reset_password", "unlock", "revoke_sessions", "mfa_reregister"];
export const ACTION_CAPABILITY: Readonly<Record<RequestedAction, PrivilegedCapability>> = {
  reset_password: "user.reset_password",
  unlock: "user.unlock",
  revoke_sessions: "user.revoke_sessions",
  mfa_reregister: "user.mfa_reregister",
};

export const REJECT_REASONS = ["mauvaise_cible", "mauvais_perimetre", "identite_non_confirmee", "autre"] as const;
export type RejectReason = typeof REJECT_REASONS[number];

export interface ActionRow {
  readonly id: string;
  readonly org_id: string;
  readonly conversation_id: string | null;
  readonly capability: string;
  readonly category: string;
  readonly target_ref: string;
  readonly params: Record<string, unknown>;
  readonly params_hash: string;
  readonly status: ActionStatus;
  readonly approver_id: string | null;
  readonly approved_hash: string | null;
  readonly approved_via_delegation_id: string | null;
  readonly expires_at: string;
}

/** Liaison entre le compte Microsoft du valideur (lié une fois) et le locataire du connecteur : jamais de jeton stocké. */
export interface MicrosoftBinding {
  readonly tenantId: string;
  readonly objectId: string;
}

export interface ActionStore {
  load(auth: AuthContext, actionId: string): Promise<ActionRow | null>;
  /** Crée la demande (empreinte et cible calculées par la base). Renvoie l'identifiant, ou celui de la demande ouverte identique. */
  insert(auth: AuthContext, row: { conversationId: string; capability: string; directoryUserId: string; riskFlags: readonly string[] }): Promise<{ id: string }>;
  approve(
    auth: AuthContext,
    actionId: string,
    patch: { approvedHash: string; identityMethod: IdentityMethod; viaDelegationId: string | null },
  ): Promise<void>;
  /** Passage atomique « approved » vers « executing » : la base revérifie l'éligibilité du valideur (I5). */
  markExecuting(auth: AuthContext, actionId: string): Promise<void>;
  finish(auth: AuthContext, actionId: string, status: "succeeded" | "failed" | "unknown", result: Record<string, unknown>): Promise<void>;
  reject(auth: AuthContext, actionId: string, reason: RejectReason): Promise<void>;
  autonomyLevel(auth: AuthContext, category: string): Promise<number>;
  /** Rattache la conversation à la fiche d'annuaire du salarié (une seule fois) ; null si le salarié n'est pas dans l'annuaire. */
  directoryUserFor(auth: AuthContext, conversationId: string): Promise<{ id: string; email: string } | null>;
  recentRequestsOnTarget(auth: AuthContext, directoryUserId: string, hours: number): Promise<number>;
  microsoftBinding(auth: AuthContext, connectorId: string): Promise<MicrosoftBinding | null>;
}

/** Un connecteur signale ce qu'il SAIT : « failed » (échec certain, rien n'a eu lieu) ou « unknown » (issue incertaine : jamais rejouée seule). */
export class ConnectorError extends Error {
  readonly outcome: "failed" | "unknown";
  constructor(outcome: "failed" | "unknown", message: string) {
    super(message);
    this.name = "ConnectorError";
    this.outcome = outcome;
  }
}

export interface ActionOutcome {
  readonly actionId: string;
  readonly status: "succeeded" | "failed" | "unknown";
}
