import assert from "node:assert/strict";
import { EMBEDDING_DIMENSION, MistralConfig, MistralProvider, validateBaseUrl } from "./mistral.ts";
import { definePrompt } from "./prompt_registry.ts";
import { LlmError } from "./types.ts";

const cfg: MistralConfig = {
  apiKey: "cle-factice-pour-test",
  baseUrl: "https://api.mistral.ai",
  modelTriage: "petit",
  modelAnswer: "moyen",
  modelEmbed: "embed",
};
const SYS = definePrompt("test.mistral", "v1", "Tu es un assistant de test, réponds brièvement.");
const signal = new AbortController().signal;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function provider(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
  return { p: new MistralProvider(cfg, f), calls };
}
const req = (purpose: "triage" | "answer" = "answer", extra = {}) =>
  ({ purpose, system: SYS, messages: [{ role: "user" as const, content: "Bonjour" }], maxTokens: 200, ...extra });
async function kindOf(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof LlmError ? e.kind : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("validateBaseUrl : seulement https vers mistral.ai, sans identifiants (la clé ne part pas ailleurs)", () => {
  assert.equal(validateBaseUrl("https://api.mistral.ai/"), "https://api.mistral.ai");
  for (const bad of ["http://api.mistral.ai", "https://evil.exemple.test", "https://api.mistral.ai.evil.test", "https://u:p@api.mistral.ai", "pas une url"]) {
    assert.throws(() => validateBaseUrl(bad), (e: unknown) => (e as LlmError).kind === "config", bad);
  }
});

Deno.test("complete : requête conforme à la documentation (chemin, en-têtes, corps) et résultat normalisé", async () => {
  const { p, calls } = provider(() => json({ model: "moyen-2026", choices: [{ index: 0, message: { role: "assistant", content: "Salut" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }));
  const r = await p.complete(req("answer", { json: true, temperature: 0.1 }), { signal });
  assert.equal(calls[0].url, "https://api.mistral.ai/v1/chat/completions");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer cle-factice-pour-test");
  assert.equal(calls[0].init.redirect, "error");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.model, "moyen");
  assert.deepEqual(body.messages[0], { role: "system", content: SYS });
  assert.deepEqual(body.messages[1], { role: "user", content: "Bonjour" });
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, 200);
  assert.deepEqual({ text: r.text, model: r.model, finish: r.finishReason, in: r.tokensIn, out: r.tokensOut }, { text: "Salut", model: "moyen-2026", finish: "stop", in: 12, out: 3 });
});

Deno.test("complete : le tri utilise le petit modèle, la réponse le moyen", async () => {
  const { p, calls } = provider(() => json({ choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: {} }));
  await p.complete(req("triage"), { signal });
  await p.complete(req("answer"), { signal });
  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body as string).model), ["petit", "moyen"]);
});

Deno.test("complete : le contenu en morceaux est recollé, une réponse sans texte est refusée", async () => {
  const chunks = provider(() => json({ choices: [{ message: { content: [{ type: "text", text: "A" }, { type: "image_url", image_url: "x" }, { type: "text", text: "B" }] }, finish_reason: "stop" }] }));
  assert.equal((await chunks.p.complete(req(), { signal })).text, "AB");
  for (const bad of [{}, { choices: [] }, { choices: [{ message: {} }] }, { choices: [{ message: { content: 42 } }] }]) {
    assert.equal(await kindOf(provider(() => json(bad)).p.complete(req(), { signal })), "invalid_response", JSON.stringify(bad));
  }
});

Deno.test("erreurs HTTP : 429 et 5xx se reprennent, 400 et 401 jamais ; Retry-After lu s'il existe", async () => {
  const mk = (status: number, headers: Record<string, string> = {}) => provider(() => new Response("détail interne avec cle-factice-pour-test", { status, headers })).p;
  assert.equal(await kindOf(mk(429).complete(req(), { signal })), "rate_limited");
  assert.equal(await kindOf(mk(503).complete(req(), { signal })), "unavailable");
  assert.equal(await kindOf(mk(400).complete(req(), { signal })), "bad_request");
  assert.equal(await kindOf(mk(401).complete(req(), { signal })), "auth");
  assert.equal(await kindOf(mk(403).complete(req(), { signal })), "auth");
  try { await mk(429, { "retry-after": "7" }).complete(req(), { signal }); } catch (e) { assert.equal((e as LlmError).retryAfterMs, 7000); }
  try { await mk(429, { "retry-after": "99999" }).complete(req(), { signal }); } catch (e) { assert.equal((e as LlmError).retryAfterMs, 60_000, "plafonné"); }
});

Deno.test("erreurs : aucun message d'erreur ne contient la clé, l'URL ni le corps de la réponse", async () => {
  const hostile = provider(() => new Response("clé cle-factice-pour-test https://api.mistral.ai/v1", { status: 500 })).p;
  try { await hostile.complete(req(), { signal }); assert.fail(); } catch (e) {
    assert.ok(!(e as Error).message.includes("cle-factice") && !(e as Error).message.includes("api.mistral.ai"));
  }
  const network = new MistralProvider(cfg, (() => Promise.reject(new Error("ECONNREFUSED https://api.mistral.ai avec Bearer cle-factice-pour-test"))) as unknown as typeof fetch);
  try { await network.complete(req(), { signal }); assert.fail(); } catch (e) {
    assert.equal((e as LlmError).kind, "unavailable");
    assert.ok(!(e as Error).message.includes("cle-factice") && !(e as Error).message.includes("ECONNREFUSED"));
  }
});

Deno.test("complete : un appel interrompu devient un délai dépassé (reprenable)", async () => {
  const ctrl = new AbortController();
  const slow = new MistralProvider(cfg, ((_u: string, init: RequestInit) =>
    new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch);
  const pending = kindOf(slow.complete(req(), { signal: ctrl.signal }));
  ctrl.abort();
  assert.equal(await pending, "timeout");
});

const vec = (n = EMBEDDING_DIMENSION) => Array.from({ length: n }, (_, i) => i / n);

Deno.test("embed : ordre rétabli par index, dimension 1024 exigée, valeurs finies exigées", async () => {
  const ok = provider(() => json({ model: "embed", data: [{ index: 1, embedding: vec() }, { index: 0, embedding: vec().map((x) => x + 1) }], usage: { prompt_tokens: 9 } }));
  const r = await ok.p.embed(["a", "b"], { signal });
  assert.equal(r.vectors.length, 2);
  assert.ok(r.vectors[0][0] === 1 && r.vectors[1][0] === 0, "index 0 en premier");
  assert.equal(r.tokensIn, 9);
  assert.equal(ok.calls[0].url, "https://api.mistral.ai/v1/embeddings");
  assert.deepEqual(JSON.parse(ok.calls[0].init.body as string), { model: "embed", input: ["a", "b"] });
  for (const bad of [
    { data: [{ index: 0, embedding: vec(768) }] },
    { data: [{ index: 0, embedding: [...vec(1023), NaN] }] },
    { data: [{ index: 0, embedding: vec() }, { index: 1, embedding: vec() }] },
    { data: [] },
    {},
  ]) {
    assert.equal(await kindOf(provider(() => json(bad)).p.embed(["a"], { signal })), "invalid_response");
  }
});
