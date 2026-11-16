// Porte UNIQUE des capacités que l'agent appelle seul (lecture et écritures sans risque comme créer un ticket). Règle : une
// capacité n'est appelée que si, à cet instant, sa classe effective est « autonomous » ; sinon l'appel est refusé. Le filtre est du
// code déterministe, jamais le jugement du modèle (M01, M05, LLM06 « Excessive Agency ») :
//   - nom inconnu ou fabriqué (« __proto__ », « constructor »...) : refusé ;
//   - capacité du backlog (non implémentée) : refusée ;
//   - classe « approval_required » (réinitialiser un mot de passe, débloquer, révoquer, changer un statut) ou « forbidden » :
//     refusée ici, quoi que dise le modèle : ces actions passent par une action_request validée par un humain (actions/execute.ts) ;
//   - une organisation peut DURCIR une classe, jamais l'assouplir ;
//   - cible « self_only » : la cible est l'utilisateur authentifié de la conversation, calculé par le code, jamais une valeur lue
//     dans un message, un ticket ou une alerte ;
//   - organisation gelée (arrêt d'urgence) : plus rien ; accès d'assistance (lecture seule) : aucune écriture.
// Le résultat d'une capacité est une DONNÉE EXTERNE (texte de ticket, d'alerte...) : l'orchestrateur le passe au modèle par wrapExternal.
import { auditEvent } from "../audit.ts";
import { assertCanWrite, assertNotFrozen, AuthContext, isAuthContext } from "../context.ts";
import { DbDeps } from "../db.ts";
import { Errors } from "../errors.ts";
import { log } from "../log.ts";
import {
  ActionClass,
  AutonomousCapability,
  CAPABILITIES,
  CapabilityIO,
  CapabilityMeta,
  CapabilityName,
  Connector,
  InvocationContext,
} from "./types.ts";

const STRICTNESS: Readonly<Record<ActionClass, number>> = { autonomous: 0, approval_required: 1, forbidden: 2 };
const MAX_PARAMS_BYTES = 8_000;

export type ClassOverrides = Readonly<Partial<Record<CapabilityName, ActionClass>>>;

/** La plus stricte des deux classes : une surcharge ne peut que durcir. */
export function effectiveClass(name: CapabilityName, overrides: ClassOverrides = {}): ActionClass {
  const base = CAPABILITIES[name].class;
  const o = overrides[name];
  return o && STRICTNESS[o] > STRICTNESS[base] ? o : base;
}

export interface CallScope {
  readonly conversationId: string;
  /**
   * Identifiant, chez le fournisseur d'identité, de la personne qui parle (par exemple son nom d'utilisateur Microsoft), calculé par le
   * code à partir de la session et de l'annuaire des salariés. Jamais lu dans le texte d'un message. Nul = aucune cible possible.
   */
  readonly requesterRef: string | null;
}

export interface CallDeps {
  connectorFor(auth: AuthContext, name: CapabilityName): Promise<Connector>;
  /** Durcissements de classe propres à l'organisation (vide par défaut : le schéma n'en stocke pas encore, voir backlog). */
  overrides?(auth: AuthContext): Promise<ClassOverrides>;
  db?: DbDeps;
}

const targetPolicyOf = (m: CapabilityMeta): CapabilityMeta["targetPolicy"] => m.targetPolicy;

function isPlainParams(p: unknown): p is Record<string, unknown> {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return false;
  const proto = Object.getPrototypeOf(p);
  if (proto !== Object.prototype && proto !== null) return false;
  try {
    return JSON.stringify(p).length <= MAX_PARAMS_BYTES;
  } catch {
    return false;
  }
}

/** Refuse par défaut. Lève une erreur ; ne renvoie rien. */
export function assertCapabilityAllowed(
  name: string,
  auth: AuthContext,
  scope: CallScope,
  params: unknown,
  overrides: ClassOverrides = {},
): asserts name is AutonomousCapability {
  if (typeof name !== "string" || !Object.hasOwn(CAPABILITIES, name)) throw Errors.forbidden();
  const cap = name as CapabilityName;
  const meta = CAPABILITIES[cap];
  // L'agent agit pour une personne authentifiée d'une organisation : jamais en dehors.
  if (auth.kind !== "user" || auth.orgId === null || auth.userId === null) throw Errors.forbidden();
  assertNotFrozen(auth);
  if (!meta.demo) throw Errors.forbidden();
  if (effectiveClass(cap, overrides) !== "autonomous") throw Errors.forbidden();
  if (meta.effect === "write") assertCanWrite(auth);
  if (!isPlainParams(params)) throw Errors.badRequest("Paramètres invalides.");
  // Élargi exprès : à ce stade le typage sait déjà que « technician_chosen » est impossible, mais ce contrôle doit survivre à
  // un futur changement du tableau des capacités (une cible choisie par un technicien n'est jamais accessible à l'agent).
  const policy = targetPolicyOf(meta);
  if (policy === "technician_chosen") throw Errors.forbidden();
  if (policy === "self_only") {
    const ref = params.userRef;
    if (typeof ref !== "string" || scope.requesterRef === null || ref.trim().toLowerCase() !== scope.requesterRef.trim().toLowerCase()) {
      throw Errors.forbidden();
    }
  }
}

