// Aides HTTP communes aux Edge Functions : lecture bornée du corps (jamais plus que prévu en mémoire) et réponses JSON sans mise en cache.
import { Errors } from "./errors.ts";

/**
 * Lit le corps BRUT (octets) en refusant tout ce qui dépasse `maxBytes`, même sans en-tête Content-Length. Sert aux webhooks signés :
 * la signature porte sur les octets reçus, jamais sur un texte décodé puis réencodé.
 */
export async function readRawBody(req: Request, maxBytes: number, contentType = "application/json"): Promise<Uint8Array> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith(contentType)) throw Errors.badRequest("Le corps doit être du JSON.");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw Errors.badRequest("Requête trop volumineuse.");
  const reader = req.body?.getReader();
  if (!reader) throw Errors.badRequest("Corps absent.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw Errors.badRequest("Requête trop volumineuse.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return all;
}

/** Décode des octets en objet JSON (UTF-8 strict). Un tableau, un nombre ou une chaîne sont refusés. */
export function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Errors.badRequest("JSON invalide.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw Errors.badRequest("Un objet JSON est attendu.");
  return parsed as Record<string, unknown>;
}

/** Lit un corps JSON en refusant tout ce qui dépasse `maxBytes`, même sans en-tête Content-Length. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  return parseJsonObject(await readRawBody(req, maxBytes));
}

export function jsonResponse(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId },
  });
}
