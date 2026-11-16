// Edge Function « alerts-ingest » : réception des alertes de supervision par webhook signé (spec § 11.2).
// Adresse : /functions/v1/alerts-ingest/<identifiant de la source>. Déployée avec verify_jwt = false : l'outil de supervision n'a pas de
// jeton d'utilisateur ; la signature HMAC de la source (requireWebhookSource) est la seule porte.
import { handleAlertWebhook, supabaseAlertStore } from "../_shared/alerts/ingest.ts";
import { limiterFor } from "../_shared/ratelimit.ts";

const deps = { store: supabaseAlertStore(), limit: limiterFor("webhook"), nowMs: () => Date.now() };

Deno.serve((req: Request): Promise<Response> => handleAlertWebhook(req, deps));
