// Porte HTTP de la fonction `chat` : méthode, corps borné, authentification (première chose, jamais du métier avant), opération,
// débit, puis le traitement. Une seule porte pour tout ce que fait le salarié :
//   send (défaut)  : un message, traité par l'orchestrateur ; avec « direct », remis à un technicien sans appel au modèle ;
//   context, list, get : ce que le widget affiche (ses demandes seulement) ;
//   escalate, confirm, rate : « Parler à un technicien », « Est-ce que ça a fonctionné ? », note de satisfaction.
import { AuthDeps, requireOrgMember, requestIdFrom } from "../auth.ts";
import { errorResponse, Errors } from "../errors.ts";
import type { Limiter } from "../ratelimit.ts";
import { jsonResponse, readJsonBody } from "../http.ts";
import { handleChatMessage } from "./orchestrator.ts";
import type { ChatPorts } from "./types.ts";
import { WIDGET_OPS, widgetConfirm, widgetContext, widgetEscalate, widgetGet, widgetList, widgetRate } from "./widget.ts";

const MAX_BODY_BYTES = 20_000;
const OPS: readonly string[] = ["send", ...WIDGET_OPS];

function conversationIdOf(body: Record<string, unknown>, required: boolean): string | null {
  const c = body.conversationId;
  if (c === undefined || c === null) {
    if (required) throw Errors.badRequest("Conversation manquante.");
    return null;
  }
  if (typeof c !== "string") throw Errors.badRequest("Conversation invalide.");
  return c;
}

export function createChatHandler(opts: {
  ports: () => ChatPorts;
  authDeps?: AuthDeps;
  /** chat : messages (modèle) ; widget : lectures et gestes sans modèle, plus nombreux. */
  limits: { chat: Limiter; widget: Limiter };
}): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = requestIdFrom(req);
    try {
      if (req.method !== "POST") throw Errors.methodNotAllowed();
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      // L'organisation demandée n'est qu'une DEMANDE : requireOrgMember la confronte à la base (rôle, relation, assignation, gel).
      const auth = await requireOrgMember(req, typeof body.orgId === "string" ? body.orgId : "", ["end_user"], opts.authDeps);
      const op = body.op === undefined ? "send" : body.op;
      if (typeof op !== "string" || !OPS.includes(op)) throw Errors.badRequest("Opération inconnue.");
      // Avant tout travail (modèle, base) : un salarié ne peut saturer ni le fournisseur de modèle ni la base.
      await (op === "send" ? opts.limits.chat : opts.limits.widget)(auth);
      const ports = opts.ports();
      let result: unknown;
      switch (op) {
        case "send": {
          if (body.direct !== undefined && typeof body.direct !== "boolean") throw Errors.badRequest("Paramètre invalide.");
          result = await handleChatMessage(auth, { conversationId: conversationIdOf(body, false), message: body.message as string, direct: body.direct === true }, ports);
          break;
        }
        case "context":
          result = await widgetContext(auth, ports);
          break;
        case "list":
          result = await widgetList(auth, ports);
          break;
        case "get":
          result = await widgetGet(auth, conversationIdOf(body, true) as string, ports);
          break;
        case "escalate":
          result = await widgetEscalate(auth, conversationIdOf(body, true) as string, ports);
          break;
        case "confirm": {
          if (typeof body.worked !== "boolean") throw Errors.badRequest("Réponse invalide.");
          result = await widgetConfirm(auth, conversationIdOf(body, true) as string, body.worked, ports);
          break;
        }
        case "rate":
          result = await widgetRate(auth, conversationIdOf(body, true) as string, body.score, ports);
          break;
      }
      return jsonResponse(200, result, auth.requestId);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}
