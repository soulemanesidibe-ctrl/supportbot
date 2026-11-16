// Erreurs applicatives et réponse HTTP d'erreur.
// Règle : le client ne reçoit JAMAIS un détail interne (trace, requête SQL, nom de table, secret). Les messages publics sont
// fixes, en français, et identiques que la ressource existe ou non (pas d'énumération). Le détail va au journal, masqué.
import { log } from "./log.ts";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "mfa_required"
  | "org_frozen"
  | "read_only"
  | "not_activated"
  | "rate_limited"
  | "service_unavailable"
  | "internal";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly retryAfterSeconds?: number;
  constructor(status: number, code: ErrorCode, publicMessage: string, retryAfterSeconds?: number) {
    super(publicMessage);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const Errors = {
  badRequest: (message = "Requête invalide.") => new AppError(400, "bad_request", message),
  unauthorized: () => new AppError(401, "unauthorized", "Authentification requise."),
  forbidden: () => new AppError(403, "forbidden", "Accès refusé."),
  notFound: () => new AppError(404, "not_found", "Introuvable."),
  methodNotAllowed: () => new AppError(405, "method_not_allowed", "Méthode non autorisée."),
  conflict: (message = "Cette opération est en conflit avec l'état actuel.") => new AppError(409, "conflict", message),
  mfaRequired: () => new AppError(403, "mfa_required", "Une vérification par second facteur récente est requise."),
  orgFrozen: () =>
    new AppError(
      403,
      "org_frozen",
      "Cette organisation est en arrêt d'urgence : aucune action n'est possible pour le moment.",
    ),
  readOnly: () => new AppError(403, "read_only", "Cet accès est en lecture seule."),
  notActivated: () =>
    new AppError(
      403,
      "not_activated",
      "Le compte du client n'a pas encore été activé par son administrateur.",
    ),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(429, "rate_limited", "Trop de demandes. Réessayez dans un instant.", retryAfterSeconds),
  unavailable: () => new AppError(503, "service_unavailable", "Service momentanément indisponible."),
  internal: () => new AppError(500, "internal", "Erreur interne."),
};

/** Transforme n'importe quelle erreur en réponse HTTP sûre. Une erreur inconnue devient une 500 anonyme, journalisée. */
export function errorResponse(err: unknown, requestId: string): Response {
  const app = err instanceof AppError ? err : null;
  if (!app) log.error("erreur_non_geree", { requestId, erreur: err });
  const e = app ?? Errors.internal();
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  if (e.retryAfterSeconds !== undefined) headers.set("retry-after", String(Math.ceil(e.retryAfterSeconds)));
  return new Response(JSON.stringify({ error: { code: e.code, message: e.message, requestId } }), {
    status: e.status,
    headers,
  });
}
