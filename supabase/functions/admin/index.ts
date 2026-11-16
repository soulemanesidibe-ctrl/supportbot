// Point d'entrée de la fonction `admin` : organisations, invitations, relations, assignations, accès d'assistance, délégations,
// niveaux d'autonomie, catégories ouvertes, arrêt d'urgence. verify_jwt = false (config.toml) : l'authentification est faite par le code.
import { createAdminHandler } from "../_shared/admin/handler.ts";
import { supabaseAdminStore } from "../_shared/admin/store.ts";
import { newInvitationToken } from "../_shared/admin/token.ts";

Deno.serve(createAdminHandler({
  deps: () => ({ store: supabaseAdminStore(), newToken: () => newInvitationToken(), nowMs: () => Date.now() }),
}));
