// Garde-fous déterministes, écrits en code (jamais en demandant au modèle de se surveiller lui-même) :
//   - injectionSignals : indices d'une tentative de manipulation dans un TEXTE ENTRANT. Ce n'est pas une barrière : c'est un signal de
//     plus, combiné à l'indicateur « manipulation » du tri. La barrière, c'est qu'aucune action n'existe sans validation humaine.
//   - checkOutput : contrôle de la réponse AVANT qu'elle atteigne le salarié (menaces M07 fuite d'instructions, M14 exfiltration par
//     le rendu, M01/M02 fausse action ou demande de secret). Au moindre doute, l'orchestrateur n'envoie pas la réponse : il la garde
//     pour le technicien et passe la main.
import { containsSecret } from "../redact.ts";
import { registeredPromptTexts } from "./prompt_registry.ts";
import { sanitizeExternal } from "./wrap.ts";

// ------------------------------------------------------------------------------------------------ entrée
const INPUT_RULES: Array<[string, RegExp]> = [
  ["ignore_consignes", /\b(ignore[rz]?|oublie[rz]?|annule[rz]?|d[ée]sactive[rz]?|contourne[rz]?|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(instructions?|consignes?|r[èe]gles?|directives?|prompt|restrictions?|s[ée]curit[ée]|guidelines?|rules?|safety)\b/i],
  ["revele_prompt", /\b(r[ée]p[èe]te[rz]?|affiche[rz]?|montre[rz]?|r[ée]v[èe]le[rz]?|donne[rz]?|print|show|reveal|repeat|display)\b[^.\n]{0,40}\b(tes|vos|ton|votre|your|the|system|syst[èe]me)\b[^.\n]{0,20}\b(instructions?|consignes?|prompt|r[èe]gles?)\b/i],
  ["system_prompt", /\b(system|syst[èe]me)[\s_-]*prompt\b/i],
  ["jeu_de_role", /\b(tu es (maintenant|d[ée]sormais)|you are now|act as|agis comme|fais comme si|pretend (to be|you)|mode (d[ée]veloppeur|developer|dieu|god)|jailbreak)\b|\bDAN\b/i],
  ["faux_message_systeme", /(^|\n)\s*(system|syst[èe]me|assistant|admin(?:istrateur)?|root)\s*[:>\]]|<\/?(system|instructions?)>|\[\/?INST\]|<\|im_(start|end)\|>|^#{2,}\s*(instruction|system)/im],
  ["action_pour_un_tiers", /\b(r[ée]initialis\w*|d[ée]bloqu\w*|reset|unlock|d[ée]sactiv\w*)\b[^.\n]{0,80}\b(pour|de|du)\s+(?:(?:mon|ma|le|la|l')\s*)?(coll[èe]gue|manager|responsable|chef|directeur|directrice|patron|pdg|ceo|dsi|administrateur|admin)\b/i],
  ["pression_hierarchique", /\b(le directeur|la direction|le pdg|le ceo|mon patron|mon manager|la dsi)\s+(a|m'a|nous a)\s+(demand|dit|ordonn|exig)/i],
  ["blob_encode", /[A-Za-z0-9+/=]{120,}/],
];

export function injectionSignals(text: string): string[] {
  const out: string[] = [];
  const clean = sanitizeExternal(text);
  if (clean.length < text.normalize("NFC").length) out.push("caracteres_invisibles"); // des caractères cachés ont été retirés
  for (const [code, re] of INPUT_RULES) if (re.test(clean)) out.push(code);
  return out;
}

// ------------------------------------------------------------------------------------------------ sortie
export interface OutputCheck {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export interface OutputOptions {
  /** Noms d'hôte dont les liens sont admis (par exemple le portail d'assistance de l'organisation). Vide par défaut : aucun lien. */
  readonly allowedHosts?: readonly string[];
  readonly maxChars?: number;
}

const HTML = /<\s*\/?\s*[a-z!][^>]*>/i;
const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/;
const URL_LIKE = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s)>\]"']+|\b(?:mailto|javascript|data|file|vbscript):[^\s)>\]"']+/gi;
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

const ACTION_CLAIM = /\b(j'ai|je viens de|c'est fait|c'est fini)\b[^.\n]{0,50}\b(r[ée]initialis|d[ée]bloqu|d[ée]sactiv|r[ée]activ|supprim|modifi|chang|cr[ée][ée]|r[ée]voqu|ajout|retir|envoy)\w*|\b(votre|ton|ta|votre)\s+(compte|mot de passe|acc[èe]s|authentification|session|mfa)\b[^.\n]{0,30}\b(a [ée]t[ée]|est (maintenant|d[ée]sormais)?)\s*(r[ée]initialis|d[ée]bloqu|d[ée]sactiv|r[ée]activ|supprim|modifi|chang|r[ée]voqu)\w*|\bi('ve| have)\s+(reset|unlocked|disabled|deleted|changed|revoked)\b/i;

const SECRET_REQUEST = /\b(donne[rz]?|envoie|envoy(?:er|ez|ons)|indique[rz]?|communique[rz]?|saisis|saisissez|transmets|transmettez|[ée]cris|[ée]crivez|tape[rz]?|fournis|fournissez|send|give|provide|enter|type|share|tell me)\b[^.\n]{0,60}\b(mot de passe|mdp|password|code (?:de )?(?:v[ée]rification|s[ée]curit[ée]|secours|mfa|sms|otp)|(?:verification|security|recovery|backup) code|cl[ée] de r[ée]cup[ée]ration|pin)\b/gi;
const NEGATION_BEFORE = /(\bne\b|\bn')[^.\n]{0,30}\b(jamais|pas|plus|personne|aucun|aucune|rien)\b|\bnever\b|\bdon'?t\b|\bdo not\b|\bsans\b/i;

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a.toLowerCase() || h.endsWith(`.${a.toLowerCase()}`));
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    return /^https?:$/.test(u.protocol) ? u.hostname : null;
  } catch {
    return null;
  }
}

const words = (s: string): string[] => s.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
const SHINGLE = 9;
let shingleCache: { count: number; set: Set<string> } | null = null;

function promptShingles(): Set<string> {
  const texts = registeredPromptTexts();
  if (shingleCache && shingleCache.count === texts.length) return shingleCache.set;
  const set = new Set<string>();
  for (const t of texts) {
    const w = words(t);
    for (let i = 0; i + SHINGLE <= w.length; i++) set.add(w.slice(i, i + SHINGLE).join(" "));
  }
  shingleCache = { count: texts.length, set };
  return set;
}

export function checkOutput(text: string, opts: OutputOptions = {}): OutputCheck {
  const v = new Set<string>();
  const allowed = opts.allowedHosts ?? [];
  if (typeof text !== "string" || text.trim() === "") return { ok: false, violations: ["vide"] };
  if (text.length > (opts.maxChars ?? 2000)) v.add("trop_long");
  if (sanitizeExternal(text).length < text.normalize("NFC").length) v.add("caracteres_invisibles");

  if (MD_IMAGE.test(text) || /<\s*img\b/i.test(text) || /\bdata:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(text)) v.add("image");
  if (HTML.test(text)) v.add("html");

  const urls = [...text.matchAll(URL_LIKE)].map((m) => m[0]);
  for (const m of text.matchAll(MD_LINK)) urls.push(m[1]);
  for (const u of urls) {
    const host = hostOf(u);
    if (host === null || !hostAllowed(host, allowed)) v.add("lien_externe");
  }

  if (containsSecret(text)) v.add("secret_dans_la_reponse");
  if (ACTION_CLAIM.test(text)) v.add("action_pretendue");

  for (const m of text.matchAll(SECRET_REQUEST)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0) + m[0];
    if (!NEGATION_BEFORE.test(before)) v.add("demande_de_secret");
  }

  const w = words(text);
  if (w.length >= SHINGLE) {
    const sh = promptShingles();
    for (let i = 0; i + SHINGLE <= w.length; i++) {
      if (sh.has(w.slice(i, i + SHINGLE).join(" "))) {
        v.add("fuite_instructions");
        break;
      }
    }
  }
  return { ok: v.size === 0, violations: [...v] };
}
