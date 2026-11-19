// Fait passer UN cas dans l'orchestrateur RÉEL (handleChatMessage), avec une base en mémoire. Deux modes :
//   - « réel » : le vrai modèle (passerelle LlmGateway + Mistral), chaque sortie est ENREGISTRÉE ;
//   - « rejeu » : les sorties enregistrées sont rejouées à l'identique, sans réseau (CI). Le seuil de similarité et les garde-fous
//     sont ceux du code ACTUEL : un changement de code se mesure donc sur les mêmes sorties du modèle.
// La porte de catégorie est forcée à « direct » : on mesure ce que le salarié recevrait si la catégorie était ouverte.
import { AuthContext } from "../_shared/context.ts";
import { handleChatMessage } from "../_shared/chat/orchestrator.ts";
import type { ChatPorts, KbHit, MessageToStore } from "../_shared/chat/types.ts";
import { parseTriage } from "../_shared/llm/schemas.ts";
import { CompletionRequest, CompletionResult, EmbeddingResult, LlmError, LlmErrorKind, Priority } from "../_shared/llm/types.ts";
import { redactText } from "../_shared/redact.ts";
import type { Fiche } from "./kb.ts";
import type { CallTrace, CaseRun, EvalCase, RecordedCall, RecordedCase } from "./types.ts";

const TOP_RECORDED = 8;

type Llm = ChatPorts["llm"];
type Search = (vector: readonly number[], limit: number, minScore: number) => Promise<KbHit[]>;

/** Cosinus, comme la fonction match_kb_chunks (1 - distance cosinus de pgvector). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const toHit = (f: Fiche, score: number): KbHit => ({ documentId: f.id, title: f.title, text: f.text, score });

/** Mode réel : appels enregistrés dans `rec`, recherche par cosinus sur les vecteurs des fiches (calculés comme en production). */
export function liveBackend(
  gateway: { complete(req: CompletionRequest): Promise<CompletionResult>; embed(texts: readonly string[], priority?: Priority): Promise<EmbeddingResult> },
  fiches: ReadonlyArray<{ fiche: Fiche; vector: readonly number[] }>,
  rec: { -readonly [K in keyof RecordedCase]: RecordedCase[K] },
): { llm: Llm; search: Search } {
  const llm: Llm = {
    async complete(req) {
      const purpose = req.purpose === "triage" ? "triage" : "answer";
      try {
        const r = await gateway.complete(req);
        rec[purpose] = { ok: true, text: r.text, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latencyMs: r.latencyMs };
        return r;
      } catch (e) {
        if (e instanceof LlmError) rec[purpose] = { ok: false, kind: e.kind };
        throw e;
      }
    },
    async embed(texts, priority) {
      try {
        const r = await gateway.embed(texts, priority);
        rec.embedModel = r.model;
        rec.embedLatencyMs = r.latencyMs;
        rec.embedTokens = r.tokensIn;
        return r;
      } catch (e) {
        if (e instanceof LlmError) rec.embedFailed = e.kind;
        throw e;
      }
    },
  };
  const search: Search = (vector, limit, minScore) => {
    const scored = fiches.map((f) => ({ fiche: f.fiche, score: cosine(vector, f.vector) })).sort((a, b) => b.score - a.score);
    rec.hits = scored.slice(0, TOP_RECORDED).map((s) => ({ doc: s.fiche.id, score: Math.round(s.score * 10_000) / 10_000 }));
    return Promise.resolve(scored.filter((s) => s.score >= minScore).slice(0, limit).map((s) => toHit(s.fiche, s.score)));
  };
  return { llm, search };
}

/** Mode rejeu : aucune requête réseau ; une sortie absente de l'enregistrement est traitée comme un modèle indisponible. */
export function replayBackend(rec: RecordedCase, fiches: readonly Fiche[]): { llm: Llm; search: Search } {
  const byId = new Map(fiches.map((f) => [f.id, f]));
  const replay = (call: RecordedCall | undefined): Promise<CompletionResult> => {
    if (!call) return Promise.reject(new LlmError("unavailable", "Sortie absente de l'enregistrement"));
    if (!call.ok) return Promise.reject(new LlmError(call.kind as LlmErrorKind, "Échec rejoué"));
    return Promise.resolve({ text: call.text, model: call.model, finishReason: "stop", tokensIn: call.tokensIn, tokensOut: call.tokensOut, latencyMs: call.latencyMs, attempts: 1 });
  };
  const llm: Llm = {
    complete: (req) => replay(req.purpose === "triage" ? rec.triage : rec.answer),
    embed: () =>
      rec.embedFailed
        ? Promise.reject(new LlmError(rec.embedFailed as LlmErrorKind, "Échec rejoué"))
        : Promise.resolve({ vectors: [[1]], model: rec.embedModel ?? "rejeu", tokensIn: rec.embedTokens ?? 0, latencyMs: rec.embedLatencyMs ?? 0 }),
  };
  const search: Search = (_v, limit, minScore) =>
    Promise.resolve(
      (rec.hits ?? [])
        .filter((h) => h.score >= minScore && byId.has(h.doc))
        .slice(0, limit)
        .map((h) => toHit(byId.get(h.doc) as Fiche, h.score)),
    );
  return { llm, search };
}

