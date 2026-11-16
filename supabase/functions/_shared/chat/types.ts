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

export interface ChatStore {
  /** Crée la conversation, ou charge celle de CET utilisateur dans CETTE organisation ; toute autre = introuvable. */
  openConversation(auth: AuthContext, conversationId: string | null): Promise<ConversationRow>;
  history(auth: AuthContext, conversationId: string, limit: number): Promise<ReadonlyArray<{ role: "user" | "assistant"; content: string }>>;
  updateConversation(
    auth: AuthContext,
    conversationId: string,
    patch: { category?: string; urgency?: "low" | "normal" | "high" | "urgent"; state?: "open" | "waiting_technician" | "waiting_user"; escalate?: boolean },
  ): Promise<void>;
  addMessage(auth: AuthContext, conversationId: string, m: MessageToStore): Promise<{ id: string }>;
  gateState(auth: AuthContext, category: string): Promise<GateState>;
  searchKb(auth: AuthContext, embedding: readonly number[], limit: number, minScore: number): Promise<readonly KbHit[]>;
  createTicket(auth: AuthContext, t: TicketToCreate): Promise<{ id: string }>;
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
}

export interface ChatInput {
  readonly conversationId: string | null;
  readonly message: string;
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
