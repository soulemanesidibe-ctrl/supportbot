// Aides HTTP communes aux Edge Functions : lecture bornée du corps (jamais plus que prévu en mémoire) et réponses JSON sans mise en cache.
import { Errors } from "./errors.ts";

/** Lit un corps JSON en refusant tout ce qui dépasse `maxBytes`, même sans en-tête Content-Length. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) throw Errors.badRequest("Le corps doit être du JSON.");
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
  } catch {
    throw Errors.badRequest("JSON invalide.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw Errors.badRequest("Un objet JSON est attendu.");
  return parsed as Record<string, unknown>;
}

export function jsonResponse(status: number, body: unknown, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId },
  });
}
