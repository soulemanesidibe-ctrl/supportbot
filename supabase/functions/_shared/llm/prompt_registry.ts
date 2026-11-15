// Registre des prompts système. Règle (M01, M07) : le message système est une CONSTANTE STATIQUE, versionnée, écrite dans le code.
// Le type StaticPrompt et ce registre le font respecter deux fois : au typage (seule definePrompt en fabrique) et à l'exécution
// (la passerelle LLM refuse tout message système qui n'est pas un prompt enregistré). Semgrep interdit definePrompt hors de
// llm/prompts.ts et exige qu'on lui passe un littéral : un contenu externe ne peut donc jamais devenir un prompt système.

declare const staticBrand: unique symbol;
export type StaticPrompt = string & { readonly [staticBrand]: true };

export interface PromptInfo {
  readonly id: string;
  readonly version: string;
}

const registry = new Map<string, PromptInfo>(); // texte → identité
const byId = new Map<string, string>(); // id → texte

const ID = /^[a-z][a-z0-9_.-]{2,40}$/;
const VERSION = /^v\d+(\.\d+){0,2}$/;

/** RÉSERVÉ à llm/prompts.ts, avec un littéral en 3e argument (règles Semgrep releve-define-prompt-*). */
export function definePrompt(id: string, version: string, text: string): StaticPrompt {
  if (!ID.test(id) || !VERSION.test(version)) throw new Error("Identifiant ou version de prompt invalide");
  if (typeof text !== "string" || text.length < 20 || text.length > 20_000) throw new Error("Texte de prompt hors limites");
  const key = `${id}@${version}`;
  const known = byId.get(key);
  if (known !== undefined && known !== text) throw new Error(`Le prompt ${key} existe déjà avec un autre texte : changez la version`);
  const owner = registry.get(text);
  if (owner && (owner.id !== id || owner.version !== version)) throw new Error("Ce texte est déjà enregistré sous une autre identité");
  byId.set(key, text);
  registry.set(text, { id, version });
  return text as StaticPrompt;
}

export function promptInfo(text: string): PromptInfo | null {
  return registry.get(text) ?? null;
}

export function isStaticPrompt(x: unknown): x is StaticPrompt {
  return typeof x === "string" && registry.has(x);
}

/** Textes de tous les prompts enregistrés : sert à repérer une fuite d'instructions dans une réponse. */
export function registeredPromptTexts(): string[] {
  return [...registry.keys()];
}
