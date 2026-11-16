// Les opérations d'administration : une liste FERMÉE. Chaque entrée déclare QUI peut l'appeler (rôles, voie d'accès), si un second
// facteur récent est exigé, et si elle reste possible quand l'organisation est en arrêt d'urgence (seulement ce qui RESTREINT
// l'accès : geler, révoquer, passer au niveau 0, fermer une catégorie). Le handler applique ces déclarations avant d'exécuter.
// Les opérations ne reçoivent jamais d'organisation dans leurs paramètres : elles agissent dans `auth.orgId`, vérifié par la base.
import { assertNotFrozen, AuthContext, OrgRole } from "../context.ts";
import { AppError, Errors } from "../errors.ts";
import { AdminDeps, APPROVABLE_PARTNER_ROLES, APPROVAL_CATEGORIES, AUTOMATION_KEYS, AUTOMATION_STATES, ENVIRONMENTS, GATE_STATES, INVITABLE, SUPPORT_CATEGORIES } from "./types.ts";
import { bool, Body, email, int, listOf, oneOf, optionalText, slug, text, uuid } from "./input.ts";
import { hashToken, isTokenShape } from "./token.ts";
import { baseOf, ConnectorHttpError } from "../connectors/http.ts";

const DAY_MS = 86_400_000;

/** Jeton ou secret saisi par un administrateur : 8 à 200 caractères, sans espace ni caractère de contrôle. */
function secretText(b: Body, key: string): string {
  const v = b[key];
  if (typeof v !== "string" || v.length < 8 || v.length > 200 || /\s/.test(v)) throw Errors.badRequest(`Champ « ${key} » invalide.`);
  for (const ch of v) if ((ch.codePointAt(0) as number) < 0x21 || ch === "\u007f") throw Errors.badRequest(`Champ « ${key} » invalide.`);
  return v;
}
const ALL_INVITABLE_ROLES = ["partner_admin", "partner_manager", "partner_technician", "org_admin", "org_technician", "org_viewer", "auditor"] as const;

export interface AdminOp<I = unknown> {
  /** « user » : la personne n'est pas encore membre d'une organisation (acceptation d'une invitation). */
  readonly scope: "org" | "user";
  readonly roles: readonly OrgRole[];
  /** « member » : membre direct de l'organisation visée. « any » : membre OU ESN assignée (voie ESN). */
  readonly via: "member" | "any";
  readonly mfa: boolean | ((input: I) => boolean);
  readonly allowWhenFrozen: boolean;
  parse(body: Body): I;
  run(auth: AuthContext, input: I, deps: AdminDeps, verifiedEmail: string | null): Promise<Record<string, unknown>>;
}

function defineOp<I>(op: AdminOp<I>): AdminOp<unknown> {
  return op as unknown as AdminOp<unknown>;
}

const PARTNER_ADMIN: readonly OrgRole[] = ["partner_admin"];
const CLIENT_ADMIN: readonly OrgRole[] = ["org_admin"];
const VALIDATORS: readonly OrgRole[] = ["partner_technician", "org_technician", "org_admin"];

