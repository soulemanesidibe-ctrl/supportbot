// Passerelle LLM : tout appel au modèle passe par ici. Elle ajoute ce que le fournisseur ne garantit pas :
//   - validation de la requête (prompt système enregistré, rôles, tailles, plafonds de coût) ;
//   - cadence (l'offre gratuite de Mistral limite à environ 1 requête par seconde et par modèle) et concurrence bornées ;
//   - file d'attente à deux priorités (conversation avant tâches de fond), avec échéance : au-delà, « busy » et l'orchestrateur
//     transmet à un technicien plutôt que de faire attendre indéfiniment (docs/spec-mvp.md § 10.1) ;
//   - reprises avec délai croissant et fluctuation aléatoire sur 429, 5xx et délai dépassé ; jamais sur une erreur de requête ou d'authentification ;
//   - disjoncteur : après plusieurs échecs de suite, on cesse d'insister pendant un moment.
// Limite assumée : la file vit dans UNE instance de la fonction. Plusieurs instances simultanées se partagent le quota du fournisseur
// sans se coordonner ; le 429 + délai croissant absorbe cet écart au volume d'un pilote. Une file partagée en base viendra si le volume l'exige.
import { isStaticPrompt } from "./prompt_registry.ts";
import { CompletionRequest, CompletionResult, EmbeddingResult, LlmError, LlmProvider, Priority } from "./types.ts";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: () => Math.random(),
};

export interface GatewayOptions {
  /** Écart minimal entre deux débuts d'appel (ms). 1 100 pour l'offre gratuite de Mistral. */
  minIntervalMs: number;
  maxConcurrent: number;
  /** Attente maximale avant qu'un appel PUISSE partir, reprises comprises (ms). */
  queueDeadlineMs: Record<Priority, number>;
  /** Durée maximale d'un appel parti (ms). */
  attemptTimeoutMs: Record<Priority, number>;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
}

export const DEFAULT_OPTIONS: GatewayOptions = {
  minIntervalMs: 1100,
  maxConcurrent: 2,
  queueDeadlineMs: { interactive: 10_000, background: 120_000 },
  attemptTimeoutMs: { interactive: 30_000, background: 90_000 },
  maxAttempts: 3,
  backoffBaseMs: 1000,
  backoffCapMs: 30_000,
  breakerThreshold: 5,
  breakerCooldownMs: 30_000,
  maxInputChars: 24_000,
  maxOutputTokens: 2048,
};

interface Waiter {
  priority: Priority;
  deadline: number;
  resolve: () => void;
  reject: (e: LlmError) => void;
}

export class LlmGateway {
  private readonly opts: GatewayOptions;
  private waiters: Waiter[] = [];
  private inFlight = 0;
  private nextStartAt = 0;
  private pumping = false;
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(private readonly provider: LlmProvider, opts: Partial<GatewayOptions> = {}, private readonly clock: Clock = realClock) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  /** Nombre d'appels en attente (pour l'observabilité et les tests). */
  get queued(): number {
    return this.waiters.length;
  }

  private validate(req: CompletionRequest): void {
    if (!isStaticPrompt(req.system)) throw new LlmError("bad_request", "Le message système doit être un prompt statique enregistré");
    if (!Array.isArray(req.messages) || req.messages.length === 0 || req.messages.length > 40) {
      throw new LlmError("bad_request", "Nombre de messages invalide");
    }
    let chars = (req.system as string).length;
    for (const m of req.messages) {
      if ((m.role as string) !== "user" && (m.role as string) !== "assistant") {
        throw new LlmError("bad_request", "Rôle de message interdit : seuls user et assistant, le prompt système est séparé");
      }
      if (typeof m.content !== "string" || m.content.length === 0) throw new LlmError("bad_request", "Message vide");
      chars += m.content.length;
    }
    if (chars > this.opts.maxInputChars) throw new LlmError("bad_request", "Entrée trop volumineuse");
    if (!Number.isInteger(req.maxTokens) || req.maxTokens < 1 || req.maxTokens > this.opts.maxOutputTokens) {
      throw new LlmError("bad_request", "max_tokens hors limites");
    }
    if (req.temperature !== undefined && !(req.temperature >= 0 && req.temperature <= 1)) {
      throw new LlmError("bad_request", "Température hors limites");
    }
  }

  // ---------------------------------------------------------------- file d'attente et cadence
  private estimateWait(priority: Priority): number {
    const ahead = this.waiters.filter((w) => priority === "background" || w.priority === "interactive").length;
    const toNext = Math.max(0, this.nextStartAt - this.clock.now());
    const slotBusy = this.inFlight >= this.opts.maxConcurrent ? this.opts.minIntervalMs : 0;
    return toNext + ahead * this.opts.minIntervalMs + slotBusy;
  }

