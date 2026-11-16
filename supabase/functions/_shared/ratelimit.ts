// Limitation de débit (menace M10, SEC-24) : au plus N appels par personne et par organisation et par minute, pour chaque fonction.
// Le compteur vit en base (fenêtre fixe, fonction SQL atomique `rate_limit_hit`) : il tient quel que soit le nombre d'instances de la
// fonction. Les clés sont composées ICI à partir du contexte vérifié (identifiant de personne, d'organisation), jamais d'une donnée de la requête.
// Échec FERMÉ : si le compteur ne répond pas, la requête est refusée (503) ; le bouton « Parler à un technicien » reste disponible côté interface.
// Valeurs de départ PROVISOIRES, à calibrer sur l'usage réel du pilote ; elles protègent aussi le quota du fournisseur de modèle.
import { AuthContext, isAuthContext } from "./context.ts";
import { DbDeps, rateLimitRpc } from "./db.ts";
import { Errors } from "./errors.ts";
import { log } from "./log.ts";

export interface RateRule { readonly scope: "user" | "org" | "source"; readonly windowSeconds: number; readonly limit: number }

export const BUCKETS = {
  /** Messages d'un salarié : une personne n'écrit pas plus de 12 messages par minute ; l'organisation, 120. */
  chat: [{ scope: "user", windowSeconds: 60, limit: 12 }, { scope: "org", windowSeconds: 60, limit: 120 }],
  /** Lectures et gestes du widget salarié (contexte, liste, lecture, transfert, confirmation, note) : sans appel au modèle. */
  widget: [{ scope: "user", windowSeconds: 60, limit: 60 }, { scope: "org", windowSeconds: 60, limit: 1200 }],
  /** Validations, refus, reprises d'un technicien. */
  actions: [{ scope: "user", windowSeconds: 60, limit: 30 }, { scope: "org", windowSeconds: 60, limit: 120 }],
  /** Opérations d'administration (et acceptation d'une invitation, sans organisation : seule la règle « personne » s'applique). */
  admin: [{ scope: "user", windowSeconds: 60, limit: 30 }, { scope: "org", windowSeconds: 60, limit: 120 }],
  /** Webhook d'alertes (après vérification de la signature) : 120 livraisons par minute et par source, 600 par organisation. */
  webhook: [{ scope: "source", windowSeconds: 60, limit: 120 }, { scope: "org", windowSeconds: 60, limit: 600 }],
} as const satisfies Record<string, readonly RateRule[]>;

export type BucketName = keyof typeof BUCKETS;

/** Appelé par chaque porte HTTP juste après l'authentification et AVANT tout travail (modèle, base). Jette 429 ou 503. */
export type Limiter = (auth: AuthContext) => Promise<void>;

export interface RateLimitDeps { db?: DbDeps; nowSeconds?: () => number }

export async function enforceRateLimit(auth: AuthContext, bucket: BucketName, deps: RateLimitDeps = {}): Promise<void> {
  // Jamais de compteur pour un contexte qui n'a pas été fabriqué par auth.ts. Une personne pour chat, actions et admin ; une source signée
  // pour le webhook ; une tâche planifiée n'est pas limitée ici.
  if (!isAuthContext(auth)) throw Errors.forbidden();
  if (bucket === "webhook" ? auth.kind !== "source" : auth.kind !== "user") throw Errors.forbidden();
  const now = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  for (const rule of BUCKETS[bucket]) {
    const id = rule.scope === "user" ? auth.userId : rule.scope === "source" ? auth.sourceId : auth.orgId;
    if (id === null) continue; // pas d'organisation (acceptation d'une invitation) : seule la règle « personne » s'applique
    const key = `${bucket}:${rule.scope === "user" ? "u" : rule.scope === "source" ? "s" : "o"}:${id}`;
    let allowed: unknown;
    try {
      const { data, error } = await rateLimitRpc(auth, { key, windowSeconds: rule.windowSeconds, limit: rule.limit }, deps.db);
      if (error) throw Errors.unavailable();
      allowed = data;
    } catch (e) {
      if (e instanceof Error && e.name === "AppError") throw e;
      throw Errors.unavailable();
    }
    if (allowed === true) continue;
    if (allowed === false) {
      log.warn("debit_limite", { bucket, scope: rule.scope, requestId: auth.requestId });
      throw Errors.rateLimited(Math.max(1, rule.windowSeconds - (now % rule.windowSeconds)));
    }
    throw Errors.unavailable(); // réponse inattendue : on ne devine pas
  }
}

/** Limiteur de production d'une fonction. */
export function limiterFor(bucket: BucketName, deps?: RateLimitDeps): Limiter {
  return (auth) => enforceRateLimit(auth, bucket, deps);
}
