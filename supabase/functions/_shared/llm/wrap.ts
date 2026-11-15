// wrapExternal : le SEUL chemin par lequel un contenu extérieur (message du salarié, fiche, ticket, alerte, nom de fichier, nom
// d'organisation) entre dans une requête au modèle. Il devient une DONNÉE encadrée, dans un message « user », jamais dans le
// prompt système (règle n° 4, menaces M01 et M07). Ce que fait cette fonction, dans l'ordre :
//   1. retire les caractères invisibles et de contrôle (instructions cachées, « ASCII smuggling », inversion de sens de lecture) ;
//   2. masque les secrets et données personnelles reconnaissables (règle n° 2, minimisation) ;
//   3. neutralise les chevrons : le contenu ne peut pas fermer lui-même son encadrement ;
//   4. borne la taille ;
//   5. encadre avec une balise portant un identifiant aléatoire propre à CET appel, qu'un attaquant ne peut pas deviner.
// Limite assumée : aucune technique d'encadrement n'empêche un modèle de se laisser influencer. C'est pourquoi la vraie barrière
// n'est pas ici : l'IA ne peut déclencher aucune action sans validation humaine, et sa sortie est filtrée (guards.ts).
import { redactText } from "../redact.ts";

const LABEL = /^[a-z][a-z_]{1,29}$/;
export const DEFAULT_MAX_CHARS = 6000;

// Invisibles : espaces de largeur nulle, marques directionnelles, caractères de format, sélecteurs de variation, « tags » Unicode.
const INVISIBLE = /[​-‏‪-‮⁠-⁯﻿­᠎︀-️]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;
// Contrôles C0 et C1, sauf tabulation, saut de ligne et retour chariot (filtrés par code, pas par expression régulière).
function stripControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    const control = (c <= 0x08) || c === 0x0B || c === 0x0C || (c >= 0x0E && c <= 0x1F) || (c >= 0x7F && c <= 0x9F);
    if (!control) out += ch;
  }
  return out;
}

export function sanitizeExternal(data: string): string {
  return stripControls(String(data).normalize("NFC").replace(INVISIBLE, "")).replace(/\r\n?/g, "\n");
}

export interface WrapOptions {
  readonly maxChars?: number;
  /** Pour les tests : identifiant d'encadrement imposé. En production il est toujours aléatoire. */
  readonly nonce?: string;
}

export function wrapExternal(label: string, data: string, opts: WrapOptions = {}): string {
  if (!LABEL.test(label)) throw new Error("Étiquette de donnée invalide");
  const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
  let text = redactText(sanitizeExternal(data));
  if (text.length > max) text = `${text.slice(0, max)}…[tronqué]`;
  text = text.replace(/</g, "‹").replace(/>/g, "›");
  const nonce = opts.nonce ?? crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  if (!/^[0-9a-f]{6,32}$/.test(nonce)) throw new Error("Identifiant d'encadrement invalide");
  return `<donnee-${nonce} source="${label}">\n${text}\n</donnee-${nonce}>`;
}
