// Edge Function « employee-auth » : connexion du salarié au widget. Déployée avec verify_jwt = false (supabase/config.toml) : les
// opérations avant connexion n'ont pas de jeton, et « link » vérifie le sien elle-même (requireUser).
import { originsFromEnv, withCors } from "../_shared/cors.ts";
import { createEmployeeAuthHandler, defaultEmployeeAuthDeps } from "../_shared/employee_auth/handler.ts";
import { limiterFor } from "../_shared/ratelimit.ts";

Deno.serve(withCors(createEmployeeAuthHandler({ deps: defaultEmployeeAuthDeps, limit: limiterFor("widget") }), originsFromEnv()));
