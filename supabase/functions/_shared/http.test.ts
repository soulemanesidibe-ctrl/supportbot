import assert from "node:assert/strict";
import { AppError } from "./errors.ts";
import { jsonResponse, readJsonBody } from "./http.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("https://exemple.test/x", { method: "POST", headers, body });
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof AppError ? `${e.code}:${e.message}` : `autre:${(e as Error).message}`; }
  return "aucune erreur";
}

Deno.test("readJsonBody : un objet JSON valide est lu", async () => {
  assert.deepEqual(await readJsonBody(post('{"a":1}'), 100), { a: 1 });
  assert.deepEqual(await readJsonBody(post('{"a":1}', { "content-type": "application/json; charset=utf-8" }), 100), { a: 1 });
});

Deno.test("readJsonBody : mauvais type, corps absent, tableau, texte, JSON invalide, UTF-8 invalide = bad_request", async () => {
  assert.match(await code(readJsonBody(post('{"a":1}', { "content-type": "text/plain" }), 100)), /^bad_request/);
  assert.match(await code(readJsonBody(post(null), 100)), /^bad_request/);
  assert.match(await code(readJsonBody(post("[1,2]"), 100)), /^bad_request/);
  assert.match(await code(readJsonBody(post('"texte"'), 100)), /^bad_request/);
  assert.match(await code(readJsonBody(post("{pas du json"), 100)), /^bad_request/);
  assert.match(await code(readJsonBody(post(new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d])), 100)), /^bad_request/);
});

Deno.test("readJsonBody : un corps trop gros est refusé, même sans Content-Length (flux), et n'est pas lu en entier", async () => {
  assert.match(await code(readJsonBody(post('{"a":"' + "x".repeat(500) + '"}', { "content-type": "application/json", "content-length": "9000" }), 100)), /trop volumineuse/);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) { sent += 50; ctrl.enqueue(new Uint8Array(50).fill(0x20)); if (sent > 5000) ctrl.close(); },
  });
  const req = new Request("https://exemple.test/x", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.match(await code(readJsonBody(req, 200)), /trop volumineuse/);
  assert.ok(sent < 1000, `le flux a été interrompu tôt (${sent} octets lus)`);
});

Deno.test("jsonResponse : jamais de mise en cache, identifiant de requête renvoyé", () => {
  const r = jsonResponse(200, { ok: true }, "req-12345678");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-request-id"), "req-12345678");
});
