// Console du technicien en production. Lectures : directement dans la base, SOUS la sécurité par ligne (le technicien ne voit que
// ses clients assignés) et avec une session à second facteur (migration 16). Gestes : fonctions « console » (répondre, prendre,
// clore) et « actions » (valider, refuser, avec le jeton Microsoft du valideur). Notation des réponses : insertion directe, permise
// par la base aux seuls techniciens habilités (déclencheur et politique, migration 8). Jeton d'accès en mémoire seulement.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ApprovalDetail, AwaySummary, ClientRef, ConsoleApi, ConsoleContext, ConsoleMessage, ConversationDetail, IncidentDetail, Priority, QueueItem,
  SearchHit, StaffAuthApi, TimelineEntry,
} from "./console-types.ts";
import { CAPABILITY_TITLE } from "./console-titles.ts";
import { microsoftToken } from "./microsoft.ts";
import { createSessionClient, type SessionClient } from "./session.ts";
import { ApiError, functionsBase } from "./supabase.ts";
import type { Category } from "./types.ts";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
// Ligne renvoyée par la base : chaque champ est relu et converti explicitement avant usage.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Revendications du jeton d'accès (lues pour l'affichage seulement : la base et les fonctions les vérifient, pas l'interface). */
export function claimsOf(token: string): { sub?: string; aal?: string; name?: string } {
  try {
    const part = token.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    const meta = (json.user_metadata ?? {}) as Record<string, unknown>;
    return { sub: json.sub, aal: json.aal, name: typeof meta.full_name === "string" ? meta.full_name : undefined };
  } catch {
    return {};
  }
}

const firstName = (full: string | undefined) => (full ?? "").trim().split(/\s+/)[0]?.split("@")[0] ?? "";
const PRIORITY: Record<string, Priority> = { urgent: "urgent", high: "high", normal: "normal", low: "low" };
const CATEGORY: Record<string, string> = {
  password: "Mot de passe", mfa: "Double authentification", vpn: "VPN", printer: "Imprimante", outlook: "Outlook", teams: "Teams",
  onedrive: "OneDrive", slow_pc: "Poste lent", onboarding: "Arrivée", offboarding: "Départ", other: "Autre",
};

