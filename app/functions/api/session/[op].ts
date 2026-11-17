// Fonction Cloudflare Pages : la passerelle de session (server/session.ts), si le front est hébergé sur Cloudflare Pages.
// Variables du projet Pages : SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (clé publiable, jamais la clé secrète).
import { createSessionHandler, type SessionEnv } from "../../../server/session.ts";

export const onRequest = (ctx: { request: Request; env: SessionEnv; params: { op?: string | string[] } }): Promise<Response> =>
  createSessionHandler(ctx.env)(ctx.request, typeof ctx.params.op === "string" ? ctx.params.op : "");
