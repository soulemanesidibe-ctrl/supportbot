// Contrat des capacités (docs/spec-mvp.md § 7). L'agent ne connaît ni GLPI ni Microsoft 365 : il connaît des capacités.
// Le contrat déclare TOUTES les capacités prévues pour que le backlog s'y ajoute sans refonte ; seules celles marquées
// `demo: true` sont implémentées. Les capacités du backlog sont déclarées « forbidden » tant que leur connecteur et leurs tests
// n'existent pas : passer l'une d'elles à sa vraie classe exige une revue de sécurité et la mise à jour du modèle de menace.

export type CapabilityName =
  // Ticketing
  | "ticket.create" | "ticket.get" | "ticket.search" | "ticket.comment"
  | "ticket.update_status" | "ticket.assign" | "ticket.link_parent" | "kb.search"
  // Identité et messagerie (Microsoft 365)
  | "user.diagnose" | "user.reset_password" | "user.unlock" | "user.revoke_sessions"
  | "user.mfa_reregister" | "tenant.service_health"
  | "mailbox.diagnose" | "mailbox.grant_shared_access" | "mailbox.set_auto_reply"
  | "mailbox.set_forwarding" | "license.assign" | "group.add_member"
  | "user.onboard" | "user.offboard" | "tenant.license_usage"
  // RMM et parc
  | "device.find_by_user" | "device.health" | "device.patch_status"
  | "device.backup_status" | "script.run"
  // Prise en main à distance
  | "remote.create_session" | "remote.session_status"
  // Supervision
  | "alert.ingest" | "alert.list_active" | "alert.acknowledge" | "host.status";

/** autonomous : l'agent l'appelle seul. approval_required : action_request validée par un humain. forbidden : jamais. */
export type ActionClass = "autonomous" | "approval_required" | "forbidden";

/** Catégories d'action pour les chaînes de valideurs et le niveau d'autonomie (docs/07 § 5). */
export type ApprovalCategory = "accounts" | "mailboxes" | "licenses" | "scripts" | "tickets";

export interface CapabilityMeta {
  readonly family: "ticketing" | "identity" | "device" | "remote" | "monitoring";
  readonly effect: "read" | "write";
  /** Classe par défaut ; une organisation peut la durcir, jamais l'assouplir. */
  readonly class: ActionClass;
  readonly category: ApprovalCategory;
  /** La cible doit être l'utilisateur authentifié de la conversation, ou choisie par un technicien. */
  readonly targetPolicy: "none" | "self_only" | "technician_chosen";
  readonly requiresIdentityCheck: boolean;
  /** Implémentée dans la démo. */
  readonly demo: boolean;
}

type Family = CapabilityMeta["family"];
type Effect = CapabilityMeta["effect"];
type Target = CapabilityMeta["targetPolicy"];

// Les paramètres « const » conservent les types LITTÉRAUX (sans eux, les types dérivés ci-dessous seraient vides).
const m = <
  const F extends Family, const E extends Effect, const C extends ActionClass, const Cat extends ApprovalCategory,
  const T extends Target, const I extends boolean, const D extends boolean,
>(family: F, effect: E, cls: C, category: Cat, targetPolicy: T, requiresIdentityCheck: I, demo: D) =>
  ({ family, effect, class: cls, category, targetPolicy, requiresIdentityCheck, demo }) as const;