export const ADMIN_OPS: ReadonlyMap<string, AdminOp<unknown>> = new Map<string, AdminOp<unknown>>([
  // ---------------------------------------------------------------- création et invitations
  ["client.create", defineOp({
    scope: "org", roles: PARTNER_ADMIN, via: "member", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ name: text(b, "name", 2, 120), slug: slug(b, "slug"), adminEmail: email(b, "adminEmail") }),
    async run(auth, i: { name: string; slug: string; adminEmail: string }, deps) {
      const tok = await deps.newToken();
      const r = await deps.store.createClient(auth, { ...i, tokenHash: tok.hash });
      return { ...r, invitationToken: tok.token };
    },
  })],
  ["invitation.create", defineOp({
    scope: "org", roles: ["partner_admin", "org_admin"], via: "member", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ email: email(b, "email"), role: oneOf(b, "role", ALL_INVITABLE_ROLES) }),
    async run(auth, i: { email: string; role: OrgRole }, deps) {
      // Chacun n'invite que les rôles de SA propre organisation, selon son rôle : le reste est refusé même si la base l'accepterait.
      if (auth.role === null || !(INVITABLE[auth.role] ?? []).includes(i.role)) throw Errors.forbidden();
      const tok = await deps.newToken();
      const r = await deps.store.createInvitation(auth, { email: i.email, role: i.role, tokenHash: tok.hash });
      return { ...r, invitationToken: tok.token };
    },
  })],
  ["invitation.accept", defineOp({
    scope: "user", roles: [], via: "any", mfa: false, allowWhenFrozen: true,
    parse: (b) => {
      if (!isTokenShape(b.token)) throw Errors.badRequest("Invitation invalide ou expirée.");
      return { token: b.token };
    },
    async run(auth, i: { token: string }, deps, verifiedEmail) {
      if (verifiedEmail === null) throw Errors.forbidden();
      const r = await deps.store.acceptInvitation(auth, { email: verifiedEmail, tokenHash: await hashToken(i.token) });
      return { ...r };
    },
  })],

  // ---------------------------------------------------------------- activation du client et relation avec l'ESN
  ["client.activate", defineOp({
    scope: "org", roles: CLIENT_ADMIN, via: "member", mfa: true, allowWhenFrozen: false,
    parse: () => ({}),
    async run(auth, _i, deps) {
      await deps.store.activateClient(auth);
      return { activated: true };
    },
  })],
  ["relationship.reduce", defineOp({
    scope: "org", roles: CLIENT_ADMIN, via: "member", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ roles: listOf(b, "roles", APPROVABLE_PARTNER_ROLES, 1, 3) }),
    async run(auth, i: { roles: string[] }, deps) {
      await deps.store.reduceRelationship(auth, i.roles);
      return { roles: i.roles };
    },
  })],
  ["relationship.revoke", defineOp({
    // Restreint l'accès de l'ESN : possible sans second facteur et même en arrêt d'urgence.
    scope: "org", roles: CLIENT_ADMIN, via: "member", mfa: false, allowWhenFrozen: true,
    parse: () => ({}),
    async run(auth, _i, deps) {
      await deps.store.revokeRelationship(auth);
      return { revoked: true };
    },
  })],

  // ---------------------------------------------------------------- assignation et départ des techniciens de l'ESN
  ["assignment.create", defineOp({
    // L'administrateur de l'ESN agit dans le CLIENT (voie ESN) : la relation active et le rôle approuvé sont déjà vérifiés par la base.
    scope: "org", roles: PARTNER_ADMIN, via: "any", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ userId: uuid(b, "userId"), days: int(b, "days", 1, 365, 90) }),
    async run(auth, i: { userId: string; days: number }, deps) {
      const rel = await deps.store.activeRelationship(auth);
      if (rel === null) throw Errors.conflict("Aucune relation active avec ce client.");
      // Jamais au-delà de la fin de la relation (la base le refuse aussi).
      const endsMs = Math.min(deps.nowMs() + i.days * DAY_MS, Date.parse(rel.expiresAt));
      const r = await deps.store.createAssignment(auth, { relationshipId: rel.id, userId: i.userId, endsAt: new Date(endsMs).toISOString() });
      return { ...r };
    },
  })],
  ["assignment.revoke", defineOp({
    scope: "org", roles: PARTNER_ADMIN, via: "any", mfa: false, allowWhenFrozen: true,
    parse: (b) => ({ assignmentId: uuid(b, "assignmentId") }),
    async run(auth, i: { assignmentId: string }, deps) {
      await deps.store.revokeAssignment(auth, i.assignmentId);
      return { revoked: true };
    },
  })],
  ["technician.offboard", defineOp({
    // Départ d'un technicien : révocation atomique de tout ce qu'il détient. Jamais bloqué par un arrêt d'urgence.
    scope: "org", roles: PARTNER_ADMIN, via: "member", mfa: true, allowWhenFrozen: true,
    parse: (b) => ({ userId: uuid(b, "userId") }),
    async run(auth, i: { userId: string }, deps) {
      return { revoked: await deps.store.offboardTechnician(auth, i.userId) };
    },
  })],

  // ---------------------------------------------------------------- arrêt d'urgence, autonomie, catégories ouvertes
  ["org.freeze", defineOp({
    // Un arrêt d'urgence doit être possible EN UNE SECONDE : pas de second facteur, et idempotent.
    scope: "org", roles: ["org_admin", "partner_admin"], via: "any", mfa: false, allowWhenFrozen: true,
    parse: () => ({}),
    async run(auth, _i, deps) {
      const r = await deps.store.setFreeze(auth, true);
      return { frozen: true, cancelledActions: r.cancelledActions };
    },
  })],
  ["org.unfreeze", defineOp({
    // Lever le gel rouvre ce qui était fermé : second facteur exigé ; la base réserve ce droit au client (ou à la plateforme).
    scope: "org", roles: ["org_admin", "partner_admin"], via: "any", mfa: true, allowWhenFrozen: true,
    parse: () => ({}),
    async run(auth, _i, deps) {
      await deps.store.setFreeze(auth, false);
      return { frozen: false };
    },
  })],
  ["autonomy.set", defineOp({
    // Passer au niveau 1 exige un second facteur et une organisation non gelée ; revenir au niveau 0 est toujours possible.
    scope: "org", roles: CLIENT_ADMIN, via: "member",
    mfa: (i: { level: 0 | 1 }) => i.level === 1,
    allowWhenFrozen: true,
    parse: (b) => ({ category: oneOf(b, "category", APPROVAL_CATEGORIES), level: int(b, "level", 0, 1) as 0 | 1 }),
    async run(auth, i: { category: typeof APPROVAL_CATEGORIES[number]; level: 0 | 1 }, deps) {
      if (i.level === 1) assertNotFrozen(auth);
      await deps.store.setAutonomy(auth, i);
      return { category: i.category, level: i.level };
    },
  })],
  ["category.set_state", defineOp({
    // Ouvrir une catégorie (réponse directe au salarié) est une décision humaine avec second facteur ; la fermer ne l'exige pas.
    scope: "org", roles: CLIENT_ADMIN, via: "member",
    mfa: (i: { state: string }) => i.state === "direct",
    allowWhenFrozen: true,
    parse: (b) => ({
      category: oneOf(b, "category", SUPPORT_CATEGORIES),
      state: oneOf(b, "state", GATE_STATES),
      reason: optionalText(b, "reason", 20, 500),
      override: bool(b, "overrideInsufficientData"),
    }),
    async run(auth, i: { category: typeof SUPPORT_CATEGORIES[number]; state: typeof GATE_STATES[number]; reason: string | null; override: boolean }, deps) {
      if (i.state === "direct") assertNotFrozen(auth);
      await deps.store.setCategoryState(auth, i);
      return { category: i.category, state: i.state };
    },
  })],
  ["automation.set_state", defineOp({
    // Règles d'automatisation (spec § 12) : activer (effets réels : messages aux salariés, tickets) exige un second facteur ; mettre en
    // simulation ou couper, non, et reste possible pendant un arrêt d'urgence. Une règle verrouillée ne se change pas (la base refuse aussi).
    scope: "org", roles: ["org_admin", "partner_admin"], via: "any",
    mfa: (i: { state: string }) => i.state === "active",
    allowWhenFrozen: true,
    parse: (b) => ({ key: oneOf(b, "key", AUTOMATION_KEYS), state: oneOf(b, "state", AUTOMATION_STATES) }),
    async run(auth, i: { key: typeof AUTOMATION_KEYS[number]; state: typeof AUTOMATION_STATES[number] }, deps) {
      if (i.state === "active") assertNotFrozen(auth);
      await deps.store.setAutomationState(auth, i);
      return { key: i.key, state: i.state };
    },
  })],

  // ---------------------------------------------------------------- accès d'assistance de la plateforme (lecture seule, limité dans le temps)
  ["support_access.request", defineOp({
    scope: "org", roles: ["super_admin"], via: "member", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ clientOrgId: uuid(b, "clientOrgId"), reason: text(b, "reason", 10, 500), durationMinutes: int(b, "durationMinutes", 15, 1440, 240) }),
    async run(auth, i: { clientOrgId: string; reason: string; durationMinutes: number }, deps) {
      return { ...(await deps.store.requestSupportAccess(auth, i)) };
    },
  })],
  ["support_access.approve", defineOp({
    scope: "org", roles: CLIENT_ADMIN, via: "member", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ grantId: uuid(b, "grantId") }),
    async run(auth, i: { grantId: string }, deps) {
      await deps.store.approveSupportAccess(auth, i.grantId);
      return { approved: true };
    },
  })],
  ["support_access.revoke", defineOp({
    scope: "org", roles: CLIENT_ADMIN, via: "member", mfa: false, allowWhenFrozen: true,
    parse: (b) => ({ grantId: uuid(b, "grantId") }),
    async run(auth, i: { grantId: string }, deps) {
      await deps.store.revokeSupportAccess(auth, i.grantId);
      return { revoked: true };
    },
  })],

  // ---------------------------------------------------------------- suppléance : délégations temporaires, nominatives, limitées
  ["delegation.create", defineOp({
    scope: "org", roles: VALIDATORS, via: "any", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({
      delegateId: uuid(b, "delegateId"),
      categories: listOf(b, "categories", APPROVAL_CATEGORIES, 1, APPROVAL_CATEGORIES.length),
      days: int(b, "days", 1, 30),
      delegatorId: b.delegatorId === undefined ? null : uuid(b, "delegatorId"),
    }),
    async run(auth, i: { delegateId: string; categories: typeof APPROVAL_CATEGORIES[number][]; days: number; delegatorId: string | null }, deps) {
      if (auth.userId === null) throw Errors.forbidden();
      // On délègue SES propres validations. Seul l'administrateur du client réattribue celles d'un absent (invariant I9).
      const delegatorId = i.delegatorId ?? auth.userId;
      if (delegatorId !== auth.userId && auth.role !== "org_admin") throw Errors.forbidden();
      return { ...(await deps.store.createDelegation(auth, { delegatorId, delegateId: i.delegateId, categories: i.categories, days: i.days })) };
    },
  })],
  ["delegation.revoke", defineOp({
    scope: "org", roles: VALIDATORS, via: "any", mfa: false, allowWhenFrozen: true,
    parse: (b) => ({ delegationId: uuid(b, "delegationId") }),
    async run(auth, i: { delegationId: string }, deps) {
      // Le délégant et le suppléant retirent la leur ; l'administrateur du client retire n'importe laquelle de son organisation.
      await deps.store.revokeDelegation(auth, { delegationId: i.delegationId, ownOnly: auth.role !== "org_admin" });
      return { revoked: true };
    },
  })],

  // ---------------------------------------------------------------- connecteur Microsoft 365 : qualification par l'administrateur du client (M22)
  ["connector.qualify", defineOp({
    scope: "org", roles: CLIENT_ADMIN, via: "member", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ connectorId: uuid(b, "connectorId"), environment: oneOf(b, "environment", ENVIRONMENTS) }),
    async run(auth, i: { connectorId: string; environment: typeof ENVIRONMENTS[number] }, deps) {
      await deps.store.qualifyConnector(auth, i);
      return { environment: i.environment };
    },
  })],

  // ---------------------------------------------------------------- connexion d'un serveur GLPI (l'ESN peut la préparer avant l'activation du client)
  ["connector.create_glpi", defineOp({
    // Les jetons arrivent dans CETTE requête, vont directement dans le coffre et ne sont ni journalisés ni renvoyés ni stockés en configuration.
    scope: "org", roles: ["org_admin", "partner_admin"], via: "any", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({
      name: text(b, "name", 2, 80), baseUrl: text(b, "baseUrl", 8, 300),
      userToken: secretText(b, "userToken"), appToken: b.appToken === undefined || b.appToken === null || b.appToken === "" ? null : secretText(b, "appToken"),
    }),
    async run(auth, i: { name: string; baseUrl: string; userToken: string; appToken: string | null }, deps) {
      let base: string;
      try {
        base = baseOf(i.baseUrl, deps.allowedHostSuffixes);
      } catch (e) {
        if (e instanceof ConnectorHttpError) throw Errors.badRequest("Adresse du serveur refusée : https, nom de domaine public, port 443, domaine autorisé.");
        throw e;
      }
      const { connectorId } = await deps.store.createConnector(auth, { type: "glpi", name: i.name, baseUrl: base });
      try {
        await deps.secrets.set(auth, connectorId, JSON.stringify(i.appToken === null ? { user_token: i.userToken } : { user_token: i.userToken, app_token: i.appToken }));
      } catch {
        await deps.store.setConnectorStatus(auth, connectorId, { status: "error", error: "secret" }).catch(() => {});
        throw Errors.unavailable();
      }
      const h = await deps.connectors.health(auth, connectorId).catch(() => ({ ok: false, detail: "unavailable" }));
      await deps.store.setConnectorStatus(auth, connectorId, { status: h.ok ? "ok" : "error", error: h.ok ? null : String(h.detail ?? "unavailable").slice(0, 40) });
      return { connectorId, status: h.ok ? "ok" : "error", detail: h.ok ? null : h.detail ?? "unavailable" };
    },
  })],
  ["connector.test", defineOp({
    scope: "org", roles: ["org_admin", "partner_admin"], via: "any", mfa: false, allowWhenFrozen: false,
    parse: (b) => ({ connectorId: uuid(b, "connectorId") }),
    async run(auth, i: { connectorId: string }, deps) {
      const h = await deps.connectors.health(auth, i.connectorId);
      await deps.store.setConnectorStatus(auth, i.connectorId, { status: h.ok ? "ok" : "error", error: h.ok ? null : String(h.detail ?? "unavailable").slice(0, 40) });
      return { status: h.ok ? "ok" : "error", detail: h.ok ? null : h.detail ?? "unavailable" };
    },
  })],

  // ---------------------------------------------------------------- Microsoft 365 : tenant du client, puis compte de chaque technicien (T12)
  ["connector.create_m365", defineOp({
    // SEC-30 : aucune connexion Microsoft 365 avant l'activation du client par son administrateur (la base le refuse aussi).
    scope: "org", roles: ["org_admin", "partner_admin"], via: "any", mfa: true, allowWhenFrozen: false,
    parse: (b) => ({ name: text(b, "name", 2, 80), tenantId: uuid(b, "tenantId") }),
    async run(auth, i: { name: string; tenantId: string }, deps) {
      if (!auth.activated) throw Errors.notActivated();
      const { connectorId } = await deps.store.createConnector(auth, { type: "m365", name: i.name, tenantId: i.tenantId });
      const h = await deps.connectors.health(auth, connectorId).catch(() => ({ ok: false, detail: "unavailable" }));
      await deps.store.setConnectorStatus(auth, connectorId, { status: h.ok ? "ok" : "error", error: h.ok ? null : String(h.detail ?? "unavailable").slice(0, 40) });
      return { connectorId, status: h.ok ? "ok" : "error", detail: h.ok ? null : h.detail ?? "unavailable" };
    },
  })],
  ["microsoft.link", defineOp({
    // Chacun lie SON compte : le jeton est vérifié par Microsoft, puis seul le lien (tenant, objet, nom d'utilisateur) est conservé.
    scope: "org", roles: VALIDATORS, via: "any", mfa: true, allowWhenFrozen: false,
    parse: (b) => {
      const t = b.microsoftToken;
      if (typeof t !== "string" || t.length < 20 || t.length > 6000) throw Errors.badRequest("Authentification Microsoft requise.");
      return { connectorId: uuid(b, "connectorId"), token: t };
    },
    async run(auth, i: { connectorId: string; token: string }, deps) {
      const tenant = await deps.store.microsoftTenantOf(auth, i.connectorId);
      if (tenant === null) throw Errors.notFound();
      let identity: { tenantId: string; objectId: string; upn: string };
      try {
        identity = await deps.microsoft.verify(i.token, tenant);
      } catch (e) {
        if (e instanceof ConnectorHttpError && (e.kind === "auth" || e.kind === "rejected")) {
          throw new AppError(403, "forbidden", "Ce compte Microsoft ne peut pas être lié : il doit être le vôtre et appartenir au tenant du client.");
        }
        throw Errors.unavailable();
      }
      await deps.store.linkMicrosoftIdentity(auth, { connectorId: i.connectorId, ...identity });
      return { linked: true, upn: identity.upn };
    },
  })],
  ["microsoft.unlink", defineOp({
    scope: "org", roles: VALIDATORS, via: "any", mfa: false, allowWhenFrozen: true,
    parse: (b) => ({ connectorId: uuid(b, "connectorId") }),
    async run(auth, i: { connectorId: string }, deps) {
      await deps.store.unlinkMicrosoftIdentity(auth, i.connectorId);
      return { linked: false };
    },
  })],
]);
