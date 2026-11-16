// Banc de test du circuit des actions : magasin en mémoire qui imite les écritures CONDITIONNELLES de la vraie base (zéro ligne touchée =
// conflit), connecteur espion, jeton Microsoft factice lié à un compte. Les règles de la base elles-mêmes sont testées en SQL (tests 30).
import { AppError } from "../errors.ts";
import type { Connector, DemoCapability } from "../capabilities/types.ts";
import { fakeDb, TEST_ORG, TEST_USER } from "../testing.ts";
import type { ExecDeps } from "./execute.ts";
import { ActionRow, ActionStore, ConnectorError, MicrosoftBinding, RejectReason } from "./types.ts";

export const ACTION_ID = "dddddddd-0000-4000-8000-000000000001";
export const HASH = "a".repeat(64);
export const TENANT = "tenant-0000-0000-0000-000000000001";
export const OBJECT_ID = "object-0000-0000-0000-000000000001";
export const NOW = 1_800_000_000;

export function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function msToken(over: Record<string, unknown> = {}): string {
  return `${b64url({ alg: "RS256" })}.${b64url({ tid: TENANT, oid: OBJECT_ID, exp: NOW + 3600, ...over })}.signature-factice`;
}

export function pendingAction(over: Partial<ActionRow> = {}): ActionRow {
  return {
    id: ACTION_ID, org_id: TEST_ORG, conversation_id: "conv-1", capability: "user.reset_password", category: "accounts",
    target_ref: "marie@client-alpha.test", params: {}, params_hash: HASH, status: "pending_approval", approver_id: null,
    approved_hash: null, approved_via_delegation_id: null, expires_at: new Date((NOW + 3600) * 1000).toISOString(), ...over,
  };
}

export interface ActionRig {
  deps: ExecDeps;
  action: { current: ActionRow | null };
  calls: { approve: unknown[]; markExecuting: number; finish: Array<{ status: string; result: Record<string, unknown> }>; reject: RejectReason[]; invoked: Array<{ name: string; params: unknown; ctx: unknown }> };
  audits: Array<{ table: string; row: Record<string, unknown> }>;
}

export interface ActionRigScript {
  action?: ActionRow | null;
  binding?: MicrosoftBinding | null;
  capabilities?: DemoCapability[];
  connectorFails?: Error;
  refuseApprove?: Error;
  refuseExecuting?: Error;
  nowSeconds?: number;
  result?: unknown;
  /** Secret que le connecteur dépose dans le canal à usage unique (mot de passe temporaire). */
  secret?: string;
}

export function makeActionRig(script: ActionRigScript = {}): ActionRig {
  const holder = { current: script.action === undefined ? pendingAction() : script.action };
  const calls: ActionRig["calls"] = { approve: [], markExecuting: 0, finish: [], reject: [], invoked: [] };
  const db = fakeDb();
  const store: ActionStore = {
    load: (_a, id) => Promise.resolve(holder.current && holder.current.id === id ? holder.current : null),
    insert: () => Promise.resolve({ id: ACTION_ID }),
    approve: (_a, _id, patch) => {
      calls.approve.push(patch);
      if (script.refuseApprove) return Promise.reject(script.refuseApprove);
      if (holder.current?.status !== "pending_approval") return Promise.reject(new AppError(409, "conflict", "Cette action a déjà été traitée."));
      holder.current = { ...holder.current, status: "approved", approver_id: TEST_USER, approved_hash: patch.approvedHash, approved_via_delegation_id: patch.viaDelegationId };
      return Promise.resolve();
    },
    markExecuting: () => {
      calls.markExecuting++;
      if (script.refuseExecuting) return Promise.reject(script.refuseExecuting);
      // écriture conditionnelle : une seule des requêtes simultanées passe
      if (holder.current?.status !== "approved") return Promise.reject(new AppError(409, "conflict", "Cette action a déjà été traitée."));
      holder.current = { ...holder.current, status: "executing" };
      return Promise.resolve();
    },
    finish: (_a, _id, status, result) => { calls.finish.push({ status, result }); if (holder.current) holder.current = { ...holder.current, status }; return Promise.resolve(); },
    reject: (_a, _id, reason) => { calls.reject.push(reason); if (holder.current) holder.current = { ...holder.current, status: "rejected" }; return Promise.resolve(); },
    autonomyLevel: () => Promise.resolve(1),
    directoryUserFor: () => Promise.resolve({ id: "dir-1", email: "marie@client-alpha.test" }),
    recentRequestsOnTarget: () => Promise.resolve(0),
    microsoftBinding: () => Promise.resolve(script.binding === undefined ? { tenantId: TENANT, objectId: OBJECT_ID } : script.binding),
  };
  const caps = new Set<DemoCapability>(script.capabilities ?? ["user.reset_password", "user.unlock", "user.revoke_sessions", "user.mfa_reregister"]);
  const connector = {
    id: "conn-m365", type: "m365", environment: "test",
    capabilities: () => caps,
    invokeCapability: (name: string, params: unknown, ctx: { deliverSecret?: (s: { kind: "temporary_password"; value: string }) => void }) => {
      calls.invoked.push({ name, params, ctx });
      if (script.secret) ctx.deliverSecret?.({ kind: "temporary_password", value: script.secret });
      return script.connectorFails ? Promise.reject(script.connectorFails) : Promise.resolve(script.result ?? { ok: true, temporaryPasswordDeliveredTo: "technician" });
    },
    health: () => Promise.resolve({ ok: true, checkedAt: "2026-11-16T00:00:00Z" }),
  } as unknown as Connector;
  return {
    deps: { store, connectorFor: () => Promise.resolve(connector), db: db.deps, nowSeconds: () => script.nowSeconds ?? NOW },
    action: holder, calls, audits: db.inserts,
  };
}

export { ConnectorError };
