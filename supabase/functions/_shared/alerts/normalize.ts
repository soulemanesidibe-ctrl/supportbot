// Normalisation d'une alerte reçue par webhook (spec § 11). Le contenu d'une alerte est une DONNÉE, jamais une instruction
// (menaces M01, M16, M35) : on en extrait des champs typés et bornés, on masque les secrets, on garde la charge brute pour l'audit.
// La correspondance des champs est de la CONFIGURATION (chemins simples), jamais du code : aucun gabarit, aucune expression évaluée.
import { containsSecret, redact, redactText } from "../redact.ts";
import { Errors } from "../errors.ts";

export const SEVERITIES = ["information", "warning", "major", "critical"] as const;
export type AlertSeverity = (typeof SEVERITIES)[number];
export const STATES = ["open", "acknowledged", "resolved"] as const;
export type AlertState = (typeof STATES)[number];
export const ASSET_KINDS = ["host", "service", "unknown"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Alerte normalisée, telle que la reçoit la fonction SQL alert_ingest (qui la revalide). */
export interface NormalizedAlertRow {
  dedup_key: string;
  asset_kind: AssetKind;
  asset_name: string;
  site: string | null;
  severity: AlertSeverity;
  state: AlertState;
  summary: string;
  occurred_at: string;
  origin_url: string | null;
  raw: unknown;
}

export interface FieldMapping {
  /** Chemins dont les valeurs, jointes par « | », forment la clé de déduplication (source + actif + contrôle). */
  readonly dedup: readonly string[];
  readonly asset: string;
  readonly assetKind?: string;
  readonly severity: string;
  readonly state?: string;
  readonly summary?: string;
  readonly occurredAt?: string;
  readonly site?: string;
  readonly originUrl?: string;
  readonly stateMap: Readonly<Record<string, AlertState>>;
}

export interface SourceConfig {
  readonly mapping: FieldMapping;
  readonly severityMap: Readonly<Record<string, AlertSeverity>>;
}

/** Format natif de Relève : un script peut envoyer directement une alerte déjà normalisée (correspondance vide). */
export const NATIVE_MAPPING: FieldMapping = Object.freeze({
  dedup: ["dedup_key"],
  asset: "asset_name",
  assetKind: "asset_kind",
  severity: "severity",
  state: "state",
  summary: "summary",
  occurredAt: "occurred_at",
  site: "site",
  originUrl: "origin_url",
  stateMap: {},
});

export class SourceConfigError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SourceConfigError";
  }
}

const SEGMENT = /^[A-Za-z0-9_@$-]{1,64}$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const MAPPING_KEYS: Readonly<Record<string, keyof FieldMapping>> = {
  dedup: "dedup",
  asset: "asset",
  asset_kind: "assetKind",
  severity: "severity",
  state: "state",
  summary: "summary",
  occurred_at: "occurredAt",
  site: "site",
  origin_url: "originUrl",
  state_map: "stateMap",
};
const MAX_MAP_ENTRIES = 50;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 24 * 3600_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function validPath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0 || p.length > 300) return false;
  const segs = p.split(".");
  return segs.length <= 8 && segs.every((s) => SEGMENT.test(s) && !FORBIDDEN_SEGMENTS.has(s));
}

function parseMap<T extends string>(raw: unknown, allowed: readonly T[], what: string): Record<string, T> {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) throw new SourceConfigError(`${what} : objet attendu`);
  const entries = Object.entries(raw);
  if (entries.length > MAX_MAP_ENTRIES) throw new SourceConfigError(`${what} : trop d'entrées`);
  const out: Record<string, T> = Object.create(null);
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > 64 || FORBIDDEN_SEGMENTS.has(k)) throw new SourceConfigError(`${what} : clé invalide`);
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new SourceConfigError(`${what} : valeur invalide`);
    out[k] = v as T;
  }
  return out;
}

