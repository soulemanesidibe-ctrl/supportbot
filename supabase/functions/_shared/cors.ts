// Appels du navigateur vers les fonctions (R3-06, SEC-23) : seules les origines de la LISTE BLANCHE (adresses exactes des écrans de
// Relève) reçoivent les en-têtes CORS. Jamais « * », jamais de cookie (les fonctions lisent un jeton Bearer, pas un cookie) :
//   - pré-vol OPTIONS d'une origine autorisée : 204 avec méthode POST et en-têtes permis ; d'une autre origine : 403 sans en-tête ;
//   - réponse ordinaire : l'en-tête Access-Control-Allow-Origin n'est ajouté que pour une origine autorisée.
// Sans liste (variable RELEVE_ALLOWED_ORIGINS absente), AUCUNE origine n'est autorisée : le navigateur ne peut pas appeler,
// les appels de serveur à serveur (webhook, tâches planifiées) ne sont pas concernés.

const ORIGIN = /^(https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?)$/;
const ALLOW_HEADERS = "authorization, content-type, x-request-id, apikey, x-client-info";
const EXPOSE_HEADERS = "x-request-id, retry-after";

/** Liste blanche lue dans une chaîne « origine1,origine2 » ; une entrée mal formée (joker, chemin, http public) est ignorée. */
export function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const o = part.trim().toLowerCase();
    if (ORIGIN.test(o)) out.add(o);
  }
  return out;
}

export function originsFromEnv(): ReadonlySet<string> {
  return parseAllowedOrigins(Deno.env.get("RELEVE_ALLOWED_ORIGINS"));
}

export function withCors(handler: (req: Request) => Promise<Response>, allowed: ReadonlySet<string>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const ok = origin !== null && allowed.has(origin);
    if (req.method === "OPTIONS") {
      if (!ok) return new Response(null, { status: 403, headers: { vary: "Origin" } });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "POST",
          "access-control-allow-headers": ALLOW_HEADERS,
          "access-control-max-age": "600",
          vary: "Origin",
        },
      });
    }
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.append("vary", "Origin");
    if (ok) {
      headers.set("access-control-allow-origin", origin);
      headers.set("access-control-expose-headers", EXPOSE_HEADERS);
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
