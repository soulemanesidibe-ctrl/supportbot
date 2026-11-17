// Contrat des tableaux de bord (docs/10 § 5.2 et 5.4, docs/11 § 2 et 3). Uniquement des comptes, des médianes, des moyennes et
// des états : aucun texte de demande ni d'alerte (SEC-26). Chaque chiffre vient avec son effectif.
import type { StaffAuthApi } from "./console-types.ts";
import type { Category } from "./types.ts";

export type Gate = "shadow" | "direct" | "advice_only";

export interface SupportSummary {
  readonly conversations: number;
  readonly resolvedByReleve: number;
  readonly resolvedByTeam: number;
  readonly waitingTechnician: number;
  readonly waitingUser: number;
  readonly escalated: number;
  readonly duringRelief: number;
  readonly firstAnswerMedianSeconds: number | null;
  readonly firstAnswerN: number;
  readonly resolutionMedianMinutes: number | null;
  readonly resolutionN: number;
  readonly satisfactionAvg: number | null;
  readonly satisfactionN: number;
}

/** Notes des techniciens sur 90 jours (docs/11 § 2) et barres de passage calculées par la base. */
export interface CategoryQuality {
  readonly category: Category;
  readonly gate: Gate;
  readonly conversations: number;
  readonly answers: number;
  readonly correct: number;
  readonly partial: number;
  readonly wrong: number;
  readonly dangerous: number;
  readonly escalations: number;
  readonly escalationsJustified: number;
  readonly missedEscalations: number;
  readonly barsMet: boolean;
}

export interface OrgSummary {
  readonly days: number;
  readonly support: SupportSummary;
  readonly categories: readonly CategoryQuality[];
}

export interface PartnerClientRow {
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
  readonly labels: readonly string[];
  readonly orgState: "trial" | "pilot" | "active" | "suspended";
  readonly frozen: boolean;
  readonly activated: boolean;
  readonly relationshipStatus: "active" | "reduced";
  readonly relationshipExpiresAt: string;
  readonly reliefActive: boolean;
  readonly reliefUntil: string | null;
  readonly absences90d: number;
  readonly openIncidents: number;
  readonly majorIncidents: number;
  readonly pendingActions: number;
  readonly waitingTechnician: number;
  readonly slaAtRisk: number;
  readonly connectorsInError: number;
  readonly conversations30d: number;
  readonly resolvedByReleve30d: number;
  readonly satisfactionAvg30d: number | null;
  readonly satisfactionN30d: number;
  readonly assignedTechnicians: number;
  /** Ce que l'ESN facture à son client, et ce que Relève facture à l'ESN (centimes par mois) : jamais visibles du client. */
  readonly clientPriceCents: number | null;
  readonly partnerPriceCents: number | null;
}

export interface PartnerContext {
  readonly partnerId: string;
  readonly partnerName: string;
  readonly me: { readonly firstName: string };
  readonly synthetic: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Administrateur du client : « Mon support tient-il, et qui a accès à quoi ? »
// ---------------------------------------------------------------------------------------------------------------
export interface AdminContext {
  readonly orgId: string;
  readonly orgName: string;
  readonly frozen: boolean;
  readonly me: { readonly firstName: string };
  readonly synthetic: boolean;
}

export interface AccessOverview {
  readonly relationship: {
    readonly partnerName: string;
    readonly status: "active" | "reduced" | "suspended" | "proposed";
    readonly approvedRoles: readonly ("partner_admin" | "partner_manager" | "partner_technician")[];
    readonly expiresAt: string;
  } | null;
  readonly technicians: ReadonlyArray<{ readonly assignmentId: string; readonly name: string; readonly until: string }>;
  readonly delegations: ReadonlyArray<{ readonly id: string; readonly from: string; readonly to: string; readonly until: string; readonly categories: readonly string[] }>;
  readonly supportAccess: ReadonlyArray<{ readonly id: string; readonly reason: string; readonly approved: boolean; readonly until: string }>;
  readonly connectors: ReadonlyArray<{ readonly id: string; readonly name: string; readonly type: string; readonly status: "draft" | "ok" | "error" | "disabled"; readonly lastSyncAt: string | null }>;
  readonly autonomy: ReadonlyArray<{ readonly category: "accounts" | "tickets"; readonly level: 0 | 1 }>;
  readonly relief: ReadonlyArray<{ readonly kind: "absence" | "night" | "leave" | "on_call"; readonly startsAt: string; readonly endsAt: string; readonly who?: string }>;
}

export type AdminOp =
  | { readonly op: "relationship.revoke" }
  | { readonly op: "assignment.revoke"; readonly assignmentId: string }
  | { readonly op: "delegation.revoke"; readonly delegationId: string }
  | { readonly op: "support_access.revoke"; readonly grantId: string }
  | { readonly op: "support_access.approve"; readonly grantId: string }
  | { readonly op: "autonomy.set"; readonly category: "accounts" | "tickets"; readonly level: 0 | 1 }
  | { readonly op: "org.freeze" }
  | { readonly op: "org.unfreeze" }
  /** Ouvrir aux réponses directes (second facteur récent, barres atteintes) ou revenir au mode ombre (sans nouvelle vérification). */
  | { readonly op: "category.set_state"; readonly category: Category; readonly state: "direct" | "shadow" };

export interface DashboardApi extends StaffAuthApi {
  partner(): Promise<PartnerContext | null>;
  partnerClients(partnerId: string): Promise<readonly PartnerClientRow[]>;
  orgSummary(orgId: string, days: number): Promise<OrgSummary>;
  admin(): Promise<AdminContext | null>;
  access(orgId: string): Promise<AccessOverview>;
  /** Opération d'administration ; « mfa_required » : redemander le second facteur (stepUp) puis rejouer. */
  adminOp(orgId: string, op: AdminOp): Promise<void>;
  stepUp(code: string): Promise<boolean>;
}
