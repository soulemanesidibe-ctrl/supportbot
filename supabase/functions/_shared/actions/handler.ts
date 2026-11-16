// Porte HTTP de la fonction `actions` : validation, refus et reprise d'exécution d'une action par un technicien. Première instruction :
// l'authentification (requireOrgMember, rôles de technicien). Le jeton Microsoft du valideur arrive dans le corps de CETTE requête, sert
// dans cette requête, et n'est ni stocké, ni journalisé, ni renvoyé.
import { AuthDeps, requireOrgMember, requestIdFrom } from "../auth.ts";
import { errorResponse, Errors } from "../errors.ts";
import type { Limiter } from "../ratelimit.ts";
import { jsonResponse, readJsonBody } from "../http.ts";
import { approveAction, rejectAction } from "./approve.ts";
import { executeApprovedAction, ExecDeps } from "./execute.ts";

const MAX_BODY_BYTES = 20_000;
const TECHNICIANS = ["partner_technician", "org_technician"] as const;

export function createActionsHandler(opts: { deps: () => ExecDeps; authDeps?: AuthDeps; limit: Limiter }): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    try {
      if (req.method !== "POST") throw Errors.methodNotAllowed();
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const auth = await requireOrgMember(req, typeof body.orgId === "string" ? body.orgId : "", TECHNICIANS, opts.authDeps);
      await opts.limit(auth);
      const deps = opts.deps();
      switch (body.op) {
        case "approve": {
          const out = await approveAction(auth, {
            actionId: body.actionId,
            seenHash: body.seenHash,
            identityMethod: body.identityMethod,
            viaDelegationId: body.viaDelegationId,
            delegatedToken: body.microsoftToken,
          }, deps);
          return jsonResponse(200, out, auth.requestId);
        }
        case "execute": {
          // Reprise d'une exécution après une approbation restée sans suite (jeton à renouveler) : mêmes contrôles que l'approbation.
          if (typeof body.actionId !== "string" || typeof body.microsoftToken !== "string") throw Errors.badRequest("Requête invalide.");
          return jsonResponse(200, await executeApprovedAction(auth, body.actionId, body.microsoftToken, deps), auth.requestId);
        }
        case "reject": {
          await rejectAction(auth, { actionId: body.actionId, reason: body.reason }, deps);
          return jsonResponse(200, { ok: true }, auth.requestId);
        }
        default:
          throw Errors.badRequest("Opération inconnue.");
      }
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}
