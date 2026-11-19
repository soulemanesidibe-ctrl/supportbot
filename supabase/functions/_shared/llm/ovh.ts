// Fournisseur OVHcloud AI Endpoints (société française, infrastructure en Europe) : même protocole que Mistral
// (POST /v1/chat/completions et /v1/embeddings), donc même code que MistralProvider, avec une autre adresse autorisée.
// Accès ANONYME (sans clé) : 2 requêtes par minute, par adresse IP et par modèle ; réservé aux données SYNTHÉTIQUES (évaluation),
// faute de contrat. Avec une clé de projet Public Cloud : 400 requêtes par minute et par modèle, et un cadre contractuel.
// Documentation : https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities
import { MistralConfig, MistralProvider } from "./mistral.ts";
import { LlmError } from "./types.ts";

export const OVH_BASE_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net";
const OVH_HOST = "oai.endpoints.kepler.ai.cloud.ovh.net";
/** Modèles vérifiés le 19 novembre 2026 dans la liste publique (GET /v1/models). bge-m3 : vecteurs de dimension 1024, comme la base. */
export const OVH_DEFAULT_CHAT_MODEL = "Mistral-Small-3.2-24B-Instruct-2506";
export const OVH_DEFAULT_EMBED_MODEL = "bge-m3";

/** Seule l'adresse d'OVHcloud AI Endpoints est acceptée : la requête (et une éventuelle clé) ne part jamais ailleurs. */
export function validateOvhBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new LlmError("config", "Adresse OVHcloud invalide");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.hostname.toLowerCase() !== OVH_HOST) {
    throw new LlmError("config", "L'adresse doit être https://oai.endpoints.kepler.ai.cloud.ovh.net, sans identifiants");
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export function ovhConfig(opts: { apiKey?: string; triage?: string; answer?: string; embed?: string } = {}): MistralConfig {
  return {
    apiKey: opts.apiKey ?? "",
    baseUrl: validateOvhBaseUrl(OVH_BASE_URL),
    modelTriage: opts.triage ?? OVH_DEFAULT_CHAT_MODEL,
    modelAnswer: opts.answer ?? OVH_DEFAULT_CHAT_MODEL,
    modelEmbed: opts.embed ?? OVH_DEFAULT_EMBED_MODEL,
  };
}

export class OvhProvider extends MistralProvider {
  override readonly name: string = "ovhcloud";
}
