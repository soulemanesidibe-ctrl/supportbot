// Liaison du jeton Microsoft du valideur à son compte lié. Le jeton est un jeton DÉLÉGUÉ obtenu par la connexion du valideur lui-même ;
// il est utilisé dans la requête qui l'a reçu et n'est JAMAIS stocké ni journalisé. Avant de s'en servir, on vérifie qu'il appartient bien
// au compte Microsoft que CE technicien a lié (locataire ET identifiant d'objet) : un jeton d'un autre compte, ou d'un autre locataire,
// est refusé. On lit les revendications sans vérifier la signature : Microsoft Graph vérifie le jeton à l'appel, un jeton falsifié y échoue ;
// ce contrôle ne sert qu'à lier l'identité, pas à l'authentifier.
import { Errors } from "../errors.ts";
import type { MicrosoftBinding } from "./types.ts";

function claimsOf(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    return typeof json === "object" && json !== null && !Array.isArray(json) ? json as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function assertTokenBelongsToBinding(token: string, binding: MicrosoftBinding | null, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (!binding) throw Errors.forbidden(); // le technicien n'a pas lié son compte Microsoft à ce connecteur
  const c = claimsOf(token);
  if (!c) throw Errors.forbidden();
  const exp = typeof c.exp === "number" ? c.exp : 0;
  if (exp <= nowSeconds) throw Errors.forbidden(); // jeton expiré
  if (c.tid !== binding.tenantId || c.oid !== binding.objectId) throw Errors.forbidden();
}
