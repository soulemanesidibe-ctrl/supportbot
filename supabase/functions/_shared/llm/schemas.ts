// Validation stricte des sorties JSON du modèle. Une sortie du modèle est une DONNÉE : on la valide comme une entrée extérieure,
// champ par champ, et on la rejette au moindre doute (le rejet se traduit par « je transmets à un technicien », jamais par une
// réponse improvisée). Aucune dépendance : les schémas sont courts.

export const CATEGORIES = ["password", "mfa", "vpn", "printer", "outlook", "teams", "onedrive", "slow_pc", "onboarding", "offboarding", "other"] as const;
export type Category = typeof CATEGORIES[number];
export const INTENTS = ["question", "incident", "account_action", "other"] as const;
export type Intent = typeof INTENTS[number];
export const URGENCIES = ["low", "normal", "high", "critical"] as const;
export type Urgency = typeof URGENCIES[number];

export const REQUESTED = ["none", "reset_password", "unlock", "revoke_sessions", "mfa_reregister"] as const;
export type Requested = typeof REQUESTED[number];

export interface Triage {
  readonly intent: Intent;
  readonly category: Category;
  readonly urgency: Urgency;
  readonly manipulation: boolean;
  readonly confidence: number;
  /** Action de compte demandée, dans une liste FERMÉE ; « none » si aucune. Le modèle ne fait que choisir, il n'agit pas. */
  readonly requestedAction: Requested;
}

export interface Answer {
  readonly answer: string;
  readonly knows: boolean;
  readonly escalate: boolean;
  readonly sources: readonly string[];
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Extrait UN objet JSON : accepte un bloc de code Markdown autour, refuse tout autre texte avant ou après. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{") || !t.endsWith("}") || t.length > 20_000) return null;
  try {
    const v = JSON.parse(t);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}

export function parseTriage(text: string): Triage | null {
  const o = parseJsonObject(text);
  if (!o) return null;
  const intent = oneOf(INTENTS, o.intent);
  const category = oneOf(CATEGORIES, o.category);
  const urgency = oneOf(URGENCIES, o.urgency);
  if (!intent || !category || !urgency || typeof o.manipulation !== "boolean") return null;
  const c = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : null;
  if (c === null) return null;
  // Champ absent = « none » ; valeur hors liste = sortie invalide.
  const requestedAction = o.requested_action === undefined ? "none" : oneOf(REQUESTED, o.requested_action);
  if (!requestedAction) return null;
  return { intent, category, urgency, manipulation: o.manipulation, confidence: c, requestedAction };
}

/**
 * @param allowedSources identifiants des fiches QUI LUI ONT ÉTÉ FOURNIES : une source inventée par le modèle rend la réponse invalide.
 */
export function parseAnswer(text: string, allowedSources: readonly string[]): Answer | null {
  const o = parseJsonObject(text);
  if (!o) return null;
  if (typeof o.answer !== "string" || o.answer.trim().length === 0 || o.answer.length > 2000) return null;
  if (typeof o.knows !== "boolean" || typeof o.escalate !== "boolean") return null;
  if (!Array.isArray(o.sources) || o.sources.length > 5) return null;
  const sources: string[] = [];
  for (const s of o.sources) {
    if (typeof s !== "string" || !allowedSources.includes(s)) return null;
    sources.push(s);
  }
  // Cohérence : prétendre savoir sans citer une seule fiche est une affirmation sans appui.
  if (o.knows && sources.length === 0) return null;
  return { answer: o.answer.trim(), knows: o.knows, escalate: o.escalate, sources };
}
