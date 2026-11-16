// Connecteur Microsoft 365 (Microsoft Graph v1.0). DEUX régimes de droits, jamais mélangés (docs/permissions-graph.md) :
//   LECTURE (diagnostic, état des services) : jeton d'APPLICATION en lecture seule, car l'agent lit pendant le chat, sans technicien présent ;
//   ÉCRITURE (quatre actions) : UNIQUEMENT le jeton DÉLÉGUÉ du technicien qui valide, déjà lié à son compte par l'exécuteur. L'application
//   n'a AUCUNE permission d'écriture (menace M05) : elle ne pourrait pas écrire, même si ce code se trompait.
// Règles : adresses Graph et d'authentification FIXES (jamais fournies par un client) ; identifiants validés avant d'entrer dans une adresse ;
// un mot de passe temporaire n'est remis qu'APRÈS confirmation de Microsoft que la réinitialisation a abouti, par le canal à usage unique ;
// toute erreur est typée sans donnée sensible ; une issue incertaine après une écriture est « unknown » (jamais rejouée seule).
// À VALIDER sur le tenant de test : l'historique des connexions par l'API peut exiger une licence Entra ID Premium P1 ; les noms de segments
// de suppression des méthodes d'authentification ; la durée de l'opération de réinitialisation. Panne de la lecture = le diagnostic échoue
// (échec FERMÉ : jamais de « aucun signe de risque » deviné).
import type { ConnectorRow } from "../capabilities/registry.ts";
import type { CapabilityIO, CapabilityName, Connector, ConnectorHealth, DemoCapability, InvocationContext, ServiceHealth, UserDiagnosis } from "../capabilities/types.ts";
import { ConnectorError } from "../actions/types.ts";
import { ConnectorHttpError, HttpMethod, HttpOptions, requestJson } from "./http.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";
const PASSWORD_METHOD_ID = "28c10230-6103-485e-b985-444c60001490"; // identifiant fixe de la méthode « mot de passe » (documentation Microsoft Graph)
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Nom d'utilisateur (UPN) : lettres, chiffres et quelques signes ; jamais de « / ? # % \ » ni d'espace. */
const UPN = /^[A-Za-z0-9._'+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const METHOD_ID = /^[A-Za-z0-9_-]{1,100}$/;
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{20,6000}$/;

/** Codes d'erreur de connexion que nous comptons comme des ÉCHECS (à calibrer) : mauvais identifiants, compte verrouillé, désactivé, mot de passe expiré. */
export const FAILED_SIGNIN_CODES: ReadonlySet<number> = new Set([50126, 50053, 50057, 50055]);
export const LOCKED_SIGNIN_CODE = 50053;
const FAILED_WINDOW_MS = 24 * 3_600_000;
const LOCKED_WINDOW_MS = 30 * 60_000;
const POLL_TRIES = 3;

/** @odata.type d'une méthode d'authentification → segment d'adresse pour la supprimer (« exiger une nouvelle inscription du second facteur »). */
const DELETE_SEGMENT: Readonly<Record<string, string>> = {
  microsoftAuthenticatorAuthenticationMethod: "microsoftAuthenticatorMethods",
  phoneAuthenticationMethod: "phoneMethods",
  softwareOathAuthenticationMethod: "softwareOathMethods",
  fido2AuthenticationMethod: "fido2Methods",
  windowsHelloForBusinessAuthenticationMethod: "windowsHelloForBusinessMethods",
  emailAuthenticationMethod: "emailMethods",
  temporaryAccessPassAuthenticationMethod: "temporaryAccessPassMethods",
  platformCredentialAuthenticationMethod: "platformCredentialMethods",
};

const CAPABILITIES: readonly DemoCapability[] = ["user.diagnose", "tenant.service_health", "user.reset_password", "user.unlock", "user.revoke_sessions", "user.mfa_reregister"];
const WRITE: ReadonlySet<DemoCapability> = new Set(["user.reset_password", "user.unlock", "user.revoke_sessions", "user.mfa_reregister"]);

export interface M365Deps {
  /** Identifiant et secret de l'application Relève (un seul pour tous les clients, en secrets de la fonction) ; null = non configurée. */
  appCredentials: () => { clientId: string; clientSecret: string } | null;
  http?: HttpOptions;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Lecture d'un tableau « value » de Microsoft Graph, borné. */
function items(json: unknown, max = 200): Array<Record<string, unknown>> {
  const v = (json as { value?: unknown } | null)?.value;
  return Array.isArray(v) ? (v.slice(0, max) as Array<Record<string, unknown>>) : [];
}

/** Paramètres de requête OData : les NOMS gardent leur « $ », les VALEURS sont encodées. */
function query(params: Record<string, string>): string {
  return "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export class M365Connector implements Connector {
  readonly type = "m365" as const;
  readonly id: string;
  readonly environment: "test" | "production" | null;
  private readonly tenant: string;
  private readonly http: HttpOptions;
  private appTokenCache: string | null = null;

  constructor(row: ConnectorRow, private readonly deps: M365Deps) {
    this.id = row.id;
    this.environment = row.environment;
    if (typeof row.tenant_id !== "string" || !GUID.test(row.tenant_id)) throw new ConnectorHttpError("config");
    this.tenant = row.tenant_id.toLowerCase();
    // Les adresses de Microsoft sont FIXES : la liste blanche réservée aux serveurs de clients ne s'y applique pas.
    this.http = { ...deps.http, allowedSuffixes: [] };
  }

  capabilities(): ReadonlySet<CapabilityName> {
    return new Set<CapabilityName>(CAPABILITIES);
  }

  async health(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const token = await this.appToken();
      await this.graph("GET", `/users${query({ "$top": "1", "$select": "id" })}`, token);
      return { ok: true, checkedAt };
    } catch (e) {
      return { ok: false, checkedAt, detail: e instanceof ConnectorHttpError ? e.kind : "unavailable" };
    }
  }

  async invokeCapability<N extends DemoCapability>(name: N, params: CapabilityIO[N]["params"], ctx: InvocationContext): Promise<CapabilityIO[N]["result"]> {
    if (!CAPABILITIES.includes(name)) throw new ConnectorHttpError("rejected", 400);
    // deno-lint-ignore no-explicit-any
    const p = params as any;
    if (name === "tenant.service_health") return await this.serviceHealth() as CapabilityIO[N]["result"];
    const upn = this.upn(p?.userRef);
    if (name === "user.diagnose") return await this.diagnose(upn) as CapabilityIO[N]["result"];
    return await this.write(name, upn, ctx) as CapabilityIO[N]["result"];
  }

  private upn(raw: unknown): string {
    if (typeof raw !== "string" || !UPN.test(raw)) throw new ConnectorHttpError("rejected", 400);
    return raw;
  }

  // ---------------------------------------------------------------------------------------------------------------- jetons et appels
  private async appToken(): Promise<string> {
    if (this.appTokenCache) return this.appTokenCache;
    const creds = this.deps.appCredentials();
    if (!creds) throw new ConnectorHttpError("config");
    const r = await requestJson(`${LOGIN}/${this.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      form: { client_id: creds.clientId, client_secret: creds.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" },
    }, this.http);
    const token = (r.json as { access_token?: unknown } | null)?.access_token;
    if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw new ConnectorHttpError("bad_response");
    this.appTokenCache = token;
    return token;
  }

  private graph(method: HttpMethod, path: string, token: string, body?: unknown) {
    return requestJson(`${GRAPH}${path}`, { method, headers: { authorization: `Bearer ${token}` }, body }, this.http);
  }

  // ---------------------------------------------------------------------------------------------------------------- lecture
  private async diagnose(upn: string): Promise<UserDiagnosis> {
    const token = await this.appToken();
    const u = (await this.graph("GET", `/users/${encodeURIComponent(upn)}${query({ "$select": "id,accountEnabled,lastPasswordChangeDateTime" })}`, token)).json as Record<string, unknown> | null;
    const id = u?.id;
    if (typeof id !== "string" || !GUID.test(id)) throw new ConnectorHttpError("bad_response");
    const now = (this.deps.nowMs ?? Date.now)();

    const methods = items((await this.graph("GET", `/users/${id}/authentication/methods`, token)).json);
    const since = new Date(now - FAILED_WINDOW_MS).toISOString();
    const signIns = items((await this.graph("GET", `/auditLogs/signIns${query({ "$filter": `userId eq '${id}' and createdDateTime ge ${since}`, "$top": "100", "$select": "createdDateTime,status" })}`, token)).json, 100);
    const roles = items((await this.graph("GET", `/roleManagement/directory/roleAssignments${query({ "$filter": `principalId eq '${id}'`, "$top": "5" })}`, token)).json, 5);

    let failed = 0;
    let locked = false;
    for (const s of signIns) {
      const code = Number((s.status as { errorCode?: unknown } | undefined)?.errorCode);
      if (!FAILED_SIGNIN_CODES.has(code)) continue;
      failed++;
      if (code === LOCKED_SIGNIN_CODE && now - Date.parse(String(s.createdDateTime)) <= LOCKED_WINDOW_MS) locked = true;
    }
    return {
      accountEnabled: u?.accountEnabled === true,
      locked,
      mfaMethods: methods
        .map((m) => ({ type: String(m["@odata.type"] ?? "").replace("#microsoft.graph.", "").replace(/AuthenticationMethod$/, ""), createdAt: String(m.createdDateTime ?? m.creationDateTime ?? "") }))
        .filter((m) => m.type !== "password"),
      lastPasswordChangeAt: typeof u?.lastPasswordChangeDateTime === "string" ? u.lastPasswordChangeDateTime : undefined,
      recentFailedSignIns: failed,
      hasPrivilegedRole: roles.length > 0,
    };
  }

  private async serviceHealth(): Promise<ServiceHealth[]> {
    const token = await this.appToken();
    const rows = items((await this.graph("GET", "/admin/serviceAnnouncement/healthOverviews", token)).json, 100);
    return rows.map((r) => ({ service: String(r.service ?? "").slice(0, 80), status: healthStatus(String(r.status ?? "")) }));
  }

  // ---------------------------------------------------------------------------------------------------------------- écriture
  private async write(name: DemoCapability, upn: string, ctx: InvocationContext): Promise<unknown> {
    if (!WRITE.has(name)) throw new ConnectorHttpError("rejected", 400);
    // Jamais avec le jeton de l'application : seulement avec celui du technicien qui valide. (L'exécuteur l'a déjà lié à son compte.)
    if (ctx.actor.kind !== "human" || typeof ctx.actor.delegatedToken !== "string" || !TOKEN_SHAPE.test(ctx.actor.delegatedToken)) {
      throw new ConnectorError("failed", "m365:no_delegated_token");
    }
    const token = ctx.actor.delegatedToken;
    const target = `/users/${encodeURIComponent(upn)}`;
    const state = { mutated: 0 };
    try {
      switch (name) {
        case "user.reset_password": return await this.resetPassword(target, token, ctx, state);
        case "user.unlock": {
          await this.graph("PATCH", target, token, { accountEnabled: true });
          state.mutated++;
          return { ok: true };
        }
        case "user.revoke_sessions": {
          const r = await this.graph("POST", `${target}/revokeSignInSessions`, token);
          state.mutated++;
          if ((r.json as { value?: unknown } | null)?.value !== true) throw new ConnectorError("unknown", "m365:bad_response");
          return { ok: true };
        }
        case "user.mfa_reregister": return await this.reregisterMfa(target, token, state);
        default: throw new ConnectorHttpError("rejected", 400);
      }
    } catch (e) {
      if (e instanceof ConnectorError) throw e;
      if (e instanceof ConnectorHttpError) {
        // Aucune écriture n'a ABOUTI et Microsoft a explicitement refusé (droits, cible, paramètre) : échec CERTAIN. Une panne réseau, un délai ou
        // une réponse illisible laissent un doute (l'écriture a peut-être eu lieu) ; après une première écriture réussie, tout échec est incertain.
        const certain = state.mutated === 0 && (e.kind === "auth" || e.kind === "not_found" || e.kind === "rejected" || e.kind === "config");
        throw new ConnectorError(certain ? "failed" : "unknown", `m365:${e.kind}`);
      }
      throw new ConnectorError("unknown", "m365:error");
    }
  }

  private async resetPassword(target: string, token: string, ctx: InvocationContext, state: { mutated: number }) {
    // Sans canal pour remettre le mot de passe au technicien, on ne réinitialise RIEN : un mot de passe que personne ne connaît bloquerait le salarié.
    if (!ctx.deliverSecret) throw new ConnectorError("failed", "m365:no_secret_channel");
    const r = await this.graph("POST", `${target}/authentication/methods/${PASSWORD_METHOD_ID}/resetPassword`, token, {});
    state.mutated++; // Microsoft a ACCEPTÉ la demande : la suite (confirmation) ne peut plus être un échec certain
    const generated = (r.json as { newPassword?: unknown } | null)?.newPassword;
    const location = r.headers.get("location");
    if (r.status !== 202 || typeof generated !== "string" || generated.length < 8 || generated.length > 256 || !location) throw new ConnectorError("unknown", "m365:bad_response");
    // L'opération est asynchrone : on ne remet le mot de passe qu'une fois sa réussite CONFIRMÉE par Microsoft.
    if (!(await this.confirmed(location, token))) throw new ConnectorError("unknown", "m365:not_confirmed");
    ctx.deliverSecret({ kind: "temporary_password", value: generated });
    return { ok: true, temporaryPasswordDeliveredTo: "technician" as const };
  }

  /** Interroge l'opération de longue durée. L'adresse reçue est un DONNÉE : elle doit rester sous l'adresse fixe de Graph. */
  private async confirmed(location: string, token: string): Promise<boolean> {
    if (!location.startsWith(`${GRAPH}/users/`) || !location.includes("/authentication/operations/") || location.length > 500) throw new ConnectorError("unknown", "m365:bad_location");
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let i = 0; i < POLL_TRIES; i++) {
      const r = await requestJson(location, { method: "GET", headers: { authorization: `Bearer ${token}` } }, this.http);
      const status = String((r.json as { status?: unknown } | null)?.status ?? "").toLowerCase();
      if (status === "succeeded") return true;
      if (status === "failed") throw new ConnectorError("failed", "m365:reset_failed");
      if (i < POLL_TRIES - 1) await sleep(1000);
    }
    return false;
  }

  private async reregisterMfa(target: string, token: string, state: { mutated: number }) {
    const methods = items((await this.graph("GET", `${target}/authentication/methods`, token)).json);
    const deletable: Array<{ segment: string; id: string }> = [];
    let remaining = 0;
    for (const m of methods) {
      const type = String(m["@odata.type"] ?? "").replace("#microsoft.graph.", "");
      if (type === "passwordAuthenticationMethod") continue;
      const segment = DELETE_SEGMENT[type];
      const id = String(m.id ?? "");
      if (segment && METHOD_ID.test(id)) deletable.push({ segment, id });
      else remaining++;
    }
    for (const d of deletable) {
      await this.graph("DELETE", `${target}/authentication/${d.segment}/${d.id}`, token);
      state.mutated++;
    }
    // Une méthode qu'on ne sait pas supprimer subsiste : l'utilisateur ne serait pas invité à se réinscrire. Incertain, pas un succès.
    if (remaining > 0) throw new ConnectorError(state.mutated > 0 ? "unknown" : "failed", "m365:method_not_deletable");
    return { ok: true as const };
  }
}

/** États de Microsoft (ServiceOperational, ServiceDegradation, ServiceInterruption, ...) → trois états. Un état inconnu est « incident » : on ne rassure pas à tort. */
export function healthStatus(raw: string): ServiceHealth["status"] {
  const s = raw.toLowerCase();
  if (s === "serviceoperational" || s === "servicerestored" || s === "falsepositive" || s === "postincidentreviewpublished") return "operational";
  if (s === "servicedegradation" || s === "investigating" || s === "restoringservice") return "degraded";
  return "incident";
}

/** Revendications NON vérifiées d'un jeton (lecture seule de la partie centrale) : servent à refuser tôt, jamais à accorder. */
function unverifiedClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part || part.length > 6000) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    return o && typeof o === "object" && !Array.isArray(o) ? o as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * « Connecter mon compte Microsoft » (histoire T12). Le jeton délégué du technicien est vérifié PAR MICROSOFT (appel de /me : Graph
 * contrôle signature, expiration et destinataire) ; on vérifie ensuite que le compte appartient au tenant DU CONNECTEUR et que l'identifiant
 * d'objet du jeton est celui que Microsoft renvoie. Le jeton n'est ni stocké ni journalisé : seul le lien (tenant, objet, UPN) l'est.
 */
export async function verifyDelegatedIdentity(token: unknown, expectedTenant: string, http: HttpOptions = {}): Promise<{ tenantId: string; objectId: string; upn: string }> {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token) || !GUID.test(expectedTenant)) throw new ConnectorHttpError("rejected", 400);
  const claims = unverifiedClaims(token);
  const tid = typeof claims?.tid === "string" ? claims.tid.toLowerCase() : "";
  const oid = typeof claims?.oid === "string" ? claims.oid.toLowerCase() : "";
  // Refus TÔT (sans appel) : un jeton d'un autre tenant n'a rien à faire ici.
  if (tid !== expectedTenant.toLowerCase() || !GUID.test(oid)) throw new ConnectorHttpError("auth", 403);
  const r = await requestJson(`${GRAPH}/me${query({ "$select": "id,userPrincipalName" })}`, { method: "GET", headers: { authorization: `Bearer ${token}` } }, { ...http, allowedSuffixes: [] });
  const me = (r.json ?? {}) as Record<string, unknown>;
  const id = typeof me.id === "string" ? me.id.toLowerCase() : "";
  const upn = typeof me.userPrincipalName === "string" ? me.userPrincipalName : "";
  if (id !== oid || !UPN.test(upn)) throw new ConnectorHttpError("auth", 403);
  return { tenantId: tid, objectId: oid, upn };
}
