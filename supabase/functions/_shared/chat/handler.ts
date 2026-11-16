// Porte HTTP de la fonction `chat` : méthode, corps borné, authentification (première chose, jamais du métier avant), puis l'orchestrateur.
import { AuthDeps, requireOrgMember, requestIdFrom } from "../auth.ts";
import { errorResponse, Errors } from "../errors.ts";
import { jsonResponse, readJsonBody } from "../http.ts";
import { handleChatMessage } from "./orchestrator.ts";
import type { ChatPorts } from "./types.ts";

const MAX_BODY_BYTES = 20_000;

export function createChatHandler(opts: { ports: () => ChatPorts; authDeps?: AuthDeps }): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    try {
      if (req.method !== "POST") throw Errors.methodNotAllowed();
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      // L'organisation demandée n'est qu'une DEMANDE : requireOrgMember la confronte à la base (rôle, relation, assignation, gel).
      const auth = await requireOrgMember(req, typeof body.orgId === "string" ? body.orgId : "", ["end_user"], opts.authDeps);
      const conversationId = body.conversationId === undefined || body.conversationId === null ? null : body.conversationId;
      if (conversationId !== null && typeof conversationId !== "string") throw Errors.badRequest("Conversation invalide.");
      const result = await handleChatMessage(auth, { conversationId, message: body.message as string }, opts.ports());
      return jsonResponse(200, result, auth.requestId);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}