// `satisfies` vérifie que TOUTES les capacités sont décrites, sans élargir les types littéraux.
export const CAPABILITIES = Object.freeze({
  "ticket.create": m("ticketing", "write", "autonomous", "tickets", "none", false, true),
  "ticket.get": m("ticketing", "read", "autonomous", "tickets", "none", false, true),
  "ticket.search": m("ticketing", "read", "autonomous", "tickets", "none", false, true),
  "ticket.comment": m("ticketing", "write", "autonomous", "tickets", "none", false, true),
  "ticket.link_parent": m("ticketing", "write", "autonomous", "tickets", "none", false, true),
  "ticket.update_status": m("ticketing", "write", "approval_required", "tickets", "none", false, true),
  "ticket.assign": m("ticketing", "write", "approval_required", "tickets", "none", false, false),
  "kb.search": m("ticketing", "read", "autonomous", "tickets", "none", false, true),

  "user.diagnose": m("identity", "read", "autonomous", "accounts", "self_only", false, true),
  "tenant.service_health": m("identity", "read", "autonomous", "accounts", "none", false, true),
  "user.reset_password": m("identity", "write", "approval_required", "accounts", "self_only", true, true),
  "user.unlock": m("identity", "write", "approval_required", "accounts", "self_only", true, true),
  "user.revoke_sessions": m("identity", "write", "approval_required", "accounts", "self_only", true, true),
  "user.mfa_reregister": m("identity", "write", "approval_required", "accounts", "self_only", true, true),

  "alert.ingest": m("monitoring", "write", "autonomous", "tickets", "none", false, true),
  "alert.list_active": m("monitoring", "read", "autonomous", "tickets", "none", false, true),
  "host.status": m("monitoring", "read", "autonomous", "tickets", "none", false, false),
  "alert.acknowledge": m("monitoring", "write", "approval_required", "tickets", "none", false, false),

  // Backlog : « forbidden » tant que leur connecteur et leurs tests n'existent pas.
  "mailbox.diagnose": m("identity", "read", "forbidden", "mailboxes", "self_only", false, false),
  "mailbox.grant_shared_access": m("identity", "write", "forbidden", "mailboxes", "technician_chosen", true, false),
  "mailbox.set_auto_reply": m("identity", "write", "forbidden", "mailboxes", "self_only", true, false),
  "mailbox.set_forwarding": m("identity", "write", "forbidden", "mailboxes", "self_only", true, false),
  "license.assign": m("identity", "write", "forbidden", "licenses", "technician_chosen", false, false),
  "group.add_member": m("identity", "write", "forbidden", "accounts", "technician_chosen", true, false),
  "user.onboard": m("identity", "write", "forbidden", "accounts", "technician_chosen", false, false),
  "user.offboard": m("identity", "write", "forbidden", "accounts", "technician_chosen", false, false),
  "tenant.license_usage": m("identity", "read", "forbidden", "licenses", "none", false, false),
  "device.find_by_user": m("device", "read", "forbidden", "scripts", "self_only", false, false),
  "device.health": m("device", "read", "forbidden", "scripts", "self_only", false, false),
  "device.patch_status": m("device", "read", "forbidden", "scripts", "none", false, false),
  "device.backup_status": m("device", "read", "forbidden", "scripts", "none", false, false),
  "script.run": m("device", "write", "forbidden", "scripts", "technician_chosen", true, false),
  "remote.create_session": m("remote", "write", "forbidden", "scripts", "self_only", true, false),
  "remote.session_status": m("remote", "read", "forbidden", "scripts", "none", false, false),
} as const) satisfies Readonly<Record<CapabilityName, CapabilityMeta>>;

// ------------------------------------------------------------------------------------------------ entrées et sorties
export type AlertSeverity = "information" | "warning" | "major" | "critical";
export type AlertState = "open" | "acknowledged" | "resolved";

export interface NormalizedAlertInput {
  sourceId: string;
  /** Clé de déduplication (source + actif + contrôle). */
  dedupKey: string;
  asset: { kind: "host" | "service" | "unknown"; name: string; site?: string };
  /** Après application de la table des gravités de la source. */
  severity: AlertSeverity;
  state: AlertState;
  /** Texte libre : DONNÉE, tronquée, jamais une instruction. */
  summary: string;
  /** ISO 8601. */
  occurredAt: string;
  originUrl?: string;
  /** Charge brute conservée pour l'audit, jamais exécutée ni interprétée. */
  raw: unknown;
}

export interface NormalizedAlert extends NormalizedAlertInput {
  id: string;
  orgId: string;
  /** Rattachée à une catégorie via asset_links, sinon « non rattachée ». */
  attachment: "attached" | "unattached";
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  incidentId?: string;
}