/** Lit la configuration d'une source (colonnes severity_map et field_mapping). Toute erreur = configuration refusée, rien n'est deviné. */
export function parseSourceConfig(severityMapRaw: unknown, fieldMappingRaw: unknown): SourceConfig {
  const severityMap = parseMap(severityMapRaw, SEVERITIES, "table des gravités");
  if (fieldMappingRaw === undefined || fieldMappingRaw === null) return { mapping: NATIVE_MAPPING, severityMap };
  if (!isPlainObject(fieldMappingRaw)) throw new SourceConfigError("correspondance : objet attendu");
  const keys = Object.keys(fieldMappingRaw);
  if (keys.length === 0) return { mapping: NATIVE_MAPPING, severityMap };
  const m: Record<string, unknown> = {};
  for (const k of keys) {
    if (!Object.hasOwn(MAPPING_KEYS, k)) throw new SourceConfigError(`correspondance : champ inconnu`);
    m[MAPPING_KEYS[k]] = fieldMappingRaw[k];
  }
  const dedupRaw = typeof m.dedup === "string" ? [m.dedup] : m.dedup;
  if (dedupRaw !== undefined && (!Array.isArray(dedupRaw) || dedupRaw.length < 1 || dedupRaw.length > 5 || !dedupRaw.every(validPath))) {
    throw new SourceConfigError("correspondance : dedup invalide");
  }
  if (!validPath(m.asset) || !validPath(m.severity)) throw new SourceConfigError("correspondance : asset et severity sont obligatoires");
  for (const k of ["assetKind", "state", "summary", "occurredAt", "site", "originUrl"] as const) {
    if (m[k] !== undefined && !validPath(m[k])) throw new SourceConfigError(`correspondance : chemin invalide`);
  }
  return {
    severityMap,
    mapping: Object.freeze({
      dedup: (dedupRaw as string[] | undefined) ?? [m.asset as string],
      asset: m.asset as string,
      assetKind: m.assetKind as string | undefined,
      severity: m.severity as string,
      state: m.state as string | undefined,
      summary: m.summary as string | undefined,
      occurredAt: m.occurredAt as string | undefined,
      site: m.site as string | undefined,
      originUrl: m.originUrl as string | undefined,
      stateMap: parseMap(m.stateMap, STATES, "table des états"),
    }),
  };
}

