// Fournisseur Mistral (La Plateforme, hébergement dans l'Union européenne). Contrat vérifié dans la documentation officielle
// (docs.mistral.ai, « Chat Completions » et « Embeddings », 15 novembre 2026) : POST /v1/chat/completions et /v1/embeddings,
// en-tête Authorization: Bearer, usage.prompt_tokens / usage.completion_tokens, choices[].finish_reason.
// La documentation ne décrit pas d'en-tête Retry-After : on le lit s'il existe, sinon la passerelle applique son délai croissant.
// Garde-fous : jamais de redirection (la clé ne doit pas partir ailleurs), hôte limité à *.mistral.ai, aucune donnée de la
// requête ni de la réponse dans les messages d'erreur, taille de réponse bornée.
import { CallOptions, CompletionRequest, CompletionResult, EmbeddingResult, LlmError, LlmProvider } from "./types.ts";

export const EMBEDDING_DIMENSION = 1024; // colonne kb_chunks.embedding vector(1024)
const MAX_RESPONSE_BYTES = 2_000_000;

export interface MistralConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelTriage: string;
  readonly modelAnswer: string;
  readonly modelEmbed: string;
}

export function validateBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new LlmError("config", "MISTRAL_BASE_URL invalide");
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || !(host === "mistral.ai" || host.endsWith(".mistral.ai"))) {
    throw new LlmError("config", "MISTRAL_BASE_URL doit être une adresse https de mistral.ai, sans identifiants");
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** Lit la configuration dans l'environnement. La clé n'est jamais journalisée ni renvoyée. */
export function mistralConfigFromEnv(): MistralConfig {
  const apiKey = Deno.env.get("MISTRAL_API_KEY");
  if (!apiKey) throw new LlmError("config", "MISTRAL_API_KEY absente");
  return {
    apiKey,
    baseUrl: validateBaseUrl(Deno.env.get("MISTRAL_BASE_URL") || "https://api.mistral.ai"),
    modelTriage: Deno.env.get("MISTRAL_MODEL_TRIAGE") || "mistral-small-latest",
    modelAnswer: Deno.env.get("MISTRAL_MODEL_ANSWER") || "mistral-medium-latest",
    modelEmbed: Deno.env.get("MISTRAL_MODEL_EMBED") || "mistral-embed",
  };
}

function parseRetryAfter(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 60_000);
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.min(Math.max(d - now, 0), 60_000) : undefined;
}

function statusToError(status: number, retryAfterMs: number | undefined): LlmError {
  const extra = { status, retryAfterMs };
  if (status === 401 || status === 403) return new LlmError("auth", `Clé refusée par le fournisseur (${status})`, extra);
  if (status === 429) return new LlmError("rate_limited", "Limite de débit du fournisseur (429)", extra);
  if (status === 408 || status >= 500) return new LlmError("unavailable", `Fournisseur indisponible (${status})`, extra);
  return new LlmError("bad_request", `Requête refusée par le fournisseur (${status})`, extra);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new LlmError("invalid_response", "Réponse du fournisseur trop volumineuse");
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError("invalid_response", "Réponse du fournisseur illisible");
  }
}

const wire = (role: "system" | "user" | "assistant", content: string) => ({ role, content });
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const toCount = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);

function contentToText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // Les modèles récents peuvent renvoyer une liste de morceaux ; seuls les morceaux de texte comptent.
    const parts = content.map((c) => (isRecord(c) && c.type === "text" && typeof c.text === "string" ? c.text : ""));
    return parts.join("");
  }
  return null;
}

export class MistralProvider implements LlmProvider {
  readonly name: string = "mistral";
  constructor(private readonly cfg: MistralConfig, private readonly fetchFn: typeof fetch = fetch) {}

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<{ json: unknown; ms: number }> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
        method: "POST",
        // Sans clé (accès anonyme d'un fournisseur compatible, voir ovh.ts), aucun en-tête d'autorisation n'est envoyé.
        headers: this.cfg.apiKey ? { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` } : { "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error", // la clé ne suit jamais une redirection
        signal,
      });
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new LlmError("timeout", "Délai dépassé");
      throw new LlmError("unavailable", "Fournisseur injoignable"); // jamais le détail réseau : il pourrait contenir l'URL
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw statusToError(res.status, parseRetryAfter(res.headers.get("retry-after")));
    }
    return { json: await readJson(res), ms: Date.now() - started };
  }

  async complete(req: CompletionRequest, opts: CallOptions): Promise<CompletionResult> {
    const model = req.purpose === "triage" ? this.cfg.modelTriage : this.cfg.modelAnswer;
    const body: Record<string, unknown> = {
      model,
      // req.system est un StaticPrompt déjà contrôlé par la passerelle (registre) : ici on ne fait que le mettre au format du fournisseur.
      messages: [wire("system", req.system), ...req.messages.map((m) => wire(m.role, m.content))],
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.2,
    };
    if (req.json) body.response_format = { type: "json_object" };
    const { json, ms } = await this.post("/v1/chat/completions", body, opts.signal);
    if (!isRecord(json) || !Array.isArray(json.choices) || !isRecord(json.choices[0])) {
      throw new LlmError("invalid_response", "Réponse du fournisseur hors contrat");
    }
    const choice = json.choices[0] as Record<string, unknown>;
    const text = isRecord(choice.message) ? contentToText(choice.message.content) : null;
    if (text === null) throw new LlmError("invalid_response", "Réponse du fournisseur sans texte");
    const usage = isRecord(json.usage) ? json.usage : {};
    return {
      text,
      model: typeof json.model === "string" ? json.model.slice(0, 100) : model,
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown",
      tokensIn: toCount(usage.prompt_tokens),
      tokensOut: toCount(usage.completion_tokens),
      latencyMs: ms,
      attempts: 1,
    };
  }

  async embed(texts: readonly string[], opts: CallOptions): Promise<EmbeddingResult> {
    const { json, ms } = await this.post("/v1/embeddings", { model: this.cfg.modelEmbed, input: texts }, opts.signal);
    if (!isRecord(json) || !Array.isArray(json.data) || json.data.length !== texts.length) {
      throw new LlmError("invalid_response", "Réponse d'embedding hors contrat");
    }
    const sorted = [...json.data].sort((a, b) => toCount(isRecord(a) ? a.index : 0) - toCount(isRecord(b) ? b.index : 0));
    const vectors: number[][] = sorted.map((d) => {
      const v = isRecord(d) ? d.embedding : null;
      // Une dimension inattendue casserait la recherche vectorielle (colonne vector(1024)) : on refuse plutôt que de stocker.
      if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSION || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
        throw new LlmError("invalid_response", "Vecteur d'embedding de dimension ou de contenu inattendu");
      }
      return v as number[];
    });
    const usage = isRecord(json.usage) ? json.usage : {};
    return { vectors, model: typeof json.model === "string" ? json.model.slice(0, 100) : this.cfg.modelEmbed, tokensIn: toCount(usage.prompt_tokens), latencyMs: ms };
  }
}
