// Banc de test de l'orchestrateur : base en mémoire, modèle scripté, comptabilité et audit capturés. Aucun réseau, aucune base.
import { AuditEvent } from "../audit.ts";
import { AuthContext } from "../context.ts";
import { CompletionRequest, CompletionResult, EmbeddingResult, LlmError } from "../llm/types.ts";
import { UsageRecord } from "../llm/usage.ts";
import type { ChatPorts, ChatStore, GateState, KbHit, MessageToStore, TicketToCreate } from "./types.ts";

export const DOC_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const DOC_B = "aaaaaaaa-0000-4000-8000-000000000002";

export const triageJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ intent: "incident", category: "printer", urgency: "normal", manipulation: false, confidence: 0.9, ...over });
export const answerJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ answer: "Redémarrez l'imprimante puis vérifiez le câble réseau.", knows: true, escalate: false, sources: [DOC_A], ...over });

export interface Rig {
  ports: ChatPorts;
  calls: { complete: CompletionRequest[]; embed: string[][] };
  messages: Array<MessageToStore & { id: string }>;
  tickets: TicketToCreate[];
  updates: Array<Record<string, unknown>>;
  usage: UsageRecord[];
  failures: Array<{ purpose: string; kind: string }>;
  audits: AuditEvent[];
  state: { gate: GateState | "throw"; hits: KbHit[]; messageCount: number; history: Array<{ role: "user" | "assistant"; content: string }> };
}

export interface RigScript {
  triage?: string | LlmError;
  answer?: string | LlmError;
  embed?: LlmError;
  gate?: GateState | "throw";
  hits?: KbHit[];
  messageCount?: number;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  openError?: Error;
  failAssistantPublic?: boolean;
  failAudit?: boolean;
}

export function makeRig(script: RigScript = {}): Rig {
  const calls = { complete: [] as CompletionRequest[], embed: [] as string[][] };
  const messages: Rig["messages"] = [];
  const tickets: TicketToCreate[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const usage: UsageRecord[] = [];
  const failures: Rig["failures"] = [];
  const audits: AuditEvent[] = [];
  const state: Rig["state"] = {
    gate: script.gate ?? "shadow",
    hits: script.hits ?? [{ documentId: DOC_A, title: "Imprimante hors ligne", text: "Vérifier l'alimentation et le réseau.", score: 0.8 }],
    messageCount: script.messageCount ?? 0,
    history: script.history ?? [],
  };
  let n = 0;
  const store: ChatStore = {
    openConversation: () => script.openError ? Promise.reject(script.openError) : Promise.resolve({ id: "conv-1", state: "open", category: null, messageCount: state.messageCount }),
    history: () => Promise.resolve(state.history),
    updateConversation: (_a, _id, patch) => { updates.push(patch as Record<string, unknown>); return Promise.resolve(); },
    addMessage: (_a, _id, m) => {
      if (script.failAssistantPublic && m.role === "assistant" && m.visibility === "public") return Promise.reject(new Error("Mode ombre : la catégorie n'est pas ouverte (SEC-19)"));
      const id = `msg-${++n}`;
      messages.push({ ...m, id });
      return Promise.resolve({ id });
    },
    gateState: () => state.gate === "throw" ? Promise.reject(new Error("base muette")) : Promise.resolve(state.gate),
    searchKb: () => Promise.resolve(state.hits),
    createTicket: (_a, t) => { tickets.push(t); return Promise.resolve({ id: `ticket-${tickets.length}` }); },
  };
  const result = (text: string): CompletionResult => ({ text, model: "mistral-test", finishReason: "stop", tokensIn: 100, tokensOut: 20, latencyMs: 250, attempts: 1 });
  const ports: ChatPorts = {
    llm: {
      complete: (req) => {
        calls.complete.push(req);
        const r = req.purpose === "triage" ? (script.triage ?? triageJson()) : (script.answer ?? answerJson());
        return r instanceof LlmError ? Promise.reject(r) : Promise.resolve(result(r));
      },
      embed: (texts) => {
        calls.embed.push([...texts]);
        if (script.embed) return Promise.reject(script.embed);
        return Promise.resolve({ vectors: [Array.from({ length: 1024 }, () => 0.01)], model: "embed-test", tokensIn: 8, latencyMs: 40 } satisfies EmbeddingResult);
      },
    },
    store,
    usage: {
      call: (_a, rec) => { usage.push(rec); return Promise.resolve(); },
      failure: (_a, purpose, kind) => { failures.push({ purpose, kind }); return Promise.resolve(); },
    },
    audit: (_a: AuthContext, ev: AuditEvent) => script.failAudit ? Promise.reject(new Error("audit indisponible")) : (audits.push(ev), Promise.resolve()),
  };
  return { ports, calls, messages, tickets, updates, usage, failures, audits, state };
}

export const publicTexts = (r: { messages: ReadonlyArray<{ content: string }> }): string[] => r.messages.map((m) => m.content);
