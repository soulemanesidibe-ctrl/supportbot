// Point d'entrée de la fonction `admin` : organisations, invitations, relations, assignations, accès d'assistance, délégations,
// niveaux d'autonomie, catégories ouvertes, arrêt d'urgence. verify_jwt = false (config.toml) : l'authentification est faite par le code.
import { createAdminHandler } from "../_shared/admin/handler.ts";
import { supabaseAdminStore } from "../_shared/admin/store.ts";
import { newInvitationToken } from "../_shared/admin/token.ts";
import { limiterFor } from "../_shared/ratelimit.ts";
import { connectorById } from "../_shared/capabilities/registry.ts";
import { parseSuffixes, registerConnectors } from "../_shared/connectors/register.ts";
import { supabaseSecretPort } from "../_shared/connectors/secrets.ts";

registerConnectors();
const secrets = supabaseSecretPort();
const allowedHostSuffixes = parseSuffixes(Deno.env.get("CONNECTOR_ALLOWED_HOST_SUFFIXES"));

Deno.serve(createAdminHandler({
  deps: () => ({
    store: supabaseAdminStore(), newToken: () => newInvitationToken(), nowMs: () => Date.now(), secrets, allowedHostSuffixes,
    connectors: {
      health: async (auth, connectorId) => {
        const connector = await connectorById(auth, connectorId);
        const h = await connector.health({ orgId: auth.orgId as string, connectorId, requestId: auth.requestId, actor: { kind: "system", reason: "admin" } });
        return { ok: h.ok, detail: h.detail };
      },
    },
  }),
  limit: limiterFor("admin"),
}));
