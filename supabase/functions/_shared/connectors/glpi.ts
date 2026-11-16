// Connecteur GLPI par l'API REST historique (apirest.php), documentée par le projet GLPI (initSession, killSession, génériques
// POST/GET/PUT par type d'élément, search). Choix :
//   - une session par appel (les fonctions n'ont pas d'état) : initSession puis killSession en « finally » ;
//   - les jetons (utilisateur et application) viennent du coffre à chaque appel, jamais de la configuration ni du journal ;
//   - toute référence de ticket est validée (chiffres seulement) avant d'entrer dans une adresse : pas de détournement de chemin ;
//   - tout texte venu d'un salarié est NEUTRALISÉ avant d'entrer dans un champ de GLPI (champs riches : pas de balise) ;
//   - aucune réponse de GLPI n'est renvoyée telle quelle : on en extrait les champs attendus, bornés.
// À VALIDER sur une instance réelle (non décrit par la documentation de l'API générique, fixé ici d'après le code de GLPI) : les valeurs
// de statut, le type de lien « fils de », le nom des champs d'un suivi et les numéros de colonnes de recherche. Ils sont isolés dans les
// constantes ci-dessous pour qu'un écart se corrige à un seul endroit ; un contrôle de contrat les vérifie au premier essai réel.
import { CapabilityIO, CapabilityName, Connector, ConnectorHealth, DemoCapability, InvocationContext, TicketView } from "../capabilities/types.ts";
import type { ConnectorRow } from "../capabilities/registry.ts";
import { baseOf, ConnectorHttpError, HttpOptions, requestJson } from "./http.ts";

export const GLPI_STATUS = { new: 1, processing: 2, planned: 3, pending: 4, solved: 5, closed: 6 } as const;
const STATUS_NAME: Readonly<Record<number, string>> = { 1: "new", 2: "processing", 3: "planned", 4: "pending", 5: "solved", 6: "closed" };
export const GLPI_LINK_SON_OF = 3; // Ticket_Ticket : « est le fils de »
export const GLPI_SEARCH_FIELDS = { title: 1, id: 2, status: 12, updated: 19 } as const;
const URGENCY = { low: 2, normal: 3, high: 4, urgent: 5 } as const;

const CAPABILITIES: readonly DemoCapability[] = ["ticket.create", "ticket.get", "ticket.search", "ticket.comment", "ticket.link_parent", "ticket.update_status"];
const DIGITS = /^\d{1,10}$/;
const SESSION = /^[A-Za-z0-9]{8,200}$/;
const MAX_TITLE = 250;
const MAX_CONTENT = 20_000;

export interface GlpiDeps {
  /** Secret du connecteur : JSON {"user_token": "...", "app_token": "..."} (le jeton d'application est facultatif). */
  secret: () => Promise<string>;
  http?: HttpOptions;
}

interface Creds { userToken: string; appToken: string | null }

export function parseGlpiSecret(raw: string): Creds {
  let o: unknown;
  try { o = JSON.parse(raw); } catch { throw new ConnectorHttpError("config"); }
  const r = (o ?? {}) as Record<string, unknown>;
  const u = r.user_token;
  const a = r.app_token;
  if (typeof u !== "string" || u.length < 8 || u.length > 200 || /\s/.test(u)) throw new ConnectorHttpError("config");
  if (a !== undefined && a !== null && (typeof a !== "string" || a.length < 8 || a.length > 200 || /\s/.test(a))) throw new ConnectorHttpError("config");
  return { userToken: u, appToken: typeof a === "string" ? a : null };
}

/** Texte d'un salarié ou d'une IA vers un champ riche de GLPI : plus aucune balise, fins de ligne normalisées, longueur bornée. */
export function neutralize(text: unknown, max: number): string {
  let s = "";
  for (const ch of String(text ?? "").replace(/\r\n?/g, "\n")) {
    const c = ch.codePointAt(0) as number;
    if (c === 0x0a || c === 0x09 || (c >= 0x20 && c !== 0x7f)) s += ch; // on garde les fins de ligne et les tabulations, on retire les autres caractères de contrôle
  }
  return s.replace(/</g, "‹").replace(/>/g, "›").slice(0, max);
}

