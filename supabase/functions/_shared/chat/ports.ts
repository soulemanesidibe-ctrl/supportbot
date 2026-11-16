// Branchement des vraies dépendances de l'orchestrateur. La passerelle LLM est créée UNE fois par instance de la fonction, pour que
// la file d'attente et le disjoncteur servent toutes les requêtes de l'instance. Le modèle est appelé paresseusement : si la clé
// Mistral manque, l'erreur de configuration arrive DANS l'orchestrateur, qui passe la main à un technicien au lieu de planter.
import { auditEvent } from "../audit.ts";
import { LlmGateway } from "../llm/gateway.ts";
import { MistralProvider, mistralConfigFromEnv } from "../llm/mistral.ts";
import { recordLlmCall, recordLlmFailure } from "../llm/usage.ts";
import { supabaseChatStore } from "./store.ts";
import type { ChatPorts } from "./types.ts";

let gateway: LlmGateway | undefined;
export function llmGateway(): LlmGateway {
  gateway ??= new LlmGateway(new MistralProvider(mistralConfigFromEnv()));
  return gateway;
}

export function defaultChatPorts(): ChatPorts {
  return {
    llm: {
      complete: (req) => llmGateway().complete(req),
      embed: (texts, priority) => llmGateway().embed(texts, priority),
    },
    store: supabaseChatStore(),
    usage: {
      call: (auth, rec) => recordLlmCall(auth, rec),
      failure: (auth, purpose, kind) => recordLlmFailure(auth, purpose, kind),
    },
    audit: (auth, ev) => auditEvent(auth, ev),
  };
}