  private acquire(priority: Priority, deadlineAt: number): Promise<void> {
    if (this.openedAt !== null) {
      if (this.clock.now() - this.openedAt < this.opts.breakerCooldownMs) {
        return Promise.reject(new LlmError("busy", "Fournisseur momentanément suspendu après des échecs répétés"));
      }
      if (this.probing) return Promise.reject(new LlmError("busy", "Fournisseur en cours de vérification"));
      this.probing = true; // demi-ouvert : un seul appel d'essai
    }
    const wait = this.estimateWait(priority);
    if (this.clock.now() + wait > deadlineAt) {
      if (this.openedAt !== null) this.probing = false;
      return Promise.reject(new LlmError("busy", "File d'attente trop longue"));
    }
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ priority, deadline: deadlineAt, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length > 0) {
        // Les appels dont l'échéance est passée sont rendus sans avoir parti.
        const now = this.clock.now();
        this.waiters = this.waiters.filter((w) => {
          if (w.deadline < now) {
            w.reject(new LlmError("busy", "Attente trop longue"));
            return false;
          }
          return true;
        });
        if (this.waiters.length === 0) break;
        if (this.inFlight >= this.opts.maxConcurrent) {
          await this.clock.sleep(50);
          continue;
        }
        const wait = this.nextStartAt - this.clock.now();
        if (wait > 0) {
          await this.clock.sleep(wait);
          continue;
        }
        // Priorité à la conversation, puis ordre d'arrivée.
        const idx = this.waiters.findIndex((w) => w.priority === "interactive");
        const [w] = this.waiters.splice(idx >= 0 ? idx : 0, 1);
        this.inFlight++;
        this.nextStartAt = this.clock.now() + this.opts.minIntervalMs;
        w.resolve();
      }
    } finally {
      this.pumping = false;
    }
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  private recordFailure(): void {
    this.failures++;
    this.probing = false;
    if (this.failures >= this.opts.breakerThreshold) this.openedAt = this.clock.now();
  }

  private backoffMs(attempt: number, hinted?: number): number {
    const exp = Math.min(this.opts.backoffCapMs, this.opts.backoffBaseMs * 2 ** (attempt - 1));
    const jitter = exp * 0.25 * this.clock.random();
    return Math.max(hinted ?? 0, exp + jitter);
  }

  /** Exécute `call` avec file, cadence, reprises et disjoncteur. */
  private async run<T>(priority: Priority, call: (signal: AbortSignal) => Promise<T>): Promise<{ value: T; attempts: number }> {
    const deadlineAt = this.clock.now() + this.opts.queueDeadlineMs[priority];
    let lastError: LlmError | null = null;
    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt++) {
      await this.acquire(priority, deadlineAt);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.attemptTimeoutMs[priority]);
      let delay = 0;
      try {
        const value = await call(ctrl.signal);
        this.recordSuccess();
        return { value, attempts: attempt };
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError("unavailable", "Erreur inattendue du fournisseur");
        lastError = err;
        if (err.retryable) this.recordFailure();
        else this.probing = false;
        if (!err.retryable || attempt === this.opts.maxAttempts) throw err;
        delay = this.backoffMs(attempt, err.retryAfterMs);
        if (this.clock.now() + delay > deadlineAt) throw new LlmError("busy", "Reprises impossibles dans le délai imparti", { status: err.status });
      } finally {
        clearTimeout(timer);
        this.inFlight = Math.max(0, this.inFlight - 1);
        void this.pump();
      }
      // L'emplacement est déjà rendu : l'attente avant la reprise ne bloque pas les autres appels.
      await this.clock.sleep(delay);
    }
    throw lastError ?? new LlmError("unavailable", "Échec");
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.validate(req);
    const { value, attempts } = await this.run(req.priority ?? "interactive", (signal) => this.provider.complete(req, { signal }));
    return { ...value, attempts };
  }

  async embed(texts: readonly string[], priority: Priority = "background"): Promise<EmbeddingResult> {
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 64) throw new LlmError("bad_request", "Nombre de textes invalide");
    let chars = 0;
    for (const t of texts) {
      if (typeof t !== "string" || t.length === 0) throw new LlmError("bad_request", "Texte vide");
      chars += t.length;
    }
    if (chars > this.opts.maxInputChars * 4) throw new LlmError("bad_request", "Entrée trop volumineuse");
    const { value } = await this.run(priority, (signal) => this.provider.embed(texts, { signal }));
    return value;
  }
}
