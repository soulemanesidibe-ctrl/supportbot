// Client HTTP SORTANT des connecteurs. Une adresse de serveur (GLPI, par exemple) est fournie par un administrateur : c'est une entrée
// externe, donc une porte possible vers des requêtes détournées (SSRF, menace M16/M26). Règles, toutes vérifiées avant l'envoi :
//   https seulement, port 443 seulement, aucune information d'identification dans l'adresse, aucun nom interne (localhost, .local,
//   .internal, nom sans point), aucune adresse IP écrite en clair (v4, v6, formes décimale ou hexadécimale) ; liste blanche de
//   suffixes de domaine facultative (CONNECTOR_ALLOWED_HOST_SUFFIXES). Jamais de redirection (un jeton ne doit pas partir ailleurs),
//   délai borné, corps de réponse borné. L'erreur ne contient jamais l'adresse complète, un en-tête ni un corps de réponse.
// Limite assumée : le nom de domaine n'est pas résolu avant l'appel (l'environnement d'exécution ne le permet pas) ; une résolution
// vers une adresse privée n'est donc détectée que par la liste blanche de suffixes, que le déploiement du pilote renseigne.

export type ConnectorErrorKind = "config" | "unavailable" | "timeout" | "auth" | "not_found" | "rejected" | "bad_response" | "too_large";

/** Erreur d'un connecteur : fixe, sans donnée sensible. Ne sort jamais telle quelle vers un utilisateur (callCapability la remplace). */
export class ConnectorHttpError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly status?: number;
  constructor(kind: ConnectorErrorKind, status?: number) {
    super(`connecteur : ${kind}${status ? ` (${status})` : ""}`);
    this.name = "ConnectorHttpError";
    this.kind = kind;
    this.status = status;
  }
}

const FORBIDDEN_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".home.arpa", ".corp", ".intranet", ".private", ".test", ".invalid", ".example"];
const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Vrai si le nom ressemble à une adresse IP (v4 en toutes formes, v6) : on ne s'en remet à aucune analyse fine, on refuse tout ce qui n'a pas la forme d'un nom. */
function looksLikeIp(host: string): boolean {
  if (host.includes(":") || host.startsWith("[")) return true;
  // Un nom de domaine se termine par une extension contenant au moins une lettre ; « 127.1 », « 2130706433 », « 0x7f.0.0.1 » ne passent pas.
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  return !/[a-z]/.test(tld) || /^0x/i.test(tld);
}

export function validateConnectorUrl(raw: unknown, allowedSuffixes: readonly string[] = [], maxLength = 300): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maxLength) throw new ConnectorHttpError("config");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConnectorHttpError("config");
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port !== "" && u.port !== "443") || u.hash) throw new ConnectorHttpError("config");
  if (host === "" || !host.includes(".") || host.endsWith(".") || host === "localhost" || looksLikeIp(host)) throw new ConnectorHttpError("config");
  if (FORBIDDEN_SUFFIXES.some((s) => host.endsWith(s))) throw new ConnectorHttpError("config");
  if (allowedSuffixes.length > 0 && !allowedSuffixes.some((s) => host === s.replace(/^\./, "") || host.endsWith(s.startsWith(".") ? s : `.${s}`))) {
    throw new ConnectorHttpError("config");
  }
  return u;
}

export interface HttpOptions { fetch?: typeof fetch; timeoutMs?: number; allowedSuffixes?: readonly string[] }
export interface JsonResponse { status: number; json: unknown; headers: Headers }

/** Adresse de base normalisée (sans barre finale ni chemin de requête) : à partir d'elle, les connecteurs composent leurs adresses. */
export function baseOf(raw: unknown, allowedSuffixes: readonly string[] = []): string {
  const u = validateConnectorUrl(raw, allowedSuffixes);
  u.search = "";
  return u.toString().replace(/\/+$/, "");
}

async function readBounded(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ConnectorHttpError("too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return all;
}

/**
 * Appel JSON. `url` DOIT être déjà validée (baseOf) ; on la revalide quand même : une faute de composition ne doit jamais ouvrir de porte.
 * Les statuts d'erreur deviennent des erreurs typées ; un 3xx est refusé.
 */
export async function requestJson(url: string, init: { method: "GET" | "POST" | "PUT"; headers?: Record<string, string>; body?: unknown }, opts: HttpOptions = {}): Promise<JsonResponse> {
  validateConnectorUrl(url, opts.allowedSuffixes ?? [], 2000); // adresse de requête : plus longue qu'une adresse de configuration (paramètres de recherche)
  const fetchFn = opts.fetch ?? fetch;
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.body !== undefined) {
    if (init.method === "GET") throw new ConnectorHttpError("config"); // GLPI et la plupart des API refusent un corps sur GET
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetchFn(url, { method: init.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS), credentials: "omit" });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new ConnectorHttpError("timeout");
    throw new ConnectorHttpError("unavailable");
  }
  if (res.status >= 300 && res.status < 400) { await res.body?.cancel().catch(() => {}); throw new ConnectorHttpError("rejected", res.status); }
  const raw = await readBounded(res);
  if (res.status === 401 || res.status === 403) throw new ConnectorHttpError("auth", res.status);
  if (res.status === 404) throw new ConnectorHttpError("not_found", 404);
  if (res.status >= 500) throw new ConnectorHttpError("unavailable", res.status);
  if (res.status >= 400) throw new ConnectorHttpError("rejected", res.status);
  if (raw.byteLength === 0) return { status: res.status, json: null, headers: res.headers };
  try {
    return { status: res.status, json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)), headers: res.headers };
  } catch {
    throw new ConnectorHttpError("bad_response", res.status);
  }
}
