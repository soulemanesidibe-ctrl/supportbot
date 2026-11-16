// Règles DÉTERMINISTES de demande suspecte (docs/spec-mvp.md § 9.4), évaluées par le code sur le diagnostic du compte, jamais par le modèle.
// Seuils de départ de la spec, à calibrer en J6. L'effet d'une demande suspecte (réponse neutre identique, ticket de sécurité) est décidé
// par l'appelant ; ici on ne fait que juger. X5 (la cible n'est pas l'utilisateur de la conversation) est imposée ailleurs : callCapability
// (cible « self_only ») ET le déclencheur de la base.
import type { UserDiagnosis } from "../capabilities/types.ts";

export const RISK = { recentChangeHours: 24, failedSignInsThreshold: 10, repeatedRequestsThreshold: 1 } as const;

export type RiskDecision = "allow" | "privileged" | "suspicious";

export interface RiskVerdict {
  readonly decision: RiskDecision;
  /** Codes des règles qui ont joué (X1 à X4), pour le technicien et l'audit. */
  readonly flags: readonly string[];
}

export function evaluateRisk(input: { diagnosis: UserDiagnosis; priorRequests24h: number; now?: Date }): RiskVerdict {
  const now = (input.now ?? new Date()).getTime();
  const recent = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && now - t < RISK.recentChangeHours * 3_600_000 && t <= now + 60_000;
  };
  const d = input.diagnosis;
  // X1 : compte à privilèges. Aucune action préparée, escalade humaine systématique.
  if (d.hasPrivilegedRole) return { decision: "privileged", flags: ["X1"] };
  const flags: string[] = [];
  // X2 : méthode d'authentification ajoutée ou mot de passe changé depuis moins de 24 h.
  if (d.mfaMethods.some((m) => recent(m.createdAt)) || recent(d.lastPasswordChangeAt)) flags.push("X2");
  // X3 : dix échecs de connexion ou plus.
  if (d.recentFailedSignIns >= RISK.failedSignInsThreshold) flags.push("X3");
  // X4 : une demande déjà faite sur la même cible dans les 24 dernières heures (celle-ci est donc la deuxième).
  if (input.priorRequests24h >= RISK.repeatedRequestsThreshold) flags.push("X4");
  return flags.length > 0 ? { decision: "suspicious", flags } : { decision: "allow", flags: [] };
}
