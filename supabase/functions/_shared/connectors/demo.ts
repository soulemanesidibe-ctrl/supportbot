// Connecteur « démo » : AUCUN accès réseau, entièrement en mémoire, déterministe. Il sert aux tests, aux démonstrations et au
// développement (docs/spec-mvp.md § 7). Il se comporte comme un vrai connecteur : mêmes capacités, mêmes contrôles de forme, même
// contrat. Il ne contient JAMAIS de donnée réelle. La référence d'un utilisateur décide du diagnostic renvoyé :
//   « admin… » : compte à privilèges ; « suspect… » : MFA ajoutée il y a moins de 24 h ; « verrou… » : compte verrouillé ;
//   « echecs… » : nombreux échecs de connexion ; toute autre : compte ordinaire sans signal.
import { Connector, ConnectorHealth, DemoCapability, CapabilityIO, CapabilityName, InvocationContext, NormalizedAlert, TicketView, UserDiagnosis } from "../capabilities/types.ts";
import { ConnectorHttpError } from "./http.ts";

const CAPABILITIES: readonly DemoCapability[] = [
  "ticket.create", "ticket.get", "ticket.search", "ticket.comment", "ticket.link_parent", "ticket.update_status",
  "user.diagnose", "tenant.service_health", "user.reset_password", "user.unlock", "user.revoke_sessions", "user.mfa_reregister",
  "alert.ingest", "alert.list_active",
];
const REF = /^DEMO-\d{1,8}$/;

export interface DemoEffect { capability: string; target: string }

export class DemoConnector implements Connector {
  readonly type = "demo" as const;
  readonly environment: "test" | "production" | null = "test";
  /** Journal des effets (ce qu'un vrai connecteur aurait modifié) : les tests s'en servent pour prouver ce qui s'est exécuté. */
  readonly effects: DemoEffect[] = [];
  private readonly tickets = new Map<string, TicketView & { comments: Array<{ body: string; internal: boolean }>; parent?: string }>();
  private readonly alerts = new Map<string, NormalizedAlert>();
  private counter = 0;

  constructor(readonly id: string, private readonly nowIso: () => string = () => new Date().toISOString()) {}

  capabilities(): ReadonlySet<CapabilityName> {
    return new Set<CapabilityName>(CAPABILITIES);
  }

  health(): Promise<ConnectorHealth> {
    return Promise.resolve({ ok: true, checkedAt: this.nowIso(), detail: "connecteur de démonstration" });
  }

  invokeCapability<N extends DemoCapability>(name: N, params: CapabilityIO[N]["params"], ctx: InvocationContext): Promise<CapabilityIO[N]["result"]> {
    try {
      return Promise.resolve(this.run(name, params as never, ctx) as CapabilityIO[N]["result"]);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  private ref(raw: unknown): string {
    if (typeof raw !== "string" || !REF.test(raw)) throw new ConnectorHttpError("rejected", 400);
    return raw;
  }

  private ticket(raw: unknown) {
    const t = this.tickets.get(this.ref(raw));
    if (!t) throw new ConnectorHttpError("not_found", 404);
    return t;
  }

  // deno-lint-ignore no-explicit-any
  private run(name: DemoCapability, p: any, ctx: InvocationContext): unknown {
    switch (name) {
      case "ticket.create": {
        const ref = `DEMO-${++this.counter}`;
        const now = this.nowIso();
        this.tickets.set(ref, { ref, url: `https://demo.invalid/tickets/${ref}`, title: String(p.title), status: "new", category: String(p.category), updatedAt: now, comments: [], parent: p.parentRef });
        return { ref, url: `https://demo.invalid/tickets/${ref}` };
      }
      case "ticket.get": { const { comments: _c, parent: _p, ...view } = this.ticket(p.ref); return view; }
      case "ticket.search": {
        const q = String(p.query ?? "").toLowerCase();
        const limit = Math.min(Math.max(Number(p.limit ?? 10), 1), 50);
        return [...this.tickets.values()].filter((t) => t.title.toLowerCase().includes(q)).slice(0, limit).map(({ comments: _c, parent: _p, ...v }) => v);
      }
      case "ticket.comment": { this.ticket(p.ref).comments.push({ body: String(p.body), internal: p.internal === true }); return { ok: true }; }
      case "ticket.link_parent": { this.ticket(p.childRef).parent = this.ref(p.parentRef); this.ticket(p.parentRef); return { ok: true }; }
      case "ticket.update_status": {
        const t = this.ticket(p.ref);
        if (!["solved", "closed", "pending"].includes(p.status)) throw new ConnectorHttpError("rejected", 400);
        t.status = p.status; t.updatedAt = this.nowIso(); this.effects.push({ capability: name, target: t.ref });
        return { ok: true };
      }
      case "user.diagnose": return this.diagnose(String(p.userRef));
      case "tenant.service_health": return [{ service: "Exchange Online", status: "operational" }, { service: "Microsoft Teams", status: "operational" }];
      case "user.reset_password": {
        const r = this.privileged(name, p, { ok: true, temporaryPasswordDeliveredTo: "technician" });
        ctx.deliverSecret?.({ kind: "temporary_password", value: "Demo-Temporaire-0000" }); // valeur de démonstration, jamais un vrai mot de passe
        return r;
      }
      case "user.unlock":
      case "user.revoke_sessions":
      case "user.mfa_reregister": return this.privileged(name, p, { ok: true });
      case "alert.ingest": {
        const a = p.alert;
        const key = `${a.sourceId}:${a.dedupKey}`;
        const existing = this.alerts.get(key);
        if (existing) { this.alerts.set(key, { ...existing, count: existing.count + 1, lastSeenAt: this.nowIso(), state: a.state }); return { alertId: existing.id, deduplicated: true }; }
        const id = `demo-alert-${++this.counter}`;
        this.alerts.set(key, { ...a, id, orgId: "demo", attachment: "unattached", firstSeenAt: this.nowIso(), lastSeenAt: this.nowIso(), count: 1 });
        return { alertId: id, deduplicated: false };
      }
      case "alert.list_active": return [...this.alerts.values()].filter((a) => a.state !== "resolved" && (p.assetRef === undefined || a.asset.name === p.assetRef));
      default: throw new ConnectorHttpError("rejected", 400);
    }
  }

  private privileged(name: DemoCapability, p: { userRef?: unknown }, result: unknown): unknown {
    if (typeof p.userRef !== "string" || p.userRef.length === 0) throw new ConnectorHttpError("rejected", 400);
    this.effects.push({ capability: name, target: p.userRef });
    return result;
  }

  private diagnose(userRef: string): UserDiagnosis {
    const ref = userRef.toLowerCase();
    const now = Date.parse(this.nowIso());
    const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
    return {
      accountEnabled: !ref.startsWith("desactive"),
      locked: ref.startsWith("verrou"),
      mfaMethods: [{ type: "microsoftAuthenticator", createdAt: ref.startsWith("suspect") ? ago(2) : ago(24 * 90) }],
      lastPasswordChangeAt: ago(24 * 40),
      recentFailedSignIns: ref.startsWith("echecs") ? 14 : 0,
      hasPrivilegedRole: ref.startsWith("admin"),
    };
  }
}
