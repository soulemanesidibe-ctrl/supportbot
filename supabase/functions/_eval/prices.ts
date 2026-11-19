// Tarifs de Mistral et d'OVHcloud pour ESTIMER le coût dans le rapport d'évaluation, en dollars par million de jetons.
// À CONFIRMER : la page officielle des tarifs (mistral.ai/pricing) ne liste pas ces modèles le 19 novembre 2026 ; ces chiffres
// viennent d'agrégateurs qui citent la documentation de Mistral (Mistral Small 4 : 0,15 / 0,60 ; Mistral Medium 3.5 : 1,50 / 7,50).
// Le rapport les présente comme une estimation. Le nom du modèle réellement servi est enregistré à chaque appel.
export interface Price {
  readonly input: number;
  readonly output: number;
}

export const PRICES_DATE = "2026-11-19";
export const PRICES_NOTE = "Tarifs relevés le 19 novembre 2026 : Mistral à confirmer sur sa grille officielle (sources secondaires) ; OVHcloud lus sur son catalogue (0,10 $ et 0,31 $ par million de jetons pour Mistral Small 3.2, 0,01 $ pour bge-m3).";

const TABLE: ReadonlyArray<{ match: RegExp; price: Price }> = [
  { match: /^mistral-small/, price: { input: 0.15, output: 0.6 } },
  { match: /^mistral-medium/, price: { input: 1.5, output: 7.5 } },
  { match: /^mistral-embed/, price: { input: 0.1, output: 0 } },
  // OVHcloud AI Endpoints, catalogue (page « World », en dollars), relevé le 19 novembre 2026 : source primaire.
  { match: /^Mistral-Small-3\.2-24B-Instruct-2506$/, price: { input: 0.1, output: 0.31 } },
  { match: /^bge-m3$/, price: { input: 0.01, output: 0 } },
];

export function priceOf(model: string): Price | null {
  return TABLE.find((t) => t.match.test(model))?.price ?? null;
}

/** Coût en dollars d'un appel ; null si le modèle n'est pas dans la table (le rapport le signale au lieu d'inventer). */
export function costOf(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = priceOf(model);
  return p ? (tokensIn * p.input + tokensOut * p.output) / 1_000_000 : null;
}