/** Exécute le cas et relève ce que le système a fait (texte montré au salarié, brouillon, sources, appels). */
export async function runCase(auth: AuthContext, c: EvalCase, backend: { llm: Llm; search: Search }): Promise<CaseRun> {
  const messages: Array<MessageToStore & { id: string }> = [];
  const calls: CallTrace[] = [];
  const audits: Array<{ event: string; details?: Record<string, unknown> }> = [];
  let triageText: string | null = null;
  let hitsSeen: Array<{ doc: string; score: number }> = [];
  let diagnostic: Record<string, unknown> = {};
  let n = 0;
  const llm: Llm = {
    async complete(req) {
      const r = await backend.llm.complete(req);
      if (req.purpose === "triage") triageText = r.text;
      return r;
    },
    embed: (texts, priority) => backend.llm.embed(texts, priority),
  };
  const ports: ChatPorts = {
    llm,
    store: {
      openConversation: () => Promise.resolve({ id: `conv-${c.id}`, state: "open", category: null, messageCount: (c.history?.length ?? 0) + 1 }),
      history: () => Promise.resolve((c.history ?? []).map((m) => ({ role: m.role, content: redactText(m.content) }))),
      updateConversation: () => Promise.resolve(),
      addMessage: (_a, _id, m) => {
        const id = `msg-${++n}`;
        messages.push({ ...m, id });
        return Promise.resolve({ id });
      },
      gateState: () => Promise.resolve("direct"),
      searchKb: async (_a, vector, limit, minScore) => {
        const hits = await backend.search(vector, limit, minScore);
        hitsSeen = hits.map((h) => ({ doc: h.documentId, score: h.score }));
        return hits;
      },
      createTicket: (_a, t) => {
        diagnostic = t.diagnostic;
        return Promise.resolve({ id: `ticket-${c.id}` });
      },
    },
    usage: {
      call: (_a, rec) => {
        calls.push({ purpose: rec.purpose === "embedding" ? "embedding" : rec.purpose === "triage" ? "triage" : "answer", model: rec.result.model, tokensIn: rec.result.tokensIn, tokensOut: rec.result.tokensOut ?? 0, latencyMs: rec.result.latencyMs });
        return Promise.resolve();
      },
      failure: (_a, purpose, kind) => {
        calls.push({ purpose, model: "", tokensIn: 0, tokensOut: 0, latencyMs: 0, failed: kind });
        return Promise.resolve();
      },
    },
    audit: (_a, ev) => {
      audits.push({ event: ev.event, details: ev.details as Record<string, unknown> | undefined });
      return Promise.resolve();
    },
    actions: { prepare: () => Promise.resolve({ status: "prepared", actionId: `action-${c.id}`, flags: [] }) },
    ticketing: { mirror: () => Promise.resolve() },
    widget: {
      context: () => Promise.reject(new Error("hors évaluation")),
      requests: () => Promise.reject(new Error("hors évaluation")),
      conversation: () => Promise.reject(new Error("hors évaluation")),
      resolve: () => Promise.reject(new Error("hors évaluation")),
      rate: () => Promise.reject(new Error("hors évaluation")),
    },
  };
  try {
    const result = await handleChatMessage(auth, { conversationId: null, message: c.message }, ports);
    const outcome = audits.find((a) => a.event === "chat.outcome")?.details ?? {};
    const t = triageText ? parseTriage(triageText) : null;
    const pub = messages.find((m) => m.role === "assistant" && m.visibility === "public");
    const draft = messages.find((m) => m.role === "assistant" && m.visibility === "technician");
    return {
      id: c.id,
      outcome: result.outcome,
      reason: typeof outcome.reason === "string" ? outcome.reason : null,
      triage: t ? { intent: t.intent, category: t.category, requestedAction: t.requestedAction, manipulation: t.manipulation, confidence: t.confidence } : null,
      publicAnswer: pub ? pub.content : null,
      draft: draft ? draft.content : null,
      // Sources citées : dans l'audit pour une réponse publique, dans le diagnostic du ticket pour un brouillon passé au technicien.
      sources: (Array.isArray(outcome.sources) ? outcome.sources : Array.isArray(diagnostic.sources) ? diagnostic.sources : []).map(String),
      hits: hitsSeen,
      calls,
    };
  } catch (e) {
    return { id: c.id, outcome: "error", reason: null, triage: null, publicAnswer: null, draft: null, sources: [], hits: hitsSeen, calls, error: e instanceof Error ? e.message : String(e) };
  }
}
