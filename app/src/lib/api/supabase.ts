// Implémentation de production (jalon J5.2) : lecture sous la sécurité par ligne avec le jeton en mémoire, écritures par les
// fonctions Edge. Écrite avec la passerelle de session ; d'ici là, elle refuse plutôt que de deviner.
import type { EmployeeAuthApi, WidgetApi } from "./types.ts";

export function createSupabaseWidgetApi(): WidgetApi & EmployeeAuthApi {
  const notYet = () => Promise.reject(new Error("Connexion au serveur Relève non configurée"));
  return {
    context: notYet,
    listRequests: notYet,
    conversation: notYet,
    send: notYet,
    escalate: notYet,
    confirm: notYet,
    rate: notYet,
    publicOrg: notYet,
    requestCode: notYet,
    verifyCode: notYet,
    signOut: () => Promise.resolve(),
  };
}
