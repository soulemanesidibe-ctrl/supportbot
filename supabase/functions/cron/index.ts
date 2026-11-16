// Edge Function « cron » : tâches de fond appelées par la planification de la base (pg_cron + pg_net) avec l'en-tête x-cron-secret.
// Déployée avec verify_jwt = false : l'appel n'a pas de jeton d'utilisateur ; requireCronSecret est la seule porte.
import { requireCronSecret, requestIdFrom } from "../_shared/auth.ts";
import { llmGateway } from "../_shared/chat/ports.ts";
import { errorResponse, Errors } from "../_shared/errors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { indexPendingChunks } from "../_shared/kb/index.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const requestId = requestIdFrom(req);
  try {
    if (req.method !== "POST") throw Errors.methodNotAllowed();
    const auth = await requireCronSecret(req);
    const job = new URL(req.url).searchParams.get("job");
    if (job === "kb-index") return jsonResponse(200, await indexPendingChunks(auth, llmGateway()), auth.requestId);
    throw Errors.badRequest("Tâche inconnue.");
  } catch (e) {
    return errorResponse(e, requestId);
  }
});
