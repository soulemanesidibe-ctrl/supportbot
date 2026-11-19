// Fournisseur OVHcloud : adresse verrouillée, accès anonyme sans en-tête d'autorisation, même contrat que Mistral.
import assert from "node:assert/strict";
import { LlmError } from "./types.ts";
import { OVH_BASE_URL, ovhConfig, OvhProvider, validateOvhBaseUrl } from "./ovh.ts";
import { SYSTEM_TRIAGE } from "./prompts.ts";

function capture(body: unknown) {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    seen.push({ url, headers });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
  return { seen, fetchFn };
}

const COMPLETION = { model: "Mistral-Small-3.2-24B-Instruct-2506", choices: [{ message: { content: "{\"a\":1}" }, finish_reason: "stop" }], usage: { prompt_tokens: 49, completion_tokens: 21 } };
const req = { purpose: "triage" as const, system: SYSTEM_TRIAGE, messages: [{ role: "user" as const, content: "x" }], maxTokens: 50, json: true };

Deno.test("OVHcloud : seule l'adresse d'AI Endpoints est acceptée (pas d'autre hôte, pas de http, pas d'identifiants)", () => {
  assert.equal(validateOvhBaseUrl(OVH_BASE_URL), OVH_BASE_URL);
  for (const bad of ["https://evil.example", "http://oai.endpoints.kepler.ai.cloud.ovh.net", "https://u:p@oai.endpoints.kepler.ai.cloud.ovh.net", "https://oai.endpoints.kepler.ai.cloud.ovh.net.evil.example", "pas une adresse"]) {
    assert.throws(() => validateOvhBaseUrl(bad), LlmError, bad);
  }
});

Deno.test("OVHcloud anonyme : aucun en-tête d'autorisation ; avec une clé : Bearer ; même lecture de la réponse que Mistral", async () => {
  const anon = capture(COMPLETION);
  const p = new OvhProvider(ovhConfig(), anon.fetchFn);
  const r = await p.complete(req, { signal: new AbortController().signal });
  assert.equal(p.name, "ovhcloud");
  assert.equal(anon.seen[0].url, `${OVH_BASE_URL}/v1/chat/completions`);
  assert.equal(anon.seen[0].headers.authorization, undefined);
  assert.deepEqual([r.text, r.model, r.tokensIn, r.tokensOut], ["{\"a\":1}", "Mistral-Small-3.2-24B-Instruct-2506", 49, 21]);
  const keyed = capture(COMPLETION);
  const fake = ["ovh", "test", "jeton"].join("-"); // assemblé à l'exécution : jamais un vrai secret dans le code
  await new OvhProvider(ovhConfig({ apiKey: fake }), keyed.fetchFn).complete(req, { signal: new AbortController().signal });
  assert.equal(keyed.seen[0].headers.authorization, `Bearer ${fake}`);
});
