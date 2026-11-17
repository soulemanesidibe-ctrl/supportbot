// Intitulé d'une action préparée, tel que le technicien le lit dans sa file (ce qui sera fait, sur quel compte).
export const CAPABILITY_TITLE: Record<string, (target: string) => string> = {
  "user.mfa_reregister": (t) => `Réinitialiser le MFA de ${t.split("@")[0]}`,
  "user.reset_password": (t) => `Réinitialiser le mot de passe de ${t.split("@")[0]}`,
  "user.unlock": (t) => `Débloquer le compte de ${t.split("@")[0]}`,
  "user.revoke_sessions": (t) => `Fermer les sessions de ${t.split("@")[0]}`,
  "ticket.update_status": (t) => `Changer l'état du ticket ${t}`,
  "ticket.assign": (t) => `Assigner le ticket ${t}`,
  "alert.acknowledge": (t) => `Acquitter l'alerte ${t}`,
};
