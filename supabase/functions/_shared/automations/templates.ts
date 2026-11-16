// Messages FIXES des automatisations (spec § 12 : « gabarits fixes dont les variables sont des champs typés »). La seule variable est
// le libellé de la catégorie, tiré d'une liste fermée : JAMAIS le texte d'une alerte, le nom d'un actif ni un contenu externe (SEC-18).
// Chaque message rappelle qu'il vient de Relève, l'assistant IA, et qu'un humain reste joignable (AI Act, art. 50 ; règle n° 1).
// Français d'abord ; l'anglais arrive avec l'internationalisation (J5).
import { CATEGORY_LABELS } from "../chat/texts.ts";

function label(category: unknown): string {
  return typeof category === "string" && Object.hasOwn(CATEGORY_LABELS, category) && category !== "other"
    ? `« ${CATEGORY_LABELS[category]} »`
    : "concerné";
}

export const AUTOMATION_TEXTS = {
  incidentOpened: (category: unknown): string =>
    `Un incident en cours touche le service ${label(category)} et l'équipe technique est prévenue. Votre demande y est rattachée : ` +
    "vous serez informé ici de son rétablissement. Message automatique de Relève, l'assistant IA du support ; vous pouvez toujours demander à parler à un technicien.",
  incidentResolved: (category: unknown): string =>
    `L'incident qui touchait le service ${label(category)} est résolu. Si le problème persiste pour vous, répondez ici : un technicien reprendra votre demande. ` +
    "Message automatique de Relève, l'assistant IA du support.",
} as const;

/** Ticket parent d'un incident (vu des techniciens, dans l'outil de ticketing) : champs typés seulement, pas le résumé de l'alerte. */
export function parentTicket(i: { category: string | null; severity: string; incidentId: string }): { title: string; body: string } {
  const cat = typeof i.category === "string" && Object.hasOwn(CATEGORY_LABELS, i.category) ? CATEGORY_LABELS[i.category] : "Service";
  return {
    title: `Incident ${cat} (regroupé par Relève)`,
    body: [
      "Incident regroupé automatiquement par Relève, l'assistant IA du support : alerte de supervision confirmée et demandes de salariés de la même catégorie.",
      `Catégorie : ${cat}. Gravité : ${i.severity}.`,
      `Référence Relève : ${i.incidentId}.`,
      "Les alertes, leur texte et les demandes rattachées sont visibles dans la console Relève. Les tickets des demandes sont liés à ce ticket.",
    ].join("\n"),
  };
}
