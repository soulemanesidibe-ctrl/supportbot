// Branchement réel des gardes sur Supabase (jeton, base). Séparé de auth.ts pour que la logique de décision se teste sans réseau.
import { createClient } from "@supabase/supabase-js";
import { AccessRow, AuthDeps, VerifiedToken } from "./auth.ts";
import { createAccessResolver } from "./db.ts";
import { Errors } from "./errors.ts";

function decodePayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

export function supabaseAuthDeps(): AuthDeps {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resolver = createAccessResolver();
  return {
    async verifyToken(token: string): Promise<VerifiedToken> {
      if (!url || !anonKey) throw Errors.unavailable();
      const client = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      // getUser interroge le serveur d'authentification : signature, expiration ET existence de la session (révocation, R7).
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 500 || error.name === "AuthRetryableFetchError") throw Errors.unavailable();
        throw Errors.unauthorized();
      }
      const user = data.user;
      if (!user || user.is_anonymous === true) throw Errors.unauthorized();
      const claims = decodePayload(token); // sûr : le jeton vient d'être validé par le serveur d'authentification
      if (claims.sub !== user.id || claims.role !== "authenticated") throw Errors.unauthorized();
      return {
        userId: user.id,
        aal: claims.aal === "aal2" ? "aal2" : "aal1",
        amr: Array.isArray(claims.amr) ? claims.amr : [],
      };
    },
    resolveAccess: (userId: string, orgId: string): Promise<AccessRow | null> => resolver(userId, orgId),
    cronSecret: () => Deno.env.get("CRON_SECRET") || undefined,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
}
