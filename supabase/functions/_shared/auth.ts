// Gardes d'authentification : la PREMIÈRE chose que fait chaque Edge Function (convention : docs/spec-mvp.md § 6).
// Chaque garde renvoie un AuthContext, seule preuve acceptée par serviceClient(auth). Les droits ne se déduisent JAMAIS de ce
// que dit le client (corps, paramètres, en-têtes) : l'identité vient du jeton vérifié, le rôle et la voie d'accès viennent de la
// base (resolve_access), à chaque requête, à l'instant présent.
import { AccessVia, AuthContext, isAuthContext, mintContext, ORG_ROLES, OrgRole } from "./context.ts";
import { Errors } from "./errors.ts";

export interface VerifiedToken {
  userId: string;
  aal: "aal1" | "aal2";
  /** Entrées amr du jeton : [{ method, timestamp }], format documenté par Supabase. */
  amr: ReadonlyArray<{ method?: unknown; timestamp?: unknown }>;
  /** Adresse e-mail CONFIRMÉE par le serveur d'authentification ; absente ou nulle si elle ne l'est pas. */
  email?: string | null;
}

export interface AccessRow {
  org_role: string;
  via: string;
  org_type: string;
  org_state: string;
  is_frozen: boolean;
  is_activated: boolean;
  read_only: boolean;
}

/** Dépendances externes des gardes : remplaçables dans les tests, jamais par un appelant de production. */
export interface AuthDeps {
  /** Vérifie la signature ET que la session existe encore côté serveur d'authentification (une session révoquée est refusée). */
  verifyToken(token: string): Promise<VerifiedToken>;
  /** Appelle resolve_access (base de données). Renvoie null si aucun accès. */
  resolveAccess(userId: string, orgId: string): Promise<AccessRow | null>;
  /** Secret des tâches planifiées internes, ou undefined s'il n'est pas configuré. */
  cronSecret(): string | undefined;
  /** Secondes depuis 1970. */
  nowSeconds(): number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9_-]{4,2048}\.[A-Za-z0-9_-]{4,2048}\.[A-Za-z0-9_-]{4,2048})$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const VIAS: readonly AccessVia[] = ["member", "partner", "support_access"];
const MFA_METHODS = new Set(["totp", "mfa/totp", "webauthn"]);

let defaults: Promise<AuthDeps> | undefined;
function defaultDeps(): Promise<AuthDeps> {
  // Chargement paresseux : les tests n'ont besoin ni du client Supabase ni du réseau.
  defaults ??= import("./auth_deps.ts").then((m) => m.supabaseAuthDeps());
  return defaults;
}

/** Identifiant de requête : repris du client seulement s'il est inoffensif (anti-injection dans les journaux), sinon généré. */
export function requestIdFrom(req: Request): string {
  const given = req.headers.get("x-request-id");
  return given && SAFE_REQUEST_ID.test(given) ? given : crypto.randomUUID();
}

/** Dernière vérification du second facteur (secondes depuis 1970), lue dans amr ; null s'il n'y en a pas. */
export function lastMfaAt(amr: VerifiedToken["amr"]): number | null {
  let best: number | null = null;
  for (const e of amr ?? []) {
    if (typeof e?.method === "string" && MFA_METHODS.has(e.method) && Number.isFinite(e.timestamp)) {
      const ts = e.timestamp as number;
      if (best === null || ts > best) best = ts;
    }
  }
  return best;
}

/** Vérifie le jeton de la requête. L'organisation et le rôle restent inconnus : à utiliser seulement pour ce qui ne dépend pas d'une organisation. */
export async function requireUser(req: Request, deps?: AuthDeps): Promise<AuthContext> {
  return (await verifyRequest(req, deps)).auth;
}

/**
 * Comme requireUser, avec l'adresse e-mail CONFIRMÉE de la personne (pour accepter une invitation, menace M29).
 * Une adresse non confirmée est refusée : une invitation ne s'accepte pas avec une adresse que personne n'a prouvée.
 */
export async function requireUserWithEmail(req: Request, deps?: AuthDeps): Promise<{ auth: AuthContext; email: string }> {
  const { auth, email } = await verifyRequest(req, deps);
  if (typeof email !== "string" || email.length === 0 || email.length > 320) throw Errors.forbidden();
  return { auth, email: email.toLowerCase() };
}

async function verifyRequest(req: Request, deps?: AuthDeps): Promise<{ auth: AuthContext; email: string | null }> {
  const d = deps ?? await defaultDeps();
  const match = BEARER.exec(req.headers.get("authorization") ?? "");
  if (!match) throw Errors.unauthorized();
  let verified: VerifiedToken;
  try {
    verified = await d.verifyToken(match[1]);
  } catch (e) {
    if (e instanceof Error && e.name === "AppError") throw e;
    throw Errors.unauthorized();
  }
  if (!UUID.test(verified.userId)) throw Errors.unauthorized();
  const auth = mintContext({
    kind: "user",
    userId: verified.userId,
    orgId: null,
    role: null,
    via: null,
    readOnly: false,
    frozen: false,
    activated: false,
    aal: verified.aal === "aal2" ? "aal2" : "aal1",
    mfaAt: lastMfaAt(verified.amr),
    sourceId: null,
    requestId: requestIdFrom(req),
  });
  return { auth, email: typeof verified.email === "string" ? verified.email : null };
}

