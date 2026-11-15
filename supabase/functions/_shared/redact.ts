// Masquage automatique (règle non négociable n° 2 : aucun secret dans le fil de conversation, les journaux ni les prompts).
// Deux outils :
//   redactText(texte)  : masque les secrets et données personnelles reconnaissables dans un texte libre (messages, erreurs) ;
//   redact(valeur)     : parcourt une valeur structurée, masque tout ce dont la CLÉ ressemble à un secret, et applique
//                        redactText aux chaînes. Borné en profondeur, en taille et protégé contre les cycles.
// Limite assumée : un masquage par motifs n'attrape pas tout. C'est un filet, pas une autorisation d'écrire des secrets
// dans les journaux : la règle Semgrep releve-secret-in-logger et la revue du code restent la première défense.

export const MASK = "[MASQUÉ]";
const MAX_DEPTH = 6;
const MAX_STRING = 2000;
const MAX_ITEMS = 50;

// Clés dont la valeur n'est jamais journalisée, quelle qu'elle soit.
const SENSITIVE_KEY =
  /(pass(word|wd|phrase)?|mot[_\s-]?de[_\s-]?passe|mdp|secret|token|api[_-]?key|apikey|authorization|cookie|jwt|bearer|credential|private[_-]?key|refresh|recovery|code[_-]?secours|(^|[_.-])otp($|[_.-])|signature|hmac|vault)/i;
// Exceptions : les COMPTEURS de jetons du modèle (tokens_in, completion_tokens...) ne sont pas des secrets.
const TOKEN_COUNT_KEY = /^(prompt_|completion_|input_|output_|max_|total_)?tokens?(_in|_out|_count|_used)?$/i;

const PATTERNS: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MASK], // JWT
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${MASK}`],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]{8,}/g, MASK], // clés Supabase
  [/\b(https?|postgres(?:ql)?):\/\/[^\s/:@]+:[^\s/@]+@/gi, (_m, p) => `${p}://${MASK}@`], // identifiants dans une URL
  // clé=valeur dans un texte ou une URL (?token=abc, password: abc, api_key = abc)
  [
    /\b(password|passwd|pwd|mot[ _-]?de[ _-]?passe|mdp|secret|token|api[_-]?key|apikey|client_secret)\b(\s*[:=]\s*|\s+(?:est|is|:)\s+)(["']?)[^\s"',;&]{3,}\3/gi,
    (_m, k, sep) => `${k}${sep}${MASK}`,
  ],
  // codes à usage unique (« mon code de vérification est 123456 ») ; on ne masque PAS un « code d'erreur », utile au diagnostic
  [
    /\b(code(?:\s+de)?\s+(?:vérification|verification|sécurité|securite|secours|temporaire|sms|reçu|recu)|verification code|security code|otp)\b(\s*(?:est|is|:|=)?\s*)\d[\d\s-]{2,12}\d/gi,
    (_m, k, sep) => `${k}${sep}${MASK}`,
  ],
  // « mon mot de passe est Azerty123 », « my password is hunter2 »
  [/\b(mot de passe|password|mdp)\s+(?:actuel\s+|temporaire\s+)?(?:est|is)\s+\S+/gi, (_m, k) => `${k} ${MASK}`],
  // adresses e-mail : on garde la première lettre et le domaine (minimisation, RGPD), jamais l'adresse complète
  [/\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (_m, a, d) => `${a}***@${d}`],
  // numéros de téléphone français (06 12 34 56 78, +33 6 12 34 56 78, 0033612345678)
  [/(?<![\d.])(?:\+33|0033|0)[\s.-]?[1-9](?:[\s.-]?\d{2}){4}(?![\d.])/g, "[TÉLÉPHONE]"],
];

export function redactText(input: string): string {
  let s = input.length > MAX_STRING * 4 ? input.slice(0, MAX_STRING * 4) : input;
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep as string);
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[tronqué]` : s;
}

export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === "string") return redactText(value as string);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function" || t === "symbol") return `[${t}]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[date invalide]" : value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (depth >= MAX_DEPTH) return "[profondeur maximale]";
  const obj = value as object;
  if (seen.has(obj)) return "[référence circulaire]";
  seen.add(obj);
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1, seen));
    if (value.length > MAX_ITEMS) out.push(`[${value.length - MAX_ITEMS} éléments omis]`);
    return out;
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (++n > MAX_ITEMS) {
      out["…"] = "[champs omis]";
      break;
    }
    if (SENSITIVE_KEY.test(k) && !(TOKEN_COUNT_KEY.test(k) && typeof v === "number")) out[k] = MASK;
    else out[k] = redact(v, depth + 1, seen);
  }
  return out;
}
