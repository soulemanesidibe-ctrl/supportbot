// Contrat de la console du technicien (docs/10 § 5.3 : « Quoi faire maintenant ? »). Deux implémentations : Supabase (lectures
// sous la sécurité par ligne avec second facteur, gestes par les fonctions console et actions) et démo (données fictives).
import type { Category } from "./types.ts";

export type Priority = "urgent" | "high" | "normal" | "low";

/** Ce qu'un élément de la file demande au technicien. */
export type QueueKind = "incident" | "approval" | "escalation" | "sla" | "waiting" | "prevention";

export interface ClientRef {
  readonly id: string;
  readonly name: string;
}

export interface QueueItem {
  /** Identifiant de l'élément dans la file : « <kind>:<id> ». */
  readonly key: string;
  readonly kind: QueueKind;
  readonly client: ClientRef;
  readonly title: string;
  /** Une ligne de contexte factuelle (diagnostic de Relève, nombre de demandes regroupées...). */
  readonly detail: string;
  readonly priority: Priority;
  /** Début de la situation (ouverture de l'incident, de la demande, de l'action). */
  readonly since: string;
  /** Référence du ticket dans l'outil du client (GLPI #48213). */
  readonly ticketRef?: string;
  readonly slaDueAt?: string;
  /** Ce que l'élément ouvre. */
  readonly target: { readonly type: "conversation" | "incident" | "approval"; readonly id: string };
}

export interface ConsoleContext {
  readonly me: { readonly firstName: string; readonly onCallUntil?: string };
  readonly clients: readonly ClientRef[];
  /** Délégations dont la personne est suppléante en ce moment (« Vous validez en tant que suppléant de Thomas »). */
  readonly actingFor: ReadonlyArray<{ readonly delegationId: string; readonly forName: string; readonly until: string; readonly clientId: string }>;
  readonly synthetic: boolean;
}

export type ConsoleRole = "user" | "assistant" | "notice" | "technician";
export type Rating = "correct" | "partial" | "wrong" | "dangerous";
export type RatingReason = "missing_source" | "wrong_version" | "out_of_scope" | "overconfident" | "should_have_escalated" | "other";

export interface ConsoleMessage {
  readonly id: string;
  readonly role: ConsoleRole;
  /** « technician » : visible des seuls techniciens (brouillon du mode ombre, note interne). */
  readonly visibility: "public" | "technician";
  readonly content: string;
  readonly at: string;
  readonly authorName?: string;
  /** Réponse préparée par l'IA : le technicien la note (docs/11 § 2). */
  readonly rateable: boolean;
  readonly myRating?: Rating;
}

export type ConversationState = "open" | "waiting_technician" | "waiting_user" | "resolved" | "closed";

export interface ConversationDetail {
  readonly id: string;
  readonly client: ClientRef;
  readonly title: string;
  readonly state: ConversationState;
  readonly category: Category | null;
  readonly requester: string;
  readonly openedAt: string;
  readonly reliefActive: boolean;
  readonly assignedToMe: boolean;
  readonly assignee?: string;
  readonly ticket?: { readonly ref: string; readonly priority: Priority; readonly slaDueAt?: string; readonly url?: string };
  readonly messages: readonly ConsoleMessage[];
}

export type IdentityMethod = "callback" | "manager_confirmation" | "in_person";
export type RejectReason = "mauvaise_cible" | "mauvais_perimetre" | "identite_non_confirmee" | "autre";

export interface ApprovalDetail {
  readonly id: string;
  readonly client: ClientRef;
  /** Capacité demandée (user.mfa_reregister, user.reset_password...). */
  readonly capability: string;
  /** Compte visé, tel qu'il sera passé à Microsoft. */
  readonly target: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  /** Empreinte des paramètres : ce que le valideur voit est exactement ce qui s'exécute (M12). */
  readonly paramsHash: string;
  /** Contexte factuel préparé par Relève (diagnostic, connexion habituelle, dernier changement). */
  readonly context: readonly string[];
  readonly riskFlags: readonly string[];
  readonly conversationId?: string;
  readonly identityRequired: boolean;
}

export interface TimelineEntry {
  readonly at: string;
  readonly kind: "alert" | "request" | "notice" | "action" | "resolution";
  readonly text: string;
}

export interface IncidentDetail {
  readonly id: string;
  readonly client: ClientRef;
  readonly title: string;
  readonly category: Category | null;
  readonly severity: "information" | "warning" | "major" | "critical";
  readonly state: "open" | "mitigated" | "resolved";
  readonly openedAt: string;
  readonly requests: number;
  readonly timeline: readonly TimelineEntry[];
}

/** « Pendant votre absence » : briefing de prise de garde. */
export interface AwaySummary {
  readonly since: string;
  readonly resolvedByReleve: number;
  readonly resolvedByTeam: number;
  readonly toApprove: number;
  readonly escalated: number;
  readonly watch: ReadonlyArray<{ readonly title: string; readonly client: ClientRef; readonly target: QueueItem["target"] }>;
}

export interface SearchHit {
  readonly kind: "client" | "conversation" | "incident" | "approval";
  readonly label: string;
  readonly hint: string;
  readonly client?: ClientRef;
  readonly target?: QueueItem["target"];
}

export interface ConsoleApi {
  context(): Promise<ConsoleContext>;
  queue(): Promise<readonly QueueItem[]>;
  away(): Promise<AwaySummary>;
  conversation(clientId: string, id: string): Promise<ConversationDetail>;
  reply(clientId: string, conversationId: string, text: string, internal: boolean): Promise<void>;
  take(clientId: string, conversationId: string): Promise<void>;
  resolve(clientId: string, conversationId: string): Promise<void>;
  rate(clientId: string, messageId: string, rating: Rating, reason?: RatingReason): Promise<void>;
  approval(clientId: string, id: string): Promise<ApprovalDetail>;
  /** Valide AVEC l'identité Microsoft du technicien (flux délégué) : l'action s'exécute avec ses droits, jamais ceux de l'IA. */
  approve(clientId: string, a: ApprovalDetail, identity: IdentityMethod, viaDelegationId?: string): Promise<{ outcome: string }>;
  reject(clientId: string, id: string, reason: RejectReason): Promise<void>;
  incident(clientId: string, id: string): Promise<IncidentDetail>;
  search(query: string): Promise<readonly SearchHit[]>;
}

/** Connexion du personnel : mot de passe puis second facteur (TOTP), obligatoire. */
export type StaffStep = "password" | "mfa_enroll" | "mfa_verify" | "done";

export interface StaffAuthApi {
  /** Reprise de session (cookie de la passerelle) : vrai si une session AVEC second facteur existe. */
  resume(): Promise<boolean>;
  password(email: string, password: string): Promise<{ ok: boolean; next?: Exclude<StaffStep, "password"> }>;
  /** Première connexion : secret TOTP à scanner (image et clé), une seule fois. */
  enroll(): Promise<{ factorId: string; qrSvg: string; secret: string }>;
  verify(factorId: string | null, code: string): Promise<boolean>;
  signOut(): Promise<void>;
}
