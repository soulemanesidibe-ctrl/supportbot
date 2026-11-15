// Contrat de la couche LLM. L'orchestrateur ne connaît que ces types : un autre fournisseur que Mistral se branche en
// implémentant LlmProvider, sans toucher au reste (docs/spec-mvp.md § 10.1).
import type { StaticPrompt } from "./prompt_registry.ts";

export type LlmPurpose = "triage" | "answer" | "eval";
export type Priority = "interactive" | "background";

/** Il n'y a volontairement PAS de rôle « system » ici : le prompt système est séparé, statique et enregistré. */
export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface CompletionRequest {
  readonly purpose: LlmPurpose;
  readonly system: StaticPrompt;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** Demande une sortie JSON (mode « json_object »). Le résultat reste une donnée à valider, jamais une instruction. */
  readonly json?: boolean;
  readonly priority?: Priority;
}

export interface CompletionResult {
  readonly text: string;
  /** Modèle réellement utilisé, tel que renvoyé par le fournisseur (traçabilité, comparaison Small et Medium en J6). */
  readonly model: string;
  readonly finishReason: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly latencyMs: number;
  /** Nombre de tentatives (1 = aucune reprise). */
  readonly attempts: number;
}

export interface EmbeddingResult {
  readonly vectors: number[][];
  readonly model: string;
  readonly tokensIn: number;
  readonly latencyMs: number;
}

export interface CallOptions {
  readonly signal: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest, opts: CallOptions): Promise<CompletionResult>;
  embed(texts: readonly string[], opts: CallOptions): Promise<EmbeddingResult>;
}

export type LlmErrorKind =
  | "rate_limited" // 429 : on reprend avec un délai croissant
  | "unavailable" // 5xx, réseau, délai dépassé : on reprend
  | "timeout"
  | "bad_request" // 4xx autre : on ne reprend jamais
  | "auth" // clé refusée : on ne reprend jamais
  | "invalid_response" // réponse du fournisseur incompréhensible ou hors contrat
  | "busy" // file d'attente trop longue ou disjoncteur ouvert : l'orchestrateur passe la main à un technicien
  | "config";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(kind: LlmErrorKind, message: string, extra: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = extra.status;
    this.retryAfterMs = extra.retryAfterMs;
  }
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "unavailable" || this.kind === "timeout";
  }
}
