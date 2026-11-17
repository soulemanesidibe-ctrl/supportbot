// Edge Function « console » : gestes du technicien sur une demande (répondre, prendre, clore). verify_jwt = false
// (supabase/config.toml) : la vérification du jeton, de l'organisation, du rôle et du second facteur est faite par requireOrgMember.
import { createConsoleHandler, defaultConsoleDeps } from "../_shared/console/handler.ts";
import { originsFromEnv, withCors } from "../_shared/cors.ts";
import { limiterFor } from "../_shared/ratelimit.ts";

Deno.serve(withCors(createConsoleHandler({ deps: defaultConsoleDeps, limit: limiterFor("console") }), originsFromEnv()));
