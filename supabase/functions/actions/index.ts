// Edge Function « actions » : validation, refus et exécution des actions de niveau 1 par un technicien. verify_jwt = false (voir
// supabase/config.toml) : la vérification du jeton et des rôles est faite par requireOrgMember, en première instruction.
import { createActionsHandler } from "../_shared/actions/handler.ts";
import { supabaseActionStore } from "../_shared/actions/store.ts";
import { connectorFor } from "../_shared/capabilities/registry.ts";

Deno.serve(createActionsHandler({ deps: () => ({ store: supabaseActionStore(), connectorFor: (auth, name) => connectorFor(auth, name) }) }));
