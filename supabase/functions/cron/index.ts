// Edge Function « cron » : tâches de fond appelées par la planification de la base (pg_cron + pg_net) avec l'en-tête x-cron-secret.
// Déployée avec verify_jwt = false : l'appel n'a pas de jeton d'utilisateur ; requireCronSecret est la seule porte.
//   ?job=kb-index     : vecteurs des fiches de la base de connaissance ;
//   ?job=alerts-tick  : chaque minute, état des alertes et moteur d'automatisations (_shared/automations/tick.ts).
import { requireCronSecret, requestIdFrom } from "../_shared/auth.ts";
import { supabaseAutomationStore } from "../_shared/automations/engine.ts";
import { alertsTick, supabaseTickSql } from "../_shared/automations/tick.ts";
import { connectorFor } from "../_shared/capabilities/registry.ts";
import { llmGateway } from "../_shared/chat/ports.ts";
import { registerConnectors } from "../_shared/connectors/register.ts";
import { errorResponse, Errors } from "../_shared/errors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { indexPendingChunks } from "../_shared/kb/index.ts";

registerConnectors();

Deno.serve(async (req: Request): Promise<Response> => {
  const requestId = requestIdFrom(req);
  try {
    if (req.method !== "POST") throw Errors.methodNotAllowed();
    const auth = await requireCronSecret(req);
    const job = new URL(req.url).searchParams.get("job");
    if (job === "kb-index") return jsonResponse(200, await indexPendingChunks(auth, llmGateway()), auth.requestId);
    if (job === "alerts-tick") {
      const report = await alertsTick(auth, {
        store: supabaseAutomationStore(),
        // Aucun connecteur de ticketing actif : le ticket local suffit (ce n'est pas une erreur).
        ticketing: { connectorFor: (a) => connectorFor(a, "ticket.create").catch(() => null) },
        sql: supabaseTickSql(),
        nowMs: () => Date.now(),
      });
      return jsonResponse(200, report, auth.requestId);
    }
    throw Errors.badRequest("Tâche inconnue.");
  } catch (e) {
    return errorResponse(e, requestId);
  }
});
