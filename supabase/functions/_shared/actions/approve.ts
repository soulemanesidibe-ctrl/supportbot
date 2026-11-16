// Validation et refus d'une action par un technicien. Le valideur voit l'action EXACTE (empreinte) : ce qu'il valide est ce qui s'exécute.
// Rien ici ne décide de l'éligibilité, de l'auto-validation ou de la vérification d'identité : la base les impose (déclencheur) ; ce code
// vérifie les entrées, exige le second facteur récent, contrôle le jeton AVANT d'approuver, puis exécute dans la même requête.
import { auditEvent } from "../audit.ts";
import { requireRecentMfa } from "../auth.ts";
import { assertCanWrite, AuthContext } from "../context.ts";
import { Errors } from "../errors.ts";
import { executeApprovedAction, ExecDeps, preflight } from "./execute.ts";
import { ActionOutcome, IDENTITY_METHODS, IdentityMethod, REJECT_REASONS, RejectReason } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export interface ApproveInput {
  readonly actionId: unknown;
  /** L'empreinte que le valideur a VUE à l'écran. */
  readonly seenHash: unknown;
  readonly identityMethod: unknown;
  readonly viaDelegationId?: unknown;
  readonly delegatedToken: unknown;
}

export async function approveAction(auth: AuthContext, input: ApproveInput, deps: ExecDeps): Promise<ActionOutcome> {
  if (typeof input.actionId !== "string" || !UUID.test(input.actionId)) throw Errors.badRequest("Action invalide.");
  if (typeof input.seenHash !== "string" || !HASH.test(input.seenHash)) throw Errors.badRequest("Empreinte invalide.");
  if (typeof input.identityMethod !== "string" || !IDENTITY_METHODS.includes(input.identityMethod as IdentityMethod)) {
    throw Errors.badRequest("Méthode de vérification d'identité invalide.");
  }
  const via = input.viaDelegationId === undefined || input.viaDelegationId === null ? null : input.viaDelegationId;
  if (via !== null && (typeof via !== "string" || !UUID.test(via))) throw Errors.badRequest("Délégation invalide.");
  if (typeof input.delegatedToken !== "string") throw Errors.badRequest("Authentification Microsoft requise.");
  assertCanWrite(auth);
  // Valider une action sur un compte exige un second facteur de moins de 10 minutes (horloge injectable pour les tests).
  requireRecentMfa(auth, 600, { nowSeconds: deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)) });

  const action = await deps.store.load(auth, input.actionId);
  if (!action || action.org_id !== auth.orgId) throw Errors.notFound();
  if (action.status !== "pending_approval") throw Errors.conflict("Cette action n'attend plus de validation.");
  // I8 : une demande que personne n'a validée dans le délai ne se valide plus (la base la refuse aussi) ; on ne l'approuve pas pour échouer ensuite.
  const nowSeconds = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  if (!(Date.parse(action.expires_at) > nowSeconds * 1000)) throw Errors.conflict("Cette demande a expiré : une nouvelle demande est nécessaire.");
  // M12 : le valideur doit avoir vu l'empreinte actuelle. Si l'action a changé depuis son affichage, on refuse.
  if (input.seenHash !== action.params_hash) throw Errors.conflict("L'action a changé depuis votre affichage : relisez-la avant de valider.");
  // Contrôle du jeton et du connecteur AVANT d'approuver : pas d'approbation laissée sans suite.
  await preflight(auth, { ...action, approver_id: auth.userId }, input.delegatedToken, deps);

  await deps.store.approve(auth, action.id, { approvedHash: input.seenHash, identityMethod: input.identityMethod as IdentityMethod, viaDelegationId: via as string | null });
  await auditEvent(auth, {
    event: "action.approved",
    actorKind: "user",
    subjectType: "action_request",
    subjectId: action.id,
    details: { capability: action.capability, params_hash: action.params_hash, identity_method: input.identityMethod, via_delegation: via },
  }, deps.db);
  return await executeApprovedAction(auth, action.id, input.delegatedToken, deps);
}

export async function rejectAction(auth: AuthContext, input: { actionId: unknown; reason: unknown }, deps: Pick<ExecDeps, "store" | "db">): Promise<void> {
  if (typeof input.actionId !== "string" || !UUID.test(input.actionId)) throw Errors.badRequest("Action invalide.");
  if (typeof input.reason !== "string" || !REJECT_REASONS.includes(input.reason as RejectReason)) throw Errors.badRequest("Motif de refus invalide.");
  assertCanWrite(auth);
  const action = await deps.store.load(auth, input.actionId);
  if (!action || action.org_id !== auth.orgId) throw Errors.notFound();
  if (action.status !== "pending_approval") throw Errors.conflict("Cette action n'attend plus de validation.");
  await deps.store.reject(auth, action.id, input.reason as RejectReason);
  await auditEvent(auth, {
    event: "action.rejected",
    actorKind: "user",
    subjectType: "action_request",
    subjectId: action.id,
    details: { capability: action.capability, reason: input.reason },
  }, deps.db);
}
