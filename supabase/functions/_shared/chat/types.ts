// Contrat du traitement d'un message du salarié. L'orchestrateur ne connaît que ces ports : base de données, modèle, comptabilité
// et audit sont injectés (tests sans réseau ni base), et la fonction `chat` branche les vraies implémentations.
import type { AuthContext } from "../context.ts";
import type { CompletionRequest, CompletionResult, EmbeddingResult, Priority } from "../llm/types.ts";
import type { UsageRecord } from "../llm/usage.ts";
import type { AuditEvent } from "../audit.ts";
import type { PrepareResult } from "../actions/prepare.ts";
import type { RequestedAction } from "../actions/types.ts";

export type GateState = "shadow" | "direct" | "advice_only";

export interface ConversationRow {
  readonly id: string;
  readonly state: string;
  readonly category: string | null;
  readonly messageCount: number;
}

export interface MessageToStore {
  /** « notice » : texte fixe ou note interne, enregistré avec le rôle « system » de la table messages (affichage, pas un message système du modèle). */
  readonly role: "user" | "assistant" | "notice";
  /** « public » : le salarié le voit. « technician » : visible des seuls techniciens (mode ombre, brouillon bloqué). */
  readonly visibility: "public" | "technician";
  readonly content: string;
  readonly redactions?: number;
  readonly model?: string;
  readonly promptVersion?: string;
  readonly latencyMs?: number;
}

export interface KbHit {
  readonly documentId: string;
  readonly title: string;
  readonly text: string;
  readonly score: number;
}

export interface TicketToCreate {
  readonly conversationId: string;
  readonly title: string;
  readonly category: string;
  readonly priority: "low" | "normal" | "high" | "urgent";
  readonly diagnostic: Record<string, unknown>;
  readonly security: boolean;
}

/** Copie d'un ticket local vers l'outil de ticketing de l'organisation (GLPI) : facultative, jamais bloquante. */
export interface MirrorTicket {
  readonly ticketId: string;
  readonly conversationId: string;
  readonly title: string;
  readonly category: string;
  readonly priority: "low" | "normal" | "high" | "urgent";
  /** Message du salarié, DÉJÀ masqué (secrets, données personnelles) : jamais le message brut. */
  readonly body: string;
  readonly security: boolean;
  readonly diagnostic: Record<string, unknown>;
}

