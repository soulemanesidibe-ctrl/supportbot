// Écrit dist/_headers (Cloudflare Pages) à partir de la définition unique des en-têtes de sécurité (server/headers.ts).
// L'adresse du projet Supabase vient de VITE_SUPABASE_URL ; sans elle, les connexions sont limitées à notre origine.
import { writeFileSync } from "node:fs";
import { headersFile } from "../server/headers.ts";

writeFileSync(new URL("../dist/_headers", import.meta.url), headersFile(process.env.VITE_SUPABASE_URL));
console.log("dist/_headers écrit");