function ref(raw: unknown): string {
  if (typeof raw !== "string" || !DIGITS.test(raw)) throw new ConnectorHttpError("rejected", 400);
  return raw;
}

export class GlpiConnector implements Connector {
  readonly type = "glpi" as const;
  readonly id: string;
  readonly environment: "test" | "production" | null;
  private readonly base: string;
  private readonly api: string;

  constructor(row: ConnectorRow, private readonly deps: GlpiDeps) {
    this.id = row.id;
    this.environment = row.environment;
    this.base = baseOf(row.config?.base_url, deps.http?.allowedSuffixes ?? []);
    this.api = `${this.base}/apirest.php`;
  }

  capabilities(): ReadonlySet<CapabilityName> {
    return new Set<CapabilityName>(CAPABILITIES);
  }

  async health(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    try {
      await this.withSession(() => Promise.resolve());
      return { ok: true, checkedAt };
    } catch (e) {
      return { ok: false, checkedAt, detail: e instanceof ConnectorHttpError ? e.kind : "unavailable" };
    }
  }

  invokeCapability<N extends DemoCapability>(name: N, params: CapabilityIO[N]["params"], _ctx: InvocationContext): Promise<CapabilityIO[N]["result"]> {
    try {
      // Tout est validé AVANT d'ouvrir une session : un paramètre invalide ne produit aucun appel réseau.
      const plan = this.plan(name, params);
      if (plan === null) return Promise.resolve([] as CapabilityIO[N]["result"]);
      return this.withSession(plan) as Promise<CapabilityIO[N]["result"]>;
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /** Valide les paramètres et renvoie l'opération à exécuter dans une session ; null = résultat vide sans appel. */
  private plan(name: DemoCapability, params: unknown): ((call: Call) => Promise<unknown>) | null {
    if (!CAPABILITIES.includes(name)) throw new ConnectorHttpError("rejected", 400);
    // deno-lint-ignore no-explicit-any
    const p = params as any;
    switch (name) {
      case "ticket.create": {
        if (URGENCY[p.priority as keyof typeof URGENCY] === undefined) throw new ConnectorHttpError("rejected", 400);
        if (p.parentRef) ref(p.parentRef);
        return (call) => this.create(call, p);
      }
      case "ticket.get": { const id = ref(p.ref); return (call) => this.get(call, id); }
      case "ticket.search": {
        const q = neutralize(p.query, 200).trim();
        if (q.length === 0) return null;
        const limit = Number(p.limit ?? 10);
        return (call) => this.search(call, q, limit);
      }
      case "ticket.comment": {
        const id = Number(ref(p.ref));
        const content = neutralize(p.body, MAX_CONTENT);
        const isPrivate = p.internal === false ? 0 : 1; // par défaut PRIVÉ : un suivi n'est public que si on l'a demandé explicitement
        return async (call) => { await call("POST", "ITILFollowup", { input: { itemtype: "Ticket", items_id: id, content, is_private: isPrivate } }); return { ok: true }; };
      }
      case "ticket.update_status": {
        const status = ({ solved: GLPI_STATUS.solved, closed: GLPI_STATUS.closed, pending: GLPI_STATUS.pending } as Record<string, number>)[String(p.status)];
        if (status === undefined) throw new ConnectorHttpError("rejected", 400);
        const id = ref(p.ref);
        return async (call) => { await call("PUT", `Ticket/${id}`, { input: { status } }); return { ok: true }; };
      }
      case "ticket.link_parent": {
        const child = Number(ref(p.childRef));
        const parent = Number(ref(p.parentRef));
        return async (call) => { await call("POST", "Ticket_Ticket", { input: { tickets_id_1: child, tickets_id_2: parent, link: GLPI_LINK_SON_OF } }); return { ok: true }; };
      }
      default: throw new ConnectorHttpError("rejected", 400);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- opérations
  private async create(call: Call, p: CapabilityIO["ticket.create"]["params"]): Promise<{ ref: string; url: string }> {
    const urgency = URGENCY[p.priority];
    if (urgency === undefined) throw new ConnectorHttpError("rejected", 400);
    const lines = [
      neutralize(p.body, MAX_CONTENT),
      "",
      `Demandeur (Relève) : ${neutralize(p.requesterRef, 320)}`,
      `Catégorie (Relève) : ${neutralize(p.category, 40)}`,
    ];
    if (p.diagnosticSummary) lines.push("", "Diagnostic déjà effectué par Relève :", neutralize(p.diagnosticSummary, 2000));
    const out = await call("POST", "Ticket", { input: { name: neutralize(p.title, MAX_TITLE).replace(/\n/g, " "), content: lines.join("\n").slice(0, MAX_CONTENT), urgency, type: 1 } });
    const id = (out as { id?: unknown })?.id;
    if (typeof id !== "number" && typeof id !== "string") throw new ConnectorHttpError("bad_response");
    const created = ref(String(id));
    if (p.parentRef) await call("POST", "Ticket_Ticket", { input: { tickets_id_1: Number(created), tickets_id_2: Number(ref(p.parentRef)), link: GLPI_LINK_SON_OF } });
    return { ref: created, url: this.urlOf(created) };
  }

  private async get(call: Call, id: string): Promise<TicketView> {
    return this.view(await call("GET", `Ticket/${id}`), id);
  }

  private async search(call: Call, query: string, limit: number): Promise<TicketView[]> {
    const q = query;
    const n = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 10, 1), 50);
    const params = new URLSearchParams();
    params.set("criteria[0][field]", String(GLPI_SEARCH_FIELDS.title));
    params.set("criteria[0][searchtype]", "contains");
    params.set("criteria[0][value]", q);
    [GLPI_SEARCH_FIELDS.id, GLPI_SEARCH_FIELDS.title, GLPI_SEARCH_FIELDS.status, GLPI_SEARCH_FIELDS.updated].forEach((f, i) => params.set(`forcedisplay[${i}]`, String(f)));
    params.set("range", `0-${n - 1}`);
    const out = await call("GET", `search/Ticket?${params.toString()}`) as { data?: unknown } | null;
    const rows = Array.isArray(out?.data) ? out.data as Array<Record<string, unknown>> : [];
    return rows.slice(0, n).map((row) => {
      const id = String(row[String(GLPI_SEARCH_FIELDS.id)] ?? "");
      return {
        ref: ref(id), url: this.urlOf(id), title: neutralize(row[String(GLPI_SEARCH_FIELDS.title)], MAX_TITLE),
        status: STATUS_NAME[Number(row[String(GLPI_SEARCH_FIELDS.status)])] ?? "unknown", updatedAt: this.iso(row[String(GLPI_SEARCH_FIELDS.updated)]),
      };
    });
  }

  private view(o: unknown, id: string): TicketView {
    const t = (o ?? {}) as Record<string, unknown>;
    return { ref: id, url: this.urlOf(id), title: neutralize(t.name, MAX_TITLE), status: STATUS_NAME[Number(t.status)] ?? "unknown", updatedAt: this.iso(t.date_mod) };
  }

  private iso(v: unknown): string {
    const ms = typeof v === "string" ? Date.parse(v.replace(" ", "T") + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? "" : "Z")) : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(0).toISOString();
  }

  private urlOf(id: string): string {
    return `${this.base}/front/ticket.form.php?id=${ref(id)}`;
  }

  // ---------------------------------------------------------------------------------------------------------------- session
  private async withSession<T>(fn: (call: Call) => Promise<T>): Promise<T> {
    const creds = parseGlpiSecret(await this.deps.secret());
    const app: Record<string, string> = creds.appToken ? { "app-token": creds.appToken } : {};
    const init = await requestJson(`${this.api}/initSession`, { method: "GET", headers: { authorization: `user_token ${creds.userToken}`, ...app } }, this.deps.http);
    const session = (init.json as { session_token?: unknown } | null)?.session_token;
    if (typeof session !== "string" || !SESSION.test(session)) throw new ConnectorHttpError("bad_response");
    const headers: Record<string, string> = { "session-token": session, ...app };
    const call: Call = async (method, path, body) => (await requestJson(`${this.api}/${path}`, { method, headers, body }, this.deps.http)).json;
    try {
      return await fn(call);
    } finally {
      await requestJson(`${this.api}/killSession`, { method: "GET", headers }, this.deps.http).catch(() => {});
    }
  }
}

type Call = (method: "GET" | "POST" | "PUT", path: string, body?: unknown) => Promise<unknown>;
