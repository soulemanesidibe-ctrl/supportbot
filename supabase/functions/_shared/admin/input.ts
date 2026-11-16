// Lecture stricte du corps d'une requête d'administration : chaque champ a un type, des bornes, parfois une liste fermée.
// Un champ inattendu est ignoré (on ne construit jamais une ligne de base à partir du corps entier : pas de « mass assignment »).
import { Errors } from "../errors.ts";

export type Body = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

function bad(field: string): never {
  throw Errors.badRequest(`Champ « ${field} » invalide.`);
}

/** Vrai si le texte contient un caractère de contrôle ou un séparateur de ligne Unicode (jamais accepté dans un champ d'administration). */
function hasControl(t: string): boolean {
  for (const ch of t) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

/** Texte sans caractère de contrôle, de longueur bornée. */
export function text(b: Body, key: string, min: number, max: number): string {
  const v = b[key];
  if (typeof v !== "string") return bad(key);
  const t = v.trim();
  if (t.length < min || t.length > max || hasControl(t)) return bad(key);
  return t;
}

export function optionalText(b: Body, key: string, min: number, max: number): string | null {
  return b[key] === undefined || b[key] === null || b[key] === "" ? null : text(b, key, min, max);
}

export function slug(b: Body, key: string): string {
  const v = b[key];
  if (typeof v !== "string" || !SLUG.test(v)) return bad(key);
  return v;
}

export function uuid(b: Body, key: string): string {
  const v = b[key];
  if (typeof v !== "string" || !UUID.test(v)) return bad(key);
  return v.toLowerCase();
}

export function email(b: Body, key: string): string {
  const v = b[key];
  if (typeof v !== "string") return bad(key);
  const t = v.trim().toLowerCase();
  if (t.length > 320 || hasControl(t) || !EMAIL.test(t)) return bad(key);
  return t;
}

export function oneOf<T extends string>(b: Body, key: string, list: readonly T[]): T {
  const v = b[key];
  if (typeof v !== "string" || !list.includes(v as T)) return bad(key);
  return v as T;
}

export function int(b: Body, key: string, min: number, max: number, fallback?: number): number {
  const v = b[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return bad(key);
  return v;
}

export function bool(b: Body, key: string, fallback = false): boolean {
  const v = b[key];
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") return bad(key);
  return v;
}

/** Liste de valeurs d'une liste fermée, sans doublon, entre min et max éléments. */
export function listOf<T extends string>(b: Body, key: string, list: readonly T[], min: number, max: number): T[] {
  const v = b[key];
  if (!Array.isArray(v) || v.length < min || v.length > max) return bad(key);
  const out: T[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !list.includes(x as T) || out.includes(x as T)) return bad(key);
    out.push(x as T);
  }
  return out;
}