export interface TicketView { ref: string; url: string; title: string; status: string; category?: string; updatedAt: string }
export interface UserDiagnosis {
  accountEnabled: boolean;
  locked: boolean;
  mfaMethods: { type: string; createdAt: string }[];
  lastPasswordChangeAt?: string;
  recentFailedSignIns: number;
  hasPrivilegedRole: boolean;
}
export interface ServiceHealth { service: string; status: "operational" | "degraded" | "incident"; summary?: string; url?: string }

/** Entrées et sorties des capacités de la démo (les autres s'ajoutent avec leur connecteur). */
export interface CapabilityIO {
  "ticket.create": { params: { title: string; body: string; category: string; priority: "low" | "normal" | "high" | "urgent"; requesterRef: string; diagnosticSummary?: string; parentRef?: string }; result: { ref: string; url: string } };
  "ticket.get": { params: { ref: string }; result: TicketView };
  "ticket.search": { params: { query: string; limit?: number }; result: TicketView[] };
  "ticket.comment": { params: { ref: string; body: string; internal: boolean }; result: { ok: true } };
  "ticket.link_parent": { params: { parentRef: string; childRef: string }; result: { ok: true } };
  "ticket.update_status": { params: { ref: string; status: "solved" | "closed" | "pending" }; result: { ok: true } };
  "kb.search": { params: { query: string; limit?: number }; result: { chunkId: string; documentId: string; text: string; score: number }[] };
  "user.diagnose": { params: { userRef: string }; result: UserDiagnosis };
  "tenant.service_health": { params: Record<string, never>; result: ServiceHealth[] };
  "user.reset_password": { params: { userRef: string }; result: { ok: true; temporaryPasswordDeliveredTo: "technician" } };
  "user.unlock": { params: { userRef: string }; result: { ok: true } };
  "user.revoke_sessions": { params: { userRef: string }; result: { ok: true } };
  "user.mfa_reregister": { params: { userRef: string }; result: { ok: true } };
  "alert.ingest": { params: { alert: NormalizedAlertInput }; result: { alertId: string; deduplicated: boolean } };
  "alert.list_active": { params: { assetRef?: string }; result: NormalizedAlert[] };
}

export type DemoCapability = keyof CapabilityIO;

/** Capacités que l'agent peut appeler seul : classe « autonomous » ET implémentées. Les autres sont refusées au typage ET à l'exécution. */
export type AutonomousCapability = {
  [N in DemoCapability]: (typeof CAPABILITIES)[N]["class"] extends "autonomous" ? ((typeof CAPABILITIES)[N]["demo"] extends true ? N : never) : never;
}[DemoCapability];

/** Capacités qui exigent une action_request validée par un humain (voir le contrat : jamais appelées par l'agent). */
export type PrivilegedCapability = {
  [N in CapabilityName]: (typeof CAPABILITIES)[N]["class"] extends "approval_required" ? N : never;
}[CapabilityName];

export interface InvocationContext {
  readonly orgId: string;
  readonly connectorId: string;
  readonly requestId: string;
  /** Qui agit. L'agent n'a jamais de jeton d'administration. */
  readonly actor:
    | { kind: "agent"; conversationId: string }
    | { kind: "system"; reason: "cron" | "webhook" | "automation" | "admin" }
    | { kind: "human"; userId: string; delegatedToken: string; viaDelegationId?: string };
  readonly actionRequestId?: string;
  readonly idempotencyKey?: string;
}

export interface ConnectorHealth { ok: boolean; checkedAt: string; detail?: string }

export interface Connector {
  readonly id: string;
  readonly type: "glpi" | "m365" | "demo";
  /** Un connecteur de niveau 1 doit être qualifié « test » ou « production » par l'administrateur du client (menace M22). */
  readonly environment: "test" | "production" | null;
  capabilities(): ReadonlySet<CapabilityName>;
  invokeCapability<N extends DemoCapability>(
    name: N,
    params: CapabilityIO[N]["params"],
    ctx: InvocationContext,
  ): Promise<CapabilityIO[N]["result"]>;
  health(ctx: InvocationContext): Promise<ConnectorHealth>;
}
