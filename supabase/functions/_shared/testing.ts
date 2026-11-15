// Aides de test partagées (jamais importées par du code de production). Les contextes sont obtenus par les VRAIES gardes de
// auth.ts avec des dépendances factices : on ne fabrique jamais un AuthContext à la main, même dans les tests.
import { AccessRow, AuthDeps, requireCronSecret, requireOrgMember } from "./auth.ts";
import { AuthContext } from "./context.ts";
import { DbDeps } from "./db.ts";

export const TEST_USER = "123e4567-e89b-12d3-a456-426614174000";
export const TEST_ORG = "223e4567-e89b-12d3-a456-426614174000";
export const TEST_JWT = "aaaaaaaa.bbbbbbbb.cccccccc";

export function testRequest(headers: Record<string, string> = { authorization: `Bearer ${TEST_JWT}` }): Request {
  return new Request("https://exemple.test/x", { headers });
}

export function testAccess(over: Partial<AccessRow> = {}): AccessRow {
  return { org_role: "end_user", via: "member", org_type: "client", org_state: "pilot", is_frozen: false, is_activated: true, read_only: false, ...over };
}

export function testAuthDeps(access: Partial<AccessRow> | null = {}): AuthDeps {
  return {
    verifyToken: () => Promise.resolve({ userId: TEST_USER, aal: "aal2", amr: [{ method: "totp", timestamp: 1_800_000_000 - 30 }] }),
    resolveAccess: () => Promise.resolve(access === null ? null : testAccess(access)),
    cronSecret: () => "s".repeat(40),
    nowSeconds: () => 1_800_000_000,
  };
}

export function makeAuth(access: Partial<AccessRow> = {}): Promise<AuthContext> {
  return requireOrgMember(testRequest(), TEST_ORG, undefined, testAuthDeps(access));
}

export function makeCronAuth(): Promise<AuthContext> {
  return requireCronSecret(testRequest({ "x-cron-secret": "s".repeat(40) }), testAuthDeps());
}

/** Base factice qui enregistre les insertions ; `failTables` simule une panne d'écriture. */
export function fakeDb(failTables: string[] = []): { deps: DbDeps; inserts: Array<{ table: string; row: Record<string, unknown> }> } {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const deps: DbDeps = {
    createClient: (() => ({
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: failTables.includes(table) ? { message: "boom" } : null });
        },
      }),
    })) as never,
    url: () => "https://projet.exemple.test",
    serviceKey: () => "cle-de-service-factice",
  };
  return { deps, inserts };
}
