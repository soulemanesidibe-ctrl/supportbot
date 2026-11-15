// Journal d'audit applicatif (table audit_logs, insertion seule) pour ce que les déclencheurs de table ne voient pas :
// appels au modèle, décisions de l'orchestrateur, refus. Règle n° 5 : chaque appel au LLM et chaque action est journalisé.
// Jamais de contenu de conversation ni de secret : seulement des identifiants, des compteurs et des motifs. redact() est
// appliqué en dernier recours, pas comme excuse pour y écrire ce qui n'a rien à y faire.
import { AuthContext } from "./context.ts";
import { DbDeps, serviceClient } from "./db.ts";
import { Errors } from "./errors.ts";
import { log, redact } from "./log.ts";

export interface AuditEvent {
  /** Nom stable de l'événement, par exemple « llm.call » ou « chat.escalated ». */
  readonly event: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  /** « agent » pour ce que fait l'IA, « user » pour ce que fait une personne, « system » pour une tâche interne. */
  readonly actorKind?: "user" | "agent" | "system" | "service";
  readonly details?: Record<string, unknown>;
}

const EVENT = /^[a-z][a-z0-9_.]{2,60}$/;
const MAX_DETAILS_BYTES = 8_000;

/** Écrit une ligne d'audit. Échoue (503) si l'écriture échoue : on n'agit pas sans trace. */
export async function auditEvent(auth: AuthContext, ev: AuditEvent, deps?: DbDeps): Promise<void> {
  if (!EVENT.test(ev.event)) throw Errors.internal();
  const actorKind = ev.actorKind ?? (auth.kind === "user" ? "user" : "system");
  let details = redact(ev.details ?? {}) as Record<string, unknown>;
  if (JSON.stringify(details).length > MAX_DETAILS_BYTES) details = { tronque: true };
  const row = {
    org_id: auth.orgId,
    actor_kind: actorKind,
    // Pour l'IA, c'est la personne qui a déclenché l'échange qui répond « pour le compte de » ; l'IA n'est pas un compte.
    actor_id: actorKind === "user" ? auth.userId : null,
    on_behalf_of: actorKind === "agent" ? auth.userId : null,
    event: ev.event,
    subject_type: ev.subjectType ?? null,
    subject_id: ev.subjectId ?? null,
    details,
    request_id: auth.requestId,
  };
  const { error } = await serviceClient(auth, deps).from("audit_logs").insert(row);
  if (error) {
    log.error("audit_ecriture_impossible", { event: ev.event, requestId: auth.requestId });
    throw Errors.unavailable();
  }
}