/**
 * Vérifie le jeton, puis l'appartenance à CETTE organisation (membre, ESN avec relation ET assignation actives, ou accès
 * d'assistance en lecture seule), puis le rôle si une liste est donnée. Toute absence de droit donne la même réponse 403 :
 * on ne révèle pas si l'organisation existe.
 */
export async function requireOrgMember(
  req: Request,
  orgId: string,
  roles?: readonly OrgRole[],
  deps?: AuthDeps,
): Promise<AuthContext> {
  const d = deps ?? await defaultDeps();
  if (typeof orgId !== "string" || !UUID.test(orgId)) throw Errors.badRequest("Organisation invalide.");
  const user = await requireUser(req, d);
  let access: AccessRow | null;
  try {
    access = await d.resolveAccess(user.userId as string, orgId);
  } catch {
    throw Errors.unavailable(); // la base ne répond pas : on ne devine rien, on refuse
  }
  if (!access) throw Errors.forbidden();
  // Résultat inattendu de la base : on refuse (échec fermé) plutôt que de deviner un rôle.
  if (!ORG_ROLES.includes(access.org_role as OrgRole) || !VIAS.includes(access.via as AccessVia)) throw Errors.forbidden();
  const role = access.org_role as OrgRole;
  if (roles && !roles.includes(role)) throw Errors.forbidden();
  // SEC-33 : seul le salarié travaille sans second facteur (connexion par code). Pour tout autre rôle, une session aal1 est ce
  // qu'obtiendrait quelqu'un qui lit sa boîte mail : refusée ici comme dans la base (migration 16).
  if (role !== "end_user" && user.aal !== "aal2") throw Errors.mfaRequired();
  return mintContext({
    kind: "user",
    userId: user.userId,
    orgId,
    role,
    via: access.via as AccessVia,
    readOnly: access.read_only === true || access.via === "support_access",
    frozen: access.is_frozen === true,
    activated: access.is_activated === true,
    aal: user.aal,
    mfaAt: user.mfaAt,
    sourceId: null,
    requestId: user.requestId,
  });
}

