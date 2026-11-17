// Contrat entre les écrans et les données. Deux implémentations : Supabase (production, lecture sous la sécurité par ligne,
// écritures par les fonctions Edge) et « démo » (données fictives, chargée seulement en mode démo : voir index.tsx).

/** Catégories de demandes (identiques à private.categories() en base). */
export type Category = "password" | "mfa" | "vpn" | "printer" | "outlook" | "teams" | "onedrive" | "slow_pc" | "onboarding" | "offboarding" | "other";

/** État d'une demande vu par le salarié. Pas d'état « en validation » : une demande sur un compte se lit « chez un technicien »,
 *  ordinaire ou suspecte (décision du 16 novembre, docs/spec-mvp.md § 1). */
export type RequestStatus = "open" | "waiting_technician" | "waiting_user" | "resolved" | "closed";

/** Résultat d'un message du salarié, tel que le renvoie la fonction `chat` (ChatOutcome). */
export type ChatOutcome = "answered" | "shadow" | "escalated" | "account_action" | "suspect" | "frozen";

export interface Brand {
  /** Nom affiché (organisation du client ou ESN en marque blanche). */
  readonly name: string;
  /** Couleur d'accent de l'ESN, « #RRGGBB » ; le contraste du texte posé dessus est recalculé (lib/contrast.ts). */
  readonly accent?: string;
}

export interface OngoingIncident {
  readonly id: string;
  readonly category: Category;
  readonly since: string;
}

export interface WidgetContext {
  readonly orgName: string;
  readonly brand: Brand;
  readonly user: { readonly firstName: string };
  /** L'équipe est absente : Relève assure la relève jusqu'à `until` (heure de retour d'un humain). */
  readonly relief: { readonly active: boolean; readonly until?: string };
  /** Incidents en cours dans l'organisation : catégorie et heure seulement, jamais le texte d'une alerte. */
  readonly incidents: readonly OngoingIncident[];
  readonly synthetic: boolean;
}

export interface RequestSummary {
  readonly id: string;
  readonly title: string;
  readonly status: RequestStatus;
  readonly updatedAt: string;
  readonly lastLine: string;
}

export type MessageRole = "user" | "assistant" | "notice" | "technician";

export interface ChatMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly at: string;
  /** Prénom du technicien, pour un message humain. */
  readonly authorName?: string;
}

export interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly status: RequestStatus;
  readonly messages: readonly ChatMessage[];
  /** Une réponse de l'IA attend la confirmation du salarié (« Est-ce que ça a fonctionné ? »). */
  readonly awaitingConfirmation: boolean;
  /** Une demande d'action sur le compte attend un technicien. */
  readonly accountAction: boolean;
  readonly satisfaction: number | null;
}

export interface SendResult {
  readonly conversationId: string;
  readonly outcome: ChatOutcome;
  readonly messages: readonly ChatMessage[];
}

export interface WidgetApi {
  context(): Promise<WidgetContext>;
  listRequests(): Promise<readonly RequestSummary[]>;
  conversation(id: string): Promise<Conversation>;
  /** `direct` : « Parler à un technicien » depuis l'accueil ; le message va à un humain sans passer par l'IA. */
  send(conversationId: string | null, text: string, opts?: { direct?: boolean }): Promise<SendResult>;
  /** « Parler à un technicien » : la demande passe chez un humain, avec ce qui a déjà été vérifié. */
  escalate(conversationId: string): Promise<void>;
  /** Réponse au « Est-ce que ça a fonctionné ? ». */
  confirm(conversationId: string, worked: boolean): Promise<void>;
  rate(conversationId: string, score: 1 | 2 | 3 | 4 | 5): Promise<void>;
}

export interface EmployeeAuthApi {
  /** Nom et marque de l'organisation désignée dans l'adresse du widget (/w/<organisation>), avant toute connexion : rien d'autre. */
  publicOrg(slug: string): Promise<{ readonly name: string; readonly brand: Brand } | null>;
  /** Reprend la session existante (cookie de la passerelle) pour cette organisation, par exemple après un rechargement. */
  resume(slug: string): Promise<boolean>;
  /** Envoie un code SI l'adresse figure dans la liste des salariés : la réponse est la même dans tous les cas. */
  requestCode(slug: string, email: string): Promise<void>;
  verifyCode(slug: string, email: string, code: string): Promise<boolean>;
  signOut(): Promise<void>;
}

/** Longueur maximale d'un message du salarié (identique à la fonction `chat`). */
export const MAX_MESSAGE_LENGTH = 4000;