export async function callCapability<N extends AutonomousCapability>(
  auth: AuthContext,
  name: N,
  params: CapabilityIO[N]["params"],
  scope: CallScope,
  deps: CallDeps,
): Promise<CapabilityIO[N]["result"]> {
  const overrides = deps.overrides ? await deps.overrides(auth) : {};
  assertCapabilityAllowed(name, auth, scope, params, overrides);
  const connector = await deps.connectorFor(auth, name);
  if (!connector.capabilities().has(name)) throw Errors.unavailable();
  const ctx: InvocationContext = {
    orgId: auth.orgId as string,
    connectorId: connector.id,
    requestId: auth.requestId,
    actor: { kind: "agent", conversationId: scope.conversationId },
  };
  try {
    // nosemgrep: releve-capability-invoked-outside-gate -- porte unique : le filtre de classe (assertCapabilityAllowed) vient d'être appliqué
    const result = await connector.invokeCapability(name, params, ctx);
    await auditEvent(auth, {
      event: "capability.call",
      actorKind: "agent",
      subjectType: "conversation",
      subjectId: scope.conversationId,
      details: { capability: name, connector: connector.id, outcome: "ok" },
    }, deps.db);
    return result;
  } catch (e) {
    // L'erreur d'un connecteur peut contenir un secret ou une adresse interne : on ne la propage pas, on garde sa nature au journal.
    if (e instanceof Error && e.name === "AppError") throw e;
    log.warn("capacite_en_echec", { capability: name, connector: connector.id, requestId: auth.requestId });
    await auditEvent(auth, {
      event: "capability.failure",
      actorKind: "agent",
      subjectType: "conversation",
      subjectId: scope.conversationId,
      details: { capability: name, connector: connector.id, outcome: "error" },
    }, deps.db).catch(() => {});
    throw Errors.unavailable();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Porte des AUTOMATISATIONS (moteur de règles, spec § 12) : aucune personne derrière, donc une liste FERMÉE et courte.
// Seules des écritures de ticketing sans cible humaine : créer le ticket parent d'un incident, y rattacher les tickets enfants.
// Jamais une action sur un compte, jamais une capacité « approval_required » (celles-là passent par une action_request validée).
// ---------------------------------------------------------------------------------------------------------------
export const SYSTEM_CAPABILITIES = ["ticket.create", "ticket.link_parent"] as const;
export type SystemCapability = (typeof SYSTEM_CAPABILITIES)[number];

/** Refuse par défaut. Lève une erreur ; ne renvoie rien. */
export function assertSystemCapabilityAllowed(
  name: string,
  auth: AuthContext,
  params: unknown,
  overrides: ClassOverrides = {},
): asserts name is SystemCapability {
  if (typeof name !== "string" || !(SYSTEM_CAPABILITIES as readonly string[]).includes(name) || !Object.hasOwn(CAPABILITIES, name)) {
    throw Errors.forbidden();
  }
  // Une tâche planifiée limitée à une organisation, ou une source d'alertes signée : jamais une personne, jamais sans organisation.
  if (!isAuthContext(auth) || (auth.kind !== "cron" && auth.kind !== "source") || auth.orgId === null) throw Errors.forbidden();
  assertNotFrozen(auth);
  const cap = name as CapabilityName;
  const meta = CAPABILITIES[cap];
  if (!meta.demo || effectiveClass(cap, overrides) !== "autonomous" || targetPolicyOf(meta) !== "none") throw Errors.forbidden();
  if (!isPlainParams(params)) throw Errors.badRequest("Paramètres invalides.");
}

export async function callSystemCapability<N extends SystemCapability>(
  auth: AuthContext,
  name: N,
  params: CapabilityIO[N]["params"],
  subject: { readonly type: "incident"; readonly id: string },
  deps: CallDeps,
): Promise<CapabilityIO[N]["result"]> {
  const overrides = deps.overrides ? await deps.overrides(auth) : {};
  assertSystemCapabilityAllowed(name, auth, params, overrides);
  const connector = await deps.connectorFor(auth, name);
  if (!connector.capabilities().has(name)) throw Errors.unavailable();
  const ctx: InvocationContext = {
    orgId: auth.orgId as string,
    connectorId: connector.id,
    requestId: auth.requestId,
    actor: { kind: "system", reason: "automation" },
  };
  try {
    // nosemgrep: releve-capability-invoked-outside-gate -- porte unique des automatisations : liste fermée vérifiée juste avant
    const result = await connector.invokeCapability(name, params, ctx);
    await auditEvent(auth, {
      event: "capability.call",
      actorKind: "system",
      subjectType: subject.type,
      subjectId: subject.id,
      details: { capability: name, connector: connector.id, outcome: "ok", reason: "automation" },
    }, deps.db);
    return result;
  } catch (e) {
    if (e instanceof Error && e.name === "AppError") throw e;
    log.warn("capacite_en_echec", { capability: name, connector: connector.id, requestId: auth.requestId });
    await auditEvent(auth, {
      event: "capability.failure",
      actorKind: "system",
      subjectType: subject.type,
      subjectId: subject.id,
      details: { capability: name, connector: connector.id, outcome: "error", reason: "automation" },
    }, deps.db).catch(() => {});
    throw Errors.unavailable();
  }
}
