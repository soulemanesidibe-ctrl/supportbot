// Banc de test de la fonction `admin` : magasin enregistreur, jeton factice, requêtes signées « comme » un rôle donné.
import { AccessRow, AuthDeps } from "../auth.ts";
import { fakeDb, TEST_JWT, TEST_ORG, TEST_USER, testAccess } from "../testing.ts";
import { createAdminHandler } from "./handler.ts";
import { AdminDeps, AdminStore } from "./types.ts";

export const NOW_S = 1_800_000_000;
export const NOW_MS = NOW_S * 1000;
export const REL = "323e4567-e89b-12d3-a456-426614174000";
export const OTHER = "423e4567-e89b-12d3-a456-426614174000";
export const OTHER2 = "523e4567-e89b-12d3-a456-426614174000";
export const GRANT = "623e4567-e89b-12d3-a456-426614174000";

export const STORE_METHODS = [
  "createClient", "createInvitation", "acceptInvitation", "activateClient", "activeRelationship", "reduceRelationship", "revokeRelationship",
  "createAssignment", "revokeAssignment", "offboardTechnician", "setFreeze", "setAutonomy", "setCategoryState", "requestSupportAccess",
  "approveSupportAccess", "revokeSupportAccess", "createDelegation", "revokeDelegation", "qualifyConnector",
] as const satisfies ReadonlyArray<keyof AdminStore>;

export type Call = { method: string; args: unknown[] };

/** Magasin qui enregistre chaque appel (hors contexte d'authentification) et renvoie des valeurs fixes. */
export function recordingStore(over: Partial<Record<keyof AdminStore, (...a: unknown[]) => unknown>> = {}): { store: AdminStore; calls: Call[] } {
  const calls: Call[] = [];
  const canned: Record<string, unknown> = {
    createClient: { clientOrgId: OTHER, relationshipId: REL, invitationId: OTHER2 },
    createInvitation: { invitationId: OTHER2 },
    acceptInvitation: { orgId: TEST_ORG, role: "org_admin" },
    activeRelationship: { id: REL, expiresAt: new Date(NOW_MS + 200 * 86_400_000).toISOString(), approvedRoles: ["partner_admin", "partner_technician"] },
    createAssignment: { assignmentId: OTHER2 },
    offboardTechnician: { assignments: 1, delegations: 0, memberships: 1 },
    setFreeze: { cancelledActions: 2 },
    requestSupportAccess: { grantId: GRANT },
    createDelegation: { delegationId: OTHER2 },
  };
  const store: Record<string, unknown> = {};
  for (const m of STORE_METHODS) {
    store[m] = (_auth: unknown, ...args: unknown[]) => {
      calls.push({ method: m, args });
      const f = over[m];
      return Promise.resolve(f ? f(...args) : canned[m]);
    };
  }
  return { store: store as unknown as AdminStore, calls };
}

export interface Who {
  /** null = personne sans accès (403). */
  access?: Partial<AccessRow> | null;
  /** Ancienneté du second facteur en secondes ; null = connexion sans second facteur. */
  mfaAge?: number | null;
  email?: string | null;
}

export function authDepsFor(who: Who = {}, seenOrgs: string[] = []): AuthDeps {
  const mfaAge = who.mfaAge === undefined ? 30 : who.mfaAge;
  return {
    verifyToken: () => Promise.resolve({
      userId: TEST_USER,
      aal: mfaAge === null ? "aal1" : "aal2",
      amr: mfaAge === null ? [{ method: "password", timestamp: NOW_S - 5 }] : [{ method: "totp", timestamp: NOW_S - mfaAge }],
      email: who.email === undefined ? "personne@client.test" : who.email,
    }),
    resolveAccess: (_u, orgId) => {
      seenOrgs.push(orgId);
      return Promise.resolve(who.access === null ? null : testAccess({ org_role: "org_admin", via: "member", ...(who.access ?? {}) }));
    },
    cronSecret: () => "s".repeat(40),
    nowSeconds: () => NOW_S,
  };
}

export function rig(over: Partial<Record<keyof AdminStore, (...a: unknown[]) => unknown>> = {}, failTables: string[] = []) {
  const rec = recordingStore(over);
  const db = fakeDb(failTables);
  const deps: AdminDeps = {
    store: rec.store,
    db: db.deps,
    nowMs: () => NOW_MS,
    newToken: () => Promise.resolve({ token: "T".repeat(43), hash: "h".repeat(64) }),
  };
  const seenOrgs: string[] = [];
  const handlerFor = (who: Who) => createAdminHandler({ deps: () => deps, authDeps: authDepsFor(who, seenOrgs) });
  async function call(op: string, body: Record<string, unknown> = {}, who: Who = {}, headers: Record<string, string> = {}) {
    const res = await handlerFor(who)(new Request("https://exemple.test/admin", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_JWT}`, "content-type": "application/json", ...headers },
      body: JSON.stringify({ op, orgId: TEST_ORG, ...body }),
    }));
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* corps non JSON */ }
    const code = ((json.error ?? {}) as { code?: string }).code;
    return { status: res.status, json, text, code };
  }
  return { ...rec, db, call, seenOrgs, handlerFor };
}

/** Un corps valide pour chaque opération (hors orgId, ajouté par `call`). */
export const VALID_BODY: Readonly<Record<string, Record<string, unknown>>> = {
  "client.create": { name: "Client Gamma", slug: "client-gamma", adminEmail: "Admin@Gamma.test" },
  "invitation.create": { email: "nouveau@exemple.test", role: "org_technician" },
  "invitation.accept": { token: "T".repeat(43) },
  "client.activate": {},
  "relationship.reduce": { roles: ["partner_technician"] },
  "relationship.revoke": {},
  "assignment.create": { userId: OTHER, days: 30 },
  "assignment.revoke": { assignmentId: OTHER },
  "technician.offboard": { userId: OTHER },
  "org.freeze": {},
  "org.unfreeze": {},
  "autonomy.set": { category: "accounts", level: 1 },
  "category.set_state": { category: "password", state: "direct", reason: "Barres de passage atteintes, décision de l'administrateur" },
  "support_access.request": { clientOrgId: OTHER, reason: "Diagnostic d'un incident signalé", durationMinutes: 60 },
  "support_access.approve": { grantId: GRANT },
  "support_access.revoke": { grantId: GRANT },
  "delegation.create": { delegateId: OTHER, categories: ["accounts"], days: 7 },
  "delegation.revoke": { delegationId: OTHER },
  "connector.qualify": { connectorId: OTHER, environment: "test" },
};

export const ALL_ROLES = ["super_admin", "platform_support", "partner_admin", "partner_manager", "partner_technician", "org_admin", "org_technician", "org_viewer", "auditor", "end_user"] as const;