export function createSupabaseConsoleApi(opts: { url?: string; publishableKey?: string; fetcher?: Fetch; session?: SessionClient } = {}): ConsoleApi & StaffAuthApi {
  const url = opts.url ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const key = opts.publishableKey ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);
  const base = functionsBase(url);
  if (!key || !key.startsWith("sb_publishable_")) throw new Error("Clé publiable Supabase absente (VITE_SUPABASE_PUBLISHABLE_KEY)");
  const fetcher: Fetch = opts.fetcher ?? fetch;
  const session = opts.session ?? createSessionClient("staff", fetcher);
  let pendingAccess: string | null = null; // jeton sans second facteur, entre le mot de passe et le code TOTP
  let names = new Map<string, string>();

  const db: SupabaseClient = createClient(url as string, key, {
    accessToken: () => session.accessToken(),
    global: { fetch: (i, init) => fetcher(String(i), init ?? {}) },
  });

  const call = async <T>(fn: "console" | "actions", body: Record<string, unknown>): Promise<T> => {
    const res = await fetcher(`${base}/${fn}`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "content-type": "application/json", authorization: `Bearer ${await session.accessToken()}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: { code?: string } }) | null;
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error");
    return data as T;
  };
  const auth = async (path: string, init: RequestInit & { token: string }) => {
    const res = await fetcher(`${url}/auth/v1/${path}`, {
      ...init,
      headers: { apikey: key, authorization: `Bearer ${init.token}`, "content-type": "application/json" },
    });
    if (!res.ok) throw new ApiError(res.status, "auth");
    return (await res.json()) as Row;
  };
  const rows = async (q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> => {
    const { data, error } = await q;
    if (error) throw new ApiError(503, "unavailable");
    return (data ?? []) as Row[];
  };
  const client = (id: string): ClientRef => ({ id, name: names.get(id) ?? "Client" });
  const verifiedTotp = async (token: string): Promise<string | null> => {
    const user = await auth("user", { method: "GET", token });
    const f = ((user.factors ?? []) as Row[]).find((x) => x.factor_type === "totp" && x.status === "verified");
    return f ? String(f.id) : null;
  };

  const api: ConsoleApi & StaffAuthApi = {
    // ---------------------------------------------------------------- connexion du personnel
    async resume() {
      if (!(await session.resume())) return false;
      return claimsOf(await session.accessToken()).aal === "aal2";
    },
    async password(email, password) {
      const res = await fetcher("/api/session/password", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
      });
      if (!res.ok) return { ok: false };
      const d = (await res.json()) as { accessToken: string };
      pendingAccess = d.accessToken;
      return { ok: true, next: (await verifiedTotp(d.accessToken)) ? "mfa_verify" : "mfa_enroll" };
    },
    async enroll() {
      if (!pendingAccess) throw new ApiError(401, "no_session");
      const f = await auth("factors", { method: "POST", token: pendingAccess, body: JSON.stringify({ factor_type: "totp", friendly_name: `Relève ${new Date().toISOString().slice(0, 10)}` }) });
      return { factorId: String(f.id), qrSvg: String(f.totp?.qr_code ?? ""), secret: String(f.totp?.secret ?? "") };
    },
    async verify(factorId, code) {
      if (!pendingAccess) return false;
      const id = factorId ?? (await verifiedTotp(pendingAccess));
      if (!id) return false;
      const res = await fetcher("/api/session/mfa", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", authorization: `Bearer ${pendingAccess}` }, body: JSON.stringify({ factorId: id, code }),
      });
      if (!res.ok) return false;
      pendingAccess = null;
      return await session.resume(); // le cookie personnel porte maintenant une session à second facteur
    },
    async signOut() {
      pendingAccess = null;
      await session.signOut();
    },

    // ---------------------------------------------------------------- lectures
    async context(): Promise<ConsoleContext> {
      const claims = claimsOf(await session.accessToken());
      const orgs = await rows(db.from("organizations").select("id, name").eq("type", "client").order("name"));
      names = new Map(orgs.map((o) => [String(o.id), String(o.name)]));
      const now = new Date().toISOString();
      const onCall = await rows(db.from("relief_schedules").select("ends_at").eq("kind", "on_call").eq("technician_user_id", claims.sub ?? "").lte("starts_at", now).gt("ends_at", now).limit(1));
      const deleg = await rows(db.from("approval_delegations").select("id, org_id, delegator_id, ends_at").eq("delegate_id", claims.sub ?? "").is("revoked_at", null).gt("ends_at", now));
      return {
        me: { firstName: firstName(claims.name), ...(onCall[0] ? { onCallUntil: String(onCall[0].ends_at) } : {}) },
        clients: orgs.map((o) => ({ id: String(o.id), name: String(o.name) })),
        actingFor: deleg.map((d) => ({ delegationId: String(d.id), forName: "un collègue", until: String(d.ends_at), clientId: String(d.org_id) })),
        synthetic: false,
      };
    },
    async queue(): Promise<QueueItem[]> {
      if (names.size === 0) await api.context();
      const now = new Date().toISOString();
      const [incidents, actions, convs, tickets] = await Promise.all([
        rows(db.from("incidents").select("id, org_id, title, severity, opened_at").in("state", ["open", "mitigated"]).order("opened_at", { ascending: false }).limit(50)),
        rows(db.from("action_requests").select("id, org_id, capability, target_ref, risk_flags, created_at").eq("status", "pending_approval").gt("expires_at", now).limit(50)),
        rows(db.from("conversations").select("id, org_id, category, created_at, escalated_at").eq("state", "waiting_technician").order("created_at").limit(100)),
        rows(db.from("tickets").select("conversation_id, title, priority, sla_due_at, external_ref").in("status", ["new", "open", "pending"]).not("conversation_id", "is", null).limit(200)),
      ]);
      const byConv = new Map(tickets.map((t) => [String(t.conversation_id), t]));
      const items: QueueItem[] = [
        ...incidents.map((i): QueueItem => ({
          key: `incident:${i.id}`, kind: "incident", client: client(String(i.org_id)), title: String(i.title),
          detail: i.severity === "critical" ? "Incident critique" : i.severity === "major" ? "Incident majeur" : "Incident", since: String(i.opened_at),
          priority: i.severity === "critical" || i.severity === "major" ? "urgent" : "normal", target: { type: "incident", id: String(i.id) },
        })),
        ...actions.map((a): QueueItem => ({
          key: `approval:${a.id}`, kind: "approval", client: client(String(a.org_id)),
          title: CAPABILITY_TITLE[String(a.capability)]?.(String(a.target_ref)) ?? String(a.capability),
          detail: Array.isArray(a.risk_flags) && a.risk_flags.length ? "Signaux à vérifier avant de valider" : "Préparée par Relève, identité à vérifier",
          since: String(a.created_at), priority: Array.isArray(a.risk_flags) && a.risk_flags.length ? "high" : "normal", target: { type: "approval", id: String(a.id) },
        })),
        ...convs.map((c): QueueItem => {
          const t = byConv.get(String(c.id));
          return {
            key: `conversation:${c.id}`, kind: t?.sla_due_at ? "sla" : "escalation", client: client(String(c.org_id)),
            title: t ? String(t.title) : "Demande transmise par Relève", detail: `Catégorie : ${CATEGORY[String(c.category)] ?? CATEGORY.other}`,
            since: String(c.created_at), priority: PRIORITY[String(t?.priority)] ?? "normal",
            ...(t?.external_ref ? { ticketRef: String(t.external_ref) } : {}), ...(t?.sla_due_at ? { slaDueAt: String(t.sla_due_at) } : {}),
            target: { type: "conversation", id: String(c.id) },
          };
        }),
      ];
      return items;
    },
    async away(): Promise<AwaySummary> {
      const since = new Date(Date.now() - 12 * 3600_000).toISOString();
      const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
        const { count: n, error } = await q;
        if (error) throw new ApiError(503, "unavailable");
        return n ?? 0;
      };
      const head = { count: "exact" as const, head: true };
      const [ai, team, approve, escalated, majors] = await Promise.all([
        count(db.from("conversations").select("id", head).eq("resolution", "ai_confirmed").gte("resolved_at", since)),
        count(db.from("conversations").select("id", head).eq("resolution", "human").gte("resolved_at", since)),
        count(db.from("action_requests").select("id", head).eq("status", "pending_approval").gt("expires_at", new Date().toISOString())),
        count(db.from("conversations").select("id", head).gte("escalated_at", since)),
        rows(db.from("incidents").select("id, org_id, title").in("state", ["open", "mitigated"]).in("severity", ["major", "critical"]).limit(5)),
      ]);
      return {
        since, resolvedByReleve: ai, resolvedByTeam: team, toApprove: approve, escalated,
        watch: majors.map((m) => ({ title: String(m.title), client: client(String(m.org_id)), target: { type: "incident" as const, id: String(m.id) } })),
      };
    },
    async conversation(clientId, id): Promise<ConversationDetail> {
      const me = claimsOf(await session.accessToken()).sub;
      const [conv] = await rows(db.from("conversations").select("id, org_id, state, category, created_at, relief_active, assigned_to, directory_user_id").eq("id", id).eq("org_id", clientId).limit(1));
      if (!conv) throw new ApiError(404, "not_found");
      const [msgs, tickets, mine, person] = await Promise.all([
        rows(db.from("messages").select("id, role, visibility, content, created_at, author_id").eq("conversation_id", id).order("created_at").limit(300)),
        rows(db.from("tickets").select("title, priority, sla_due_at, external_ref, external_url").eq("conversation_id", id).limit(1)),
        rows(db.from("response_ratings").select("message_id, rating").eq("rated_by", me ?? "")),
        conv.directory_user_id ? rows(db.from("directory_users").select("display_name").eq("id", conv.directory_user_id).limit(1)) : Promise.resolve([] as Row[]),
      ]);
      const ratings = new Map(mine.map((r) => [String(r.message_id), r.rating]));
      const t = tickets[0];
      const messages: ConsoleMessage[] = msgs.map((m) => ({
        id: String(m.id),
        role: m.role === "system" ? "notice" : m.role,
        visibility: m.visibility === "technician" ? "technician" : "public",
        content: String(m.content),
        at: String(m.created_at),
        ...(m.role === "technician" && m.author_id === me ? { authorName: "Vous" } : {}),
        rateable: m.role === "assistant",
        ...(ratings.has(String(m.id)) ? { myRating: ratings.get(String(m.id)) } : {}),
      }));
      const firstUser = messages.find((m) => m.role === "user")?.content ?? "";
      return {
        id, client: client(clientId), title: t ? String(t.title) : firstUser.slice(0, 80) || "Demande", state: conv.state,
        category: (conv.category ?? null) as Category | null, requester: String(person[0]?.display_name ?? "Salarié"), openedAt: String(conv.created_at),
        reliefActive: conv.relief_active === true, assignedToMe: conv.assigned_to === me,
        ...(t ? { ticket: { ref: String(t.external_ref ?? "Ticket local"), priority: PRIORITY[String(t.priority)] ?? "normal", ...(t.sla_due_at ? { slaDueAt: String(t.sla_due_at) } : {}), ...(t.external_url ? { url: String(t.external_url) } : {}) } } : {}),
        messages,
      };
    },
    async approval(clientId, id): Promise<ApprovalDetail> {
      const [a] = await rows(db.from("action_requests").select("id, org_id, capability, target_ref, created_at, expires_at, params_hash, risk_flags, conversation_id").eq("id", id).eq("org_id", clientId).limit(1));
      if (!a) throw new ApiError(404, "not_found");
      const flags = Array.isArray(a.risk_flags) ? a.risk_flags.map(String) : [];
      return {
        id, client: client(clientId), capability: String(a.capability), target: String(a.target_ref), requestedAt: String(a.created_at), expiresAt: String(a.expires_at),
        paramsHash: String(a.params_hash), context: ["Préparée par Relève à partir de la demande du salarié", "Vérifiez l'identité par un autre moyen avant de valider"],
        riskFlags: flags, ...(a.conversation_id ? { conversationId: String(a.conversation_id) } : {}), identityRequired: true,
      };
    },
    async incident(clientId, id): Promise<IncidentDetail> {
      const [i] = await rows(db.from("incidents").select("id, org_id, title, category, severity, state, opened_at, resolved_at").eq("id", id).eq("org_id", clientId).limit(1));
      if (!i) throw new ApiError(404, "not_found");
      const [alerts, linked] = await Promise.all([
        rows(db.from("alerts").select("first_seen_at, summary, severity").eq("incident_id", id).order("first_seen_at").limit(50)),
        rows(db.from("incident_conversations").select("created_at").eq("incident_id", id).order("created_at").limit(500)),
      ]);
      const timeline: TimelineEntry[] = [
        ...alerts.map((a): TimelineEntry => ({ at: String(a.first_seen_at), kind: "alert", text: String(a.summary ?? "Alerte de supervision") })),
        ...(linked.length ? [{ at: String(linked[0]?.created_at), kind: "request" as const, text: `Première demande rattachée (${linked.length} au total)` }] : []),
        ...(i.resolved_at ? [{ at: String(i.resolved_at), kind: "resolution" as const, text: "Incident résolu" }] : []),
      ].sort((x, y) => (x.at < y.at ? -1 : 1));
      return {
        id, client: client(clientId), title: String(i.title), category: (i.category ?? null) as Category | null, severity: i.severity, state: i.state,
        openedAt: String(i.opened_at), requests: linked.length, timeline,
      };
    },
    async search(q): Promise<SearchHit[]> {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      const items = await api.queue();
      return [
        ...[...names].filter(([, n]) => n.toLowerCase().includes(s)).map(([id, n]): SearchHit => ({ kind: "client", label: n, hint: "Client", client: { id, name: n } })),
        ...items.filter((i) => `${i.title} ${i.client.name} ${i.ticketRef ?? ""}`.toLowerCase().includes(s))
          .map((i): SearchHit => ({ kind: i.target.type, label: i.title, hint: `${i.client.name}${i.ticketRef ? ` · ${i.ticketRef}` : ""}`, client: i.client, target: i.target })),
      ].slice(0, 12);
    },

    // ---------------------------------------------------------------- gestes
    async reply(clientId, conversationId, text, internal) {
      await call("console", { orgId: clientId, op: "reply", conversationId, text, internal });
    },
    async take(clientId, conversationId) {
      await call("console", { orgId: clientId, op: "take", conversationId });
    },
    async resolve(clientId, conversationId) {
      await call("console", { orgId: clientId, op: "resolve", conversationId });
    },
    async rate(clientId, messageId, rating, reason) {
      const me = claimsOf(await session.accessToken()).sub;
      const { error } = await db.from("response_ratings").insert({ org_id: clientId, message_id: messageId, kind: "answer", rating, reason: reason ?? null, rated_by: me });
      if (error) throw new ApiError(409, "conflict");
    },
    async approve(clientId, a, identity, viaDelegationId) {
      const [connector] = await rows(db.from("connectors").select("tenant_id").eq("org_id", clientId).eq("type", "m365").eq("status", "ok").limit(1));
      const token = await microsoftToken({ tenantId: String(connector?.tenant_id ?? ""), capability: a.capability });
      return await call<{ outcome: string }>("actions", {
        orgId: clientId, op: "approve", actionId: a.id, seenHash: a.paramsHash, identityMethod: identity,
        ...(viaDelegationId ? { viaDelegationId } : {}), microsoftToken: token,
      });
    },
    async reject(clientId, id, reason) {
      await call("actions", { orgId: clientId, op: "reject", actionId: id, reason });
    },
  };
  return api;
}
