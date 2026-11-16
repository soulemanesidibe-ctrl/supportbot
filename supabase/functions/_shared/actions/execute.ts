// Porte UNIQUE d'exécution d'une action privilégiée (menaces M01, M05, M12, M13). L'exécuteur :
//   1. exige une action_request approuvée, non expirée, dont l'empreinte validée est EXACTEMENT l'empreinte stockée (M12) ;
//   2. exige que celui qui exécute soit le valideur nommé : l'action s'exécute avec SON identité, jamais celle de l'IA (M05) ;
//   3. refuse si l'organisation est gelée ou l'accès en lecture seule ;
//   4. lie le jeton délégué au compte Microsoft que CE technicien a lié (locataire et identifiant d'objet) ;
//   5. passe l'action à « executing » par une écriture conditionnelle atomique : au plus une exécution (M13) ; la base revérifie alors
//      que le valideur est TOUJOURS éligible (délégation révoquée, assignation expirée : I5) ;
//   6. appelle le connecteur ; une issue certaine est « succeeded » ou « failed », une issue incertaine est « unknown » et n'est JAMAIS
//      rejouée seule : un humain vérifie puis crée une nouvelle demande.
import { auditEvent } from "../audit.ts";
import type { ConnectorFactoryLookup } from "./deps.ts";
import { assertCanWrite, AuthContext } from "../context.ts";
import { DbDeps } from "../db.ts";
import { Errors } from "../errors.ts";
import { log } from "../log.ts";
import { redact } from "../redact.ts";
import type { Connector, DemoCapability, InvocationContext } from "../capabilities/types.ts";
import { assertTokenBelongsToBinding } from "./token.ts";
import { ActionOutcome, ActionRow, ActionStore, ConnectorError } from "./types.ts";

export interface ExecDeps {
  readonly store: ActionStore;
  readonly connectorFor: ConnectorFactoryLookup;
  readonly db?: DbDeps;
  readonly nowSeconds?: () => number;
}

const MAX_RESULT_BYTES = 8_000;

/** Vérifie, avant toute exécution, que l'action approuvée existe pour cette empreinte exacte. Lève une erreur sinon. */
export async function assertApprovedActionRequest(auth: AuthContext, actionId: string, store: ActionStore, now = Date.now()): Promise<ActionRow> {
  const action = await store.load(auth, actionId);
  if (!action || action.org_id !== auth.orgId) throw Errors.notFound();
  if (action.status !== "approved") throw Errors.conflict("Cette action n'est pas (ou plus) approuvée.");
  if (!action.approved_hash || action.approved_hash !== action.params_hash) throw Errors.conflict("L'empreinte validée ne correspond pas à l'action.");
  if (Date.parse(action.expires_at) <= now) throw Errors.conflict("Cette demande a expiré : rien ne s'exécute.");
  if (action.approver_id === null || action.approver_id !== auth.userId) throw Errors.forbidden(); // on exécute avec SON identité, ni celle d'un autre ni celle de l'IA
  return action;
}

function sanitizeResult(r: unknown): Record<string, unknown> {
  const clean = redact(r && typeof r === "object" ? r : { value: r }) as Record<string, unknown>;
  return JSON.stringify(clean).length > MAX_RESULT_BYTES ? { tronque: true } : clean;
}

/** Contrôles qui précèdent toute exécution (aussi appelés avant d'APPROUVER, pour ne pas laisser une approbation sans suite). */
export async function preflight(auth: AuthContext, action: ActionRow, delegatedToken: string, deps: ExecDeps): Promise<Connector> {
  assertCanWrite(auth);
  if (typeof delegatedToken !== "string" || delegatedToken.length < 20 || delegatedToken.length > 8_192) throw Errors.badRequest("Authentification Microsoft requise.");
  const connector = await deps.connectorFor(auth, action.capability as DemoCapability);
  if (!connector.capabilities().has(action.capability as DemoCapability)) throw Errors.unavailable();
  assertTokenBelongsToBinding(delegatedToken, await deps.store.microsoftBinding(auth, connector.id), deps.nowSeconds?.());
  return connector;
}

export async function executeApprovedAction(auth: AuthContext, actionId: string, delegatedToken: string, deps: ExecDeps): Promise<ActionOutcome> {
  const action = await assertApprovedActionRequest(auth, actionId, deps.store);
  const connector = await preflight(auth, action, delegatedToken, deps);

  // Écriture conditionnelle : si deux requêtes arrivent ensemble, une seule passe ; la base refuse si le valideur n'est plus éligible.
  await deps.store.markExecuting(auth, action.id);

  const ctx: InvocationContext = {
    orgId: auth.orgId as string,
    connectorId: connector.id,
    requestId: auth.requestId,
    actor: { kind: "human", userId: auth.userId as string, delegatedToken, viaDelegationId: action.approved_via_delegation_id ?? undefined },
    actionRequestId: action.id,
    idempotencyKey: action.params_hash,
  };
  let status: "succeeded" | "failed" | "unknown";
  let result: Record<string, unknown>;
  try {
    // nosemgrep: releve-capability-invoked-outside-gate -- porte unique : assertApprovedActionRequest vient de confirmer l'empreinte exacte approuvée
    const r = await connector.invokeCapability(action.capability as DemoCapability, action.params as never, ctx);
    status = "succeeded";
    result = sanitizeResult(r);
  } catch (e) {
    // Une issue incertaine (réseau coupé, délai) est « unknown » : on ne sait pas si l'action a eu lieu, on ne la rejoue JAMAIS seule.
    status = e instanceof ConnectorError ? e.outcome : "unknown";
    result = { outcome: status };
    log.warn("action_en_echec", { action: action.id, outcome: status, requestId: auth.requestId });
  }
  await deps.store.finish(auth, action.id, status, result);
  await auditEvent(auth, {
    event: `action.${status}`,
    actorKind: "user",
    subjectType: "action_request",
    subjectId: action.id,
    details: { capability: action.capability, params_hash: action.params_hash, via_delegation: action.approved_via_delegation_id ?? null },
  }, deps.db);
  return { actionId: action.id, status };
}