/** Refuse si le second facteur est absent ou plus ancien que la limite (600 s par défaut). Sans effet de bord : renvoie le même contexte. */
export function requireRecentMfa(auth: AuthContext, maxAgeSeconds = 600, deps?: Pick<AuthDeps, "nowSeconds">): AuthContext {
  const now = deps ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  if (auth.aal !== "aal2" || auth.mfaAt === null || auth.mfaAt < now - maxAgeSeconds || auth.mfaAt > now + 60) {
    throw Errors.mfaRequired();
  }
  return auth;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Comparaison en temps constant : on compare des empreintes de même longueur, jamais les secrets bruts. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

/** Appels planifiés internes : en-tête x-cron-secret. Sans secret configuré, TOUT appel est refusé. */
export async function requireCronSecret(req: Request, deps?: AuthDeps): Promise<AuthContext> {
  const d = deps ?? await defaultDeps();
  const expected = d.cronSecret();
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!expected || expected.length < 32 || !given || !(await sameSecret(given, expected))) throw Errors.unauthorized();
  return mintContext({
    kind: "cron",
    userId: null,
    orgId: null,
    role: null,
    via: null,
    readOnly: false,
    frozen: false,
    activated: true,
    aal: null,
    mfaAt: null,
    sourceId: null,
    requestId: requestIdFrom(req),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Webhook d'alertes signé (spec § 11.2, SEC-17)
// ---------------------------------------------------------------------------------------------------------------

/** Ce que la base rend pour une source ACTIVE, avec secret, d'une organisation non suspendue (alert_source_for_webhook). */
export interface WebhookSource {
  orgId: string;
  secret: string;
  severityMap: unknown;
  fieldMapping: unknown;
  frozen: boolean;
  activated: boolean;
}

export interface WebhookAuthDeps {
  /** null si la source est inconnue, désactivée, sans secret ou si son organisation est suspendue : un seul cas pour l'appelant. */
  lookupSource(sourceId: string): Promise<WebhookSource | null>;
  nowSeconds(): number;
}

export interface VerifiedDelivery {
  auth: AuthContext;
  /** Empreinte de la livraison (horodatage et signature) : clé de la protection contre le rejeu. */
  digest: string;
  severityMap: unknown;
  fieldMapping: unknown;
}

/** Écart toléré entre l'horodatage de la source et notre horloge (5 minutes, spec § 11.2). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
const WEBHOOK_TS = /^[0-9]{9,11}$/;
const WEBHOOK_SIG = /^sha256=([0-9a-fA-F]{64})$/;
// Secret de remplacement quand la source n'existe pas : on fait le MÊME calcul, pour que le temps de réponse ne dise rien. Tiré au
// hasard à chaque démarrage (jamais une constante du dépôt public) : personne ne peut produire une signature qui lui corresponde.
const ABSENT_SOURCE_SECRET = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

let webhookDefaults: Promise<WebhookAuthDeps> | undefined;
function defaultWebhookDeps(): Promise<WebhookAuthDeps> {
  webhookDefaults ??= import("./auth_deps.ts").then((m) => m.supabaseWebhookDeps());
  return webhookDefaults;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, ts: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prefix = new TextEncoder().encode(`${ts}.`);
  const data = new Uint8Array(prefix.byteLength + body.byteLength);
  data.set(prefix, 0);
  data.set(body, prefix.byteLength);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, data)));
}

/**
 * Garde du webhook : `X-Releve-Timestamp` (secondes) et `X-Releve-Signature: sha256=<hex>`, HMAC-SHA-256 de « horodatage + "." + corps »
 * avec le secret de la source, calculé sur les OCTETS reçus. Toute absence ou erreur (en-tête, horodatage hors des 5 minutes, source
 * inconnue, désactivée ou suspendue, signature fausse) donne la même réponse 401. Le secret ne sort jamais de cette fonction.
 * Le contexte rendu est celui d'une SOURCE : son organisation vient de la base, jamais de la requête.
 */
export async function requireWebhookSource(req: Request, sourceId: string, body: Uint8Array, deps?: WebhookAuthDeps): Promise<VerifiedDelivery> {
  const d = deps ?? await defaultWebhookDeps();
  if (typeof sourceId !== "string" || !UUID.test(sourceId)) throw Errors.unauthorized();
  const ts = req.headers.get("x-releve-timestamp") ?? "";
  const sig = WEBHOOK_SIG.exec(req.headers.get("x-releve-signature") ?? "");
  if (!WEBHOOK_TS.test(ts) || !sig) throw Errors.unauthorized();
  if (Math.abs(d.nowSeconds() - Number(ts)) > WEBHOOK_TOLERANCE_SECONDS) throw Errors.unauthorized();
  let source: WebhookSource | null;
  try {
    source = await d.lookupSource(sourceId.toLowerCase());
  } catch {
    throw Errors.unavailable(); // la base ne répond pas : on refuse sans rien deviner
  }
  const usable = source !== null && typeof source.secret === "string" && source.secret.length >= 32 &&
    typeof source.orgId === "string" && UUID.test(source.orgId);
  const given = sig[1].toLowerCase();
  const expected = await hmacSha256Hex(usable ? source!.secret : ABSENT_SOURCE_SECRET, ts, body);
  const match = await sameSecret(given, expected);
  if (!match || !usable) throw Errors.unauthorized();
  const auth = mintContext({
    kind: "source",
    userId: null,
    orgId: source!.orgId,
    role: null,
    via: null,
    readOnly: false,
    frozen: source!.frozen === true,
    activated: source!.activated === true,
    aal: null,
    mfaAt: null,
    sourceId: sourceId.toLowerCase(),
    requestId: requestIdFrom(req),
  });
  return { auth, digest: hex(await sha256(`${ts}:${given}`)), severityMap: source!.severityMap, fieldMapping: source!.fieldMapping };
}

// ---------------------------------------------------------------------------------------------------------------
// Tâche planifiée qui agit pour UNE organisation (moteur d'automatisations)
// ---------------------------------------------------------------------------------------------------------------

export interface OrgStateRow { state: string; frozen: boolean; activated: boolean }

/**
 * À partir d'un contexte de tâche planifiée AUTHENTIQUE (requireCronSecret), contexte limité à une organisation dont l'état
 * (arrêt d'urgence, activation) est relu en base à cet instant. Organisation inconnue ou suspendue : refus.
 */
export async function scopeCronToOrg(cron: AuthContext, orgId: string, readOrg: (orgId: string) => Promise<OrgStateRow | null>): Promise<AuthContext> {
  if (!isAuthContext(cron) || cron.kind !== "cron" || cron.orgId !== null) throw Errors.forbidden();
  if (typeof orgId !== "string" || !UUID.test(orgId)) throw Errors.forbidden();
  let row: OrgStateRow | null;
  try {
    row = await readOrg(orgId);
  } catch {
    throw Errors.unavailable();
  }
  if (!row || row.state === "suspended") throw Errors.forbidden();
  return mintContext({
    kind: "cron",
    userId: null,
    orgId,
    role: null,
    via: null,
    readOnly: false,
    frozen: row.frozen === true,
    activated: row.activated === true,
    aal: null,
    mfaAt: null,
    sourceId: null,
    requestId: cron.requestId,
  });
}
