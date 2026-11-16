// Préparation d'une action par l'IA : elle ne FAIT rien, elle crée une demande que des humains valideront. Ordre :
//   niveau d'autonomie de la catégorie (0 = l'agent ne prépare aucune action) ; client activé ; salarié retrouvé dans l'annuaire ;
//   diagnostic du compte par une capacité de lecture ; règles de risque X1 à X4 (code, jamais le modèle) ; création de la demande.
// Tout refus est une raison NOMMÉE (pour le technicien et l'audit), jamais une action improvisée. La base impose de son côté les mêmes
// conditions (niveau, activation, connecteur qualifié, cible = utilisateur de la conversation).
import { auditEvent } from "../audit.ts";
import { assertNotFrozen, AuthContext } from "../context.ts";
import { DbDeps } from "../db.ts";
import { AppError, Errors } from "../errors.ts";
import type { UserDiagnosis } from "../capabilities/types.ts";
import { evaluateRisk } from "./risk.ts";
import { ACTION_CAPABILITY, ActionStore, REQUESTED_ACTIONS, RequestedAction } from "./types.ts";

export type NotPreparedReason =
  | "niveau_0"
  | "client_non_active"
  | "identite_non_resolue"
  | "compte_a_privileges"
  | "diagnostic_indisponible"
  | "refus_base"
  | "action_inconnue";

export type PrepareResult =
  | { readonly status: "prepared"; readonly actionId: string; readonly flags: readonly string[] }
  | { readonly status: "suspicious"; readonly flags: readonly string[] }
  | { readonly status: "not_prepared"; readonly reason: NotPreparedReason; readonly flags?: readonly string[] };

export interface PrepareDeps {
  readonly store: ActionStore;
  /** Diagnostic du compte (capacité de lecture « user.diagnose » via callCapability). */
  readonly diagnose: (auth: AuthContext, scope: { conversationId: string; requesterRef: string }) => Promise<UserDiagnosis>;
  readonly db?: DbDeps;
}

export async function prepareAction(auth: AuthContext, input: { conversationId: string; requested: RequestedAction }, deps: PrepareDeps): Promise<PrepareResult> {
  if (auth.kind !== "user" || auth.orgId === null) throw Errors.forbidden();
  assertNotFrozen(auth);
  if (!REQUESTED_ACTIONS.includes(input.requested)) return { status: "not_prepared", reason: "action_inconnue" };
  if (!auth.activated) return { status: "not_prepared", reason: "client_non_active" };
  if ((await deps.store.autonomyLevel(auth, "accounts")) < 1) return { status: "not_prepared", reason: "niveau_0" };
  const dir = await deps.store.directoryUserFor(auth, input.conversationId);
  if (!dir) return { status: "not_prepared", reason: "identite_non_resolue" };

  let diagnosis: UserDiagnosis;
  try {
    diagnosis = await deps.diagnose(auth, { conversationId: input.conversationId, requesterRef: dir.email });
  } catch {
    return { status: "not_prepared", reason: "diagnostic_indisponible" }; // sans diagnostic, pas de préparation : un technicien reprend
  }
  const verdict = evaluateRisk({ diagnosis, priorRequests24h: await deps.store.recentRequestsOnTarget(auth, dir.id, 24) });
  if (verdict.decision === "privileged") return { status: "not_prepared", reason: "compte_a_privileges", flags: verdict.flags };
  if (verdict.decision === "suspicious") return { status: "suspicious", flags: verdict.flags };

  try {
    const { id } = await deps.store.insert(auth, { conversationId: input.conversationId, capability: ACTION_CAPABILITY[input.requested], directoryUserId: dir.id, riskFlags: verdict.flags });
    await auditEvent(auth, {
      event: "action.prepared",
      actorKind: "agent",
      subjectType: "action_request",
      subjectId: id,
      details: { capability: ACTION_CAPABILITY[input.requested] },
    }, deps.db);
    return { status: "prepared", actionId: id, flags: verdict.flags };
  } catch (e) {
    if (e instanceof AppError && e.code === "service_unavailable") return { status: "not_prepared", reason: "refus_base" };
    throw e;
  }
}
