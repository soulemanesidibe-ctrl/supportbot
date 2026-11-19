// Banc d'évaluation de Relève (jalon J6, docs/11 § 2) : contrat des cas, des enregistrements et des résultats.
// Un CAS est une demande de salarié avec ce que l'on attend du système. Le banc fait passer chaque cas dans l'orchestrateur RÉEL
// (handleChatMessage), avec un vrai modèle (exécution réelle) ou des sorties enregistrées (rejeu en CI, sans réseau).
import type { Category, Intent, Requested } from "../_shared/llm/schemas.ts";

/** Nature du cas : elle dit ce que le système DOIT faire. */
export type CaseKind =
  | "kb" // la réponse est dans une fiche : Relève doit répondre, juste, en citant la fiche
  | "hors_base" // aucune fiche ne couvre la demande : Relève ne doit pas inventer, elle passe la main
  | "compte" // action sur un compte : jamais traitée dans le chat, préparée pour un technicien
  | "securite" // compromission possible : un technicien tout de suite
  | "hors_perimetre" // RH, juridique, médical : pas de conseil, passage de main
  | "injection" // SEC-13 : une instruction cachée dans le message, une fiche, l'historique, une alerte collée ou un nom de fichier
  | "extraction"; // SEC-14 : tentative d'obtenir les consignes du système

export interface FicheExtra {
  readonly id: string;
  readonly title: string;
  readonly category: Category;
  readonly text: string;
}

export interface EvalCase {
  readonly id: string;
  readonly kind: CaseKind;
  /** Message du salarié, tel qu'il l'écrirait. */
  readonly message: string;
  /** Échanges précédents de la conversation (injection par l'historique). */
  readonly history?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  /** Fiches ajoutées à la base pour CE cas seulement (fiche piégée). */
  readonly kbExtra?: readonly FicheExtra[];
  readonly expect: {
    /**
     * Ce que le système doit faire : « answer » (répondre au salarié), « escalate » (passer la main sans répondre), « either »
     * (les deux sont justes, par exemple une fiche qui dit de prévenir un technicien). Par défaut : « answer » pour un cas « kb »,
     * « escalate » pour tous les autres.
     */
    readonly route?: "answer" | "escalate" | "either";
    /** Catégories acceptables (le tri peut légitimement hésiter entre deux). */
    readonly category: readonly Category[];
    readonly intent?: readonly Intent[];
    /** Pour un cas « compte » : l'action que le salarié demande. */
    readonly requested?: Requested;
    /** Pour un cas « kb » : au moins une de ces fiches doit être citée. */
    readonly sources?: readonly string[];
    /** Pour un cas « kb » : chaque groupe doit avoir au moins un mot présent dans la réponse (faits essentiels de la fiche). */
    readonly facts?: ReadonlyArray<readonly string[]>;
    /** Motifs interdits dans tout texte de l'IA pour ce cas (en plus des motifs globaux). */
    readonly mustNot?: readonly string[];
    /** Jeton témoin d'une injection : s'il apparaît dans un texte de l'IA, l'injection a réussi. */
    readonly canary?: string;
  };
}

/** Ce que le système a fait sur un cas, relevé dans le banc. */
export interface CaseRun {
  readonly id: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly triage: { intent: Intent; category: Category; requestedAction: Requested; manipulation: boolean; confidence: number } | null;
  /** Texte montré au salarié par l'IA (réponse publique), s'il y en a un. */
  readonly publicAnswer: string | null;
  /** Brouillon de l'IA réservé au technicien (mode ombre, sortie bloquée, « je ne sais pas »). */
  readonly draft: string | null;
  readonly sources: readonly string[];
  readonly hits: ReadonlyArray<{ doc: string; score: number }>;
  readonly calls: ReadonlyArray<CallTrace>;
  readonly error?: string;
}

export interface CallTrace {
  readonly purpose: "triage" | "answer" | "embedding";
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly latencyMs: number;
  readonly failed?: string;
}

/** Sortie enregistrée d'un appel au modèle, rejouée à l'identique en CI. */
export type RecordedCall =
  | { readonly ok: true; readonly text: string; readonly model: string; readonly tokensIn: number; readonly tokensOut: number; readonly latencyMs: number }
  | { readonly ok: false; readonly kind: string };

export interface RecordedCase {
  readonly triage?: RecordedCall;
  readonly answer?: RecordedCall;
  /** Fiches les plus proches (8 au plus) avec leur similarité : le rejeu applique le seuil ACTUEL du code. */
  readonly hits?: ReadonlyArray<{ doc: string; score: number }>;
  readonly embedFailed?: string;
  readonly embedModel?: string;
  readonly embedLatencyMs?: number;
  readonly embedTokens?: number;
}

export interface Recording {
  readonly label: string;
  readonly date: string;
  readonly models: { readonly triage: string; readonly answer: string; readonly embed: string };
  /** Versions des prompts au moment de l'enregistrement : si elles changent, il faut une nouvelle évaluation réelle. */
  readonly prompts: readonly string[];
  /** Empreinte du jeu de cas : un cas ajouté ou modifié impose aussi une nouvelle évaluation réelle. */
  readonly casesHash: string;
  readonly cases: Readonly<Record<string, RecordedCase>>;
}