export interface ChatStore {
  /** Crée la conversation, ou charge celle de CET utilisateur dans CETTE organisation ; toute autre = introuvable. */
  openConversation(auth: AuthContext, conversationId: string | null): Promise<ConversationRow>;
  history(auth: AuthContext, conversationId: string, limit: number): Promise<ReadonlyArray<{ role: "user" | "assistant"; content: string }>>;
  updateConversation(
    auth: AuthContext,
    conversationId: string,
    patch: {
      category?: string;
      urgency?: "low" | "normal" | "high" | "urgent";
      state?: "open" | "waiting_technician" | "waiting_user";
      escalate?: boolean;
      /** Demande rouverte (une clôture antérieure ne compte plus comme « résolue ») : efface la résolution et sa date. */
      reopen?: boolean;
    },
  ): Promise<void>;
  addMessage(auth: AuthContext, conversationId: string, m: MessageToStore): Promise<{ id: string }>;
  gateState(auth: AuthContext, category: string): Promise<GateState>;
  searchKb(auth: AuthContext, embedding: readonly number[], limit: number, minScore: number): Promise<readonly KbHit[]>;
  createTicket(auth: AuthContext, t: TicketToCreate): Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------------------------------------------
// Widget du salarié : ce qu'il voit de SES demandes (fonctions SQL réservées au service, migration 17)
// ---------------------------------------------------------------------------------------------------------------
export interface WidgetContextRow {
  readonly orgName: string;
  readonly accent: string | null;
  readonly firstName: string | null;
  /** Fin de la relève en cours (créneaux enchaînés), ou null si l'équipe est là. */
  readonly reliefUntil: string | null;
  /** Incidents majeurs ou critiques en cours : jamais leur titre. */
  readonly incidents: ReadonlyArray<{ readonly id: string; readonly category: string; readonly since: string }>;
}

export interface WidgetRequestRow {
  readonly id: string;
  readonly state: string;
  readonly category: string | null;
  readonly updatedAt: string;
  readonly title: string | null;
  readonly lastLine: string | null;
}

export interface WidgetMessageRow {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "technician";
  readonly content: string;
  readonly at: string;
  /** Prénom du technicien pour un message humain ; jamais son adresse. */
  readonly author: string | null;
}

export interface WidgetConversationRow {
  readonly id: string;
  readonly state: string;
  readonly category: string | null;
  readonly satisfaction: number | null;
  readonly resolution: string | null;
  /** Messages PUBLICS seulement, dans l'ordre. */
  readonly messages: readonly WidgetMessageRow[];
}

export interface WidgetStore {
  context(auth: AuthContext): Promise<WidgetContextRow | null>;
  requests(auth: AuthContext, limit: number): Promise<readonly WidgetRequestRow[]>;
  /** null : la demande n'existe pas POUR CE SALARIÉ (celle d'un autre est introuvable, comme une inexistante). */
  conversation(auth: AuthContext, conversationId: string): Promise<WidgetConversationRow | null>;
  /** Clôture confirmée par le salarié, seulement depuis « waiting_user ». Faux si l'état a changé entre-temps. */
  resolve(auth: AuthContext, conversationId: string, resolution: "ai_confirmed" | "human"): Promise<boolean>;
  /** Note de satisfaction, seulement sur une demande résolue ou close. Faux sinon. */
  rate(auth: AuthContext, conversationId: string, score: 1 | 2 | 3 | 4 | 5): Promise<boolean>;
}

export interface ChatPorts {
  readonly llm: {
    complete(req: CompletionRequest): Promise<CompletionResult>;
    embed(texts: readonly string[], priority?: Priority): Promise<EmbeddingResult>;
  };
  readonly store: ChatStore;
  readonly usage: {
    call(auth: AuthContext, rec: UsageRecord): Promise<void>;
    failure(auth: AuthContext, purpose: "triage" | "answer" | "embedding", kind: string): Promise<void>;
  };
  readonly audit: (auth: AuthContext, ev: AuditEvent) => Promise<void>;
  /** Préparation d'une action sur un compte : l'IA ne fait que préparer une demande que des humains valideront. */
  readonly actions: { prepare(auth: AuthContext, input: { conversationId: string; requested: RequestedAction }): Promise<PrepareResult> };
  /** Copie du ticket local vers GLPI. Une panne ne doit jamais empêcher un technicien de reprendre la conversation. */
  readonly ticketing: { mirror(auth: AuthContext, input: MirrorTicket): Promise<void> };
  /** Lectures et gestes du salarié dans son widget. */
  readonly widget: WidgetStore;
}

export interface ChatInput {
  readonly conversationId: string | null;
  readonly message: string;
  /** « Parler à un technicien » : le message va directement à un humain, sans aucun appel au modèle. */
  readonly direct?: boolean;
}

export interface PublicMessage {
  readonly id: string;
  readonly role: "assistant" | "notice";
  readonly content: string;
}

export type ChatOutcome = "answered" | "shadow" | "escalated" | "account_action" | "suspect" | "frozen";

export interface ChatResult {
  readonly conversationId: string;
  readonly outcome: ChatOutcome;
  readonly category: string | null;
  /** Ce que le salarié peut voir de cette réponse, et rien d'autre. */
  readonly messages: readonly PublicMessage[];
  /** Toujours vrai : l'interface affiche en permanence « Assistant IA » (AI Act, art. 50). */
  readonly ai: true;
}