/** Valeur à un chemin simple : propriétés PROPRES d'objets ordinaires et indices de tableaux, rien d'autre. */
export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (Array.isArray(cur) && /^\d{1,4}$/.test(seg)) cur = cur[Number(seg)];
    else if (isPlainObject(cur) && Object.hasOwn(cur, seg)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

function scalar(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return undefined;
}

function isInvisible(cp: number): boolean {
  return (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff;
}

/** Retire les caractères de contrôle et d'inversion de sens (affichage trompeur), réduit les blancs, borne en caractères. */
export function cleanText(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x20) out += " ";
    else if (!isInvisible(cp)) out += ch;
  }
  return Array.from(out.replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

function lookup<T extends string>(raw: string, map: Readonly<Record<string, T>>, allowed: readonly T[]): T | undefined {
  if (Object.hasOwn(map, raw)) return map[raw];
  const low = raw.trim().toLowerCase();
  for (const [k, v] of Object.entries(map)) if (k.toLowerCase() === low) return v;
  return (allowed as readonly string[]).includes(low) ? (low as T) : undefined;
}

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function occurredAt(v: unknown, nowMs: number): number | undefined {
  let ms: number | undefined;
  if (typeof v === "string" && ISO.test(v)) ms = Date.parse(v);
  else if (typeof v === "number" && Number.isFinite(v) && v > 0) ms = v > 1e12 ? v : v * 1000;
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return ms > nowMs + FUTURE_TOLERANCE_MS || ms < nowMs - MAX_AGE_MS ? undefined : ms;
}

function originUrl(v: unknown): string | null {
  const s = scalar(v);
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.href.length <= 500 ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Charge JSON de la source → alerte normalisée, ou erreur 400 si l'actif ou la gravité manquent (correspondance à revoir). Les écarts
 * tolérés sont rendus en codes d'avertissement (jamais en texte de l'alerte) : gravité ou état inconnus, date illisible ou hors limites,
 * adresse d'origine ignorée.
 */
export async function normalizeAlert(payload: Record<string, unknown>, cfg: SourceConfig, nowMs: number): Promise<{ alert: NormalizedAlertRow; warnings: string[] }> {
  const m = cfg.mapping;
  const warnings: string[] = [];

  const assetRaw = scalar(getPath(payload, m.asset));
  const assetClean = assetRaw === undefined ? "" : cleanText(assetRaw, 200);
  if (assetClean === "") throw Errors.badRequest("Actif absent : vérifiez la correspondance des champs de cette source.");
  const asset = cleanText(redactText(assetClean), 200);

  const sevRaw = scalar(getPath(payload, m.severity));
  if (sevRaw === undefined || sevRaw.trim() === "") throw Errors.badRequest("Gravité absente : vérifiez la correspondance des champs de cette source.");
  let severity = lookup(sevRaw, cfg.severityMap, SEVERITIES);
  if (!severity) {
    severity = "warning";
    warnings.push("gravite_inconnue");
  }

  let state: AlertState = "open";
  const stateRaw = m.state ? scalar(getPath(payload, m.state)) : undefined;
  if (stateRaw !== undefined && stateRaw.trim() !== "") {
    const s = lookup(stateRaw, m.stateMap, STATES);
    if (s) state = s;
    else warnings.push("etat_inconnu");
  }

  const kindRaw = m.assetKind ? scalar(getPath(payload, m.assetKind))?.trim().toLowerCase() : undefined;
  const assetKind: AssetKind = (ASSET_KINDS as readonly string[]).includes(kindRaw ?? "") ? (kindRaw as AssetKind) : "unknown";

  const summaryRaw = m.summary ? scalar(getPath(payload, m.summary)) : undefined;
  const summary = summaryRaw === undefined ? "" : cleanText(redactText(cleanText(summaryRaw, 2000)), 500);

  const siteRaw = m.site ? scalar(getPath(payload, m.site)) : undefined;
  const site = siteRaw === undefined ? null : cleanText(redactText(siteRaw), 100) || null;

  let at = nowMs;
  if (m.occurredAt) {
    const v = getPath(payload, m.occurredAt);
    const parsed = occurredAt(v, nowMs);
    // Absente : l'heure de réception fait foi (cas normal). Présente mais illisible ou hors limites : signalée.
    if (parsed !== undefined) at = parsed;
    else if (v !== undefined) warnings.push("date_hors_limites");
  }

  let url: string | null = null;
  if (m.originUrl) {
    const v = getPath(payload, m.originUrl);
    url = originUrl(v);
    if (v !== undefined && url === null) warnings.push("adresse_ignoree");
  }

  // Clé de déduplication : valeurs des chemins, jointes. Trop longue ou porteuse d'un secret : remplacée par son empreinte (stable).
  // Bornée à 2 000 caractères AVANT l'empreinte (jamais tronquée à 300 : deux clés différentes ne doivent pas se confondre).
  const parts = m.dedup.map((p) => cleanText(scalar(getPath(payload, p)) ?? "", 2000));
  let key = parts.some((x) => x !== "") ? parts.join("|") : assetClean;
  if (key.startsWith("releve:")) throw Errors.badRequest("Clé de déduplication réservée.");
  if (Array.from(key).length > 300 || containsSecret(key)) key = `h:${await sha256Hex(key)}`;

  return {
    alert: {
      dedup_key: key,
      asset_kind: assetKind,
      asset_name: asset,
      site,
      severity,
      state,
      summary,
      occurred_at: new Date(at).toISOString(),
      origin_url: url,
      raw: redact(payload),
    },
    warnings,
  };
}
