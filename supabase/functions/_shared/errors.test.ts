import assert from "node:assert/strict";
import { AppError, errorResponse, Errors } from "./errors.ts";

Deno.test("errorResponse : une erreur applicative donne son statut, son code et son identifiant de requête", async () => {
  const res = errorResponse(Errors.forbidden(), "req-12345678");
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { error: { code: "forbidden", message: "Accès refusé.", requestId: "req-12345678" } });
});

Deno.test("errorResponse : une erreur inconnue devient une 500 anonyme et son détail va au journal, MASQUÉ", async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (l: unknown) => lines.push(String(l));
  try {
    const res = errorResponse(new Error("connexion refusée password=SuperSecret99 sur db.exemple.test"), "req-abcdefgh");
    const body = JSON.stringify(await res.json());
    assert.equal(res.status, 500);
    assert.ok(!body.includes("SuperSecret99") && !body.includes("db.exemple.test"), "rien d'interne dans la réponse");
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes("SuperSecret99"), "le secret est masqué dans le journal");
  assert.ok(lines[0].includes("erreur_non_geree"));
});

Deno.test("errorResponse : une limite de débit annonce quand réessayer", () => {
  const res = errorResponse(Errors.rateLimited(12.2), "req-12345678");
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "13");
});

Deno.test("Errors : les refus d'accès sont identiques, qu'une ressource existe ou non (pas d'énumération)", () => {
  assert.equal(Errors.forbidden().message, "Accès refusé.");
  assert.ok(Errors.forbidden() instanceof AppError);
  assert.equal(Errors.mfaRequired().code, "mfa_required");
  assert.equal(Errors.orgFrozen().status, 403);
});
