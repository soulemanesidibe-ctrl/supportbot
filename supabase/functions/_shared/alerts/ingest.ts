// Réception d'une alerte par webhook signé (spec § 11.2, SEC-17). Ordre FIXE :
//   méthode → adresse (identifiant de source) → corps borné à 64 Ko (octets bruts) → signature et horodatage (requireWebhookSource)
//   → débit par source et par organisation → JSON → configuration de la source → normalisation et masquage
//   → alert_ingest (rejeu, déduplication, rattachement, maintenance, confirmation : UNE transaction en base).
// La fonction ne déclenche AUCUNE automatisation : le moteur tourne dans la tâche planifiée (chaque minute), hors de la requête de l'outil
// de supervision, qui reçoit donc une réponse rapide. Une source inconnue et une signature fausse reçoivent la même réponse (401).
import { requestIdFrom, requireWebhookSource, WebhookAuthDeps } from "../auth.ts";
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { errorResponse, Errors } from "../errors.ts";
import { jsonResponse, parseJsonObject, readRawBody } from "../http.ts";
import { log } from "../log.ts";
import type { Limiter } from "../ratelimit.ts";
import { NormalizedAlertRow, normalizeAlert, parseSourceConfig, SourceConfig } from "./normalize.ts";

export const MAX_ALERT_BODY_BYTES = 65_536;
const PATH = /^\/(?:functions\/v1\/)?alerts-ingest\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/?$/;

export const INGEST_STATUSES = ["received", "updated", "confirmed", "resolved", "ignored", "duplicate"] as const;
export type IngestStatus = (typeof INGEST_STATUSES)[number];

export interface AlertStore {
  /** Appelle alert_ingest. La source et l'organisation viennent du contexte vérifié, jamais de la charge. */
  ingest(auth: AuthContext, input: { digest: string; alert: NormalizedAlertRow }): Promise<{ status: IngestStatus }>;
}

export interface IngestDeps {
  readonly store: AlertStore;
  readonly limit: Limiter;
  readonly nowMs: () => number;
  /** Remplaçable dans les tests seulement. */
  readonly webhook?: WebhookAuthDeps;
}

export function supabaseAlertStore(db?: DbDeps): AlertStore {
  return {
    async ingest(auth: AuthContext, input: { digest: string; alert: NormalizedAlertRow }): Promise<{ status: IngestStatus }> {
      if (auth.kind !== "source" || auth.sourceId === null || auth.orgId === null) throw Errors.forbidden();
      const { data, error } = await serviceClient(auth, db).rpc("alert_ingest", {
        p_source: auth.sourceId,
        p_digest: input.digest,
        p_alert: input.alert,
      });
      if (error) {
        const msg = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
        if (msg.includes("Alerte invalide")) throw Errors.badRequest("Alerte invalide.");
        if (msg.includes("Source introuvable")) throw Errors.unauthorized(); // désactivée entre-temps : même réponse qu'une source inconnue
        throw Errors.unavailable();
      }
      const status = (data as { status?: unknown } | null)?.status;
      if (typeof status !== "string" || !(INGEST_STATUSES as readonly string[]).includes(status)) throw Errors.unavailable();
      return { status: status as IngestStatus };
    },
  };
}

export async function handleAlertWebhook(req: Request, deps: IngestDeps): Promise<Response> {
  const requestId = requestIdFrom(req);
  try {
    if (req.method !== "POST") throw Errors.methodNotAllowed();
    const match = PATH.exec(new URL(req.url).pathname);
    if (!match) throw Errors.unauthorized();
    const body = await readRawBody(req, MAX_ALERT_BODY_BYTES);
    const delivery = await requireWebhookSource(req, match[1], body, deps.webhook);
    await deps.limit(delivery.auth);
    const payload = parseJsonObject(body);
    let cfg: SourceConfig;
    try {
      cfg = parseSourceConfig(delivery.severityMap, delivery.fieldMapping);
    } catch {
      // Configuration de la source refusée : l'outil réessaiera ; l'administrateur corrige la correspondance. Rien de la charge au journal.
      log.warn("source_alertes_mal_configuree", { source: delivery.auth.sourceId, requestId: delivery.auth.requestId });
      throw Errors.unavailable();
    }
    const { alert, warnings } = await normalizeAlert(payload, cfg, deps.nowMs());
    const { status } = await deps.store.ingest(delivery.auth, { digest: delivery.digest, alert });
    // Doublon (rejeu ou renvoi) : sans effet ; 200 pour que l'outil cesse de renvoyer.
    return jsonResponse(status === "duplicate" ? 200 : 202, warnings.length ? { status, warnings } : { status }, delivery.auth.requestId);
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
