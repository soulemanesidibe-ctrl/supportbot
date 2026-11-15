// Comptabilité et audit d'un appel au modèle : une ligne llm_usage (coût, jetons, délai) et une ligne d'audit « llm.call ».
// Le contenu des messages n'est JAMAIS enregistré ici : seulement le modèle, la version du prompt, les compteurs et les identifiants.
import { auditEvent } from "../audit.ts";
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import { log } from "../log.ts";
import { promptInfo } from "./prompt_registry.ts";
import type { CompletionResult, EmbeddingResult, LlmPurpose } from "./types.ts";

/** Tarifs en euros par million de jetons, par nom de modèle. À renseigner depuis la grille officielle de Mistral : voir docs. */
export type PriceTable = Record<string, { readonly inPerMTok: number; readonly outPerMTok: number }>;

export function estimateCostMicroEur(model: string, tokensIn: number, tokensOut: number, prices: PriceTable = {}): number {
  const p = prices[model];
  if (!p) return 0; // tarif inconnu : on n'invente pas un coût
  const eur = (tokensIn * p.inPerMTok + tokensOut * p.outPerMTok) / 1_000_000;
  return Math.max(0, Math.round(eur * 1_000_000));
}

export interface UsageRecord {
  readonly purpose: LlmPurpose | "embedding";
  readonly result: Pick<CompletionResult | EmbeddingResult, "model" | "latencyMs"> & { tokensIn: number; tokensOut?: number };
  readonly system?: string;
  readonly conversationId?: string;
  readonly attempts?: number;
  readonly prices?: PriceTable;
}

export async function recordLlmCall(auth: AuthContext, rec: UsageRecord, deps?: DbDeps): Promise<void> {
  if (!auth.orgId) throw Errors.forbidden();
  const tokensOut = rec.result.tokensOut ?? 0;
  const { error } = await serviceClient(auth, deps).from("llm_usage").insert({
    org_id: auth.orgId,
    model: rec.result.model.slice(0, 100),
    purpose: rec.purpose,
    tokens_in: rec.result.tokensIn,
    tokens_out: tokensOut,
    latency_ms: Math.max(0, Math.round(rec.result.latencyMs)),
    cost_micro_eur: estimateCostMicroEur(rec.result.model, rec.result.tokensIn, tokensOut, rec.prices),
  });
  // La comptabilité ne doit pas bloquer l'échange déjà fait : on le dit au journal technique, l'audit ci-dessous reste exigé.
  if (error) log.error("llm_usage_ecriture_impossible", { requestId: auth.requestId });
  const prompt = rec.system ? promptInfo(rec.system) : null;
  await auditEvent(auth, {
    event: "llm.call",
    actorKind: "agent",
    subjectType: rec.conversationId ? "conversation" : undefined,
    subjectId: rec.conversationId,
    details: {
      purpose: rec.purpose,
      model: rec.result.model,
      prompt_id: prompt?.id,
      prompt_version: prompt?.version,
      tokens_in: rec.result.tokensIn,
      tokens_out: tokensOut,
      latency_ms: Math.round(rec.result.latencyMs),
      attempts: rec.attempts ?? 1,
    },
  }, deps);
}

/** Journalise un appel qui a ÉCHOUÉ (sans contenu) : la nature de l'échec suffit à diagnostiquer. */
export async function recordLlmFailure(auth: AuthContext, purpose: LlmPurpose | "embedding", kind: string, deps?: DbDeps): Promise<void> {
  await auditEvent(auth, { event: "llm.failure", actorKind: "agent", details: { purpose, kind } }, deps);
}
