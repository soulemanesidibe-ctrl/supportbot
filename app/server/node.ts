// Petit serveur Node pour un hébergement en France (Scaleway, Clever Cloud, OVHcloud...) : sert le dossier `dist`, applique les
// en-têtes de sécurité et porte la passerelle de session. Aucune dépendance. Lancement : `node server/node.ts` (Node 22.18 ou plus).
// Variables : PUBLIC_ORIGIN (adresse publique exacte, https), SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PORT, RELEVE_DIST.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { securityHeaders } from "./headers.ts";
import { createSessionHandler, type SessionEnv } from "./session.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Chemin d'un fichier DANS `root`, ou null (remontée « .. », octet nul, encodage invalide). */
export function safePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const full = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  return full === root || full.startsWith(root + sep) ? full : null;
}

async function bodyOf(req: IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > max) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createNodeHandler(opts: { root: string; publicOrigin: string; env: SessionEnv; fetcher?: Parameters<typeof createSessionHandler>[1] }) {
  const root = resolve(opts.root);
  const session = createSessionHandler(opts.env, opts.fetcher);
  const security = securityHeaders(opts.env.SUPABASE_URL);
  const send = (res: ServerResponse, status: number, headers: Record<string, string>, body?: Buffer | string) => {
    res.writeHead(status, { ...security, ...headers });
    res.end(body);
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      // L'adresse publique vient de la configuration, jamais de l'en-tête Host (qu'un client peut choisir).
      const url = new URL(req.url ?? "/", opts.publicOrigin);
      const m = /^\/api\/session\/([a-z]{1,16})$/.exec(url.pathname);
      if (m) {
        const raw = req.method === "POST" ? await bodyOf(req, 4_096) : "";
        if (raw === null) return send(res, 413, { "content-type": "application/json", "cache-control": "no-store" }, '{"error":{"code":"bad_request"}}');
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const out = await session(new Request(url, { method: req.method, headers, body: req.method === "POST" ? raw : undefined }), m[1] as string);
        const h: Record<string, string> = {};
        out.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
        res.writeHead(out.status, { ...security, ...h, ...(out.headers.get("set-cookie") ? { "set-cookie": out.headers.get("set-cookie") as string } : {}) });
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { allow: "GET, HEAD" });
      let file = safePath(root, url.pathname);
      if (file === null) return send(res, 400, { "content-type": "text/plain; charset=utf-8" }, "Requête invalide");
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        // Application d'une seule page : une adresse sans extension (/w/client-alpha, /console) rend index.html.
        if (extname(url.pathname) !== "") return send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "Introuvable");
        file = resolve(root, "index.html");
      }
      const body = await readFile(file);
      const type = TYPES[extname(file)] ?? "application/octet-stream";
      const cache = file.startsWith(resolve(root, "assets") + sep) ? "public, max-age=31536000, immutable" : "no-cache";
      send(res, 200, { "content-type": type, "cache-control": cache }, req.method === "HEAD" ? undefined : body);
    } catch {
      send(res, 500, { "content-type": "text/plain; charset=utf-8" }, "Erreur");
    }
  };
}

// Lancement direct (pas à l'import, pour les tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? "";
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(publicOrigin)) {
    console.error("PUBLIC_ORIGIN doit être l'adresse publique exacte, en https (par exemple https://releve.exemple.fr).");
    process.exit(2);
  }
  const handler = createNodeHandler({
    root: process.env.RELEVE_DIST ?? "dist",
    publicOrigin,
    env: { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY },
  });
  const port = Number(process.env.PORT ?? "8080");
  createServer((req, res) => void handler(req, res)).listen(port, () => console.log(`Relève : écoute sur le port ${port}`));
}
