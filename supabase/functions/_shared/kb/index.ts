// Indexation de la base de connaissance : calcule le vecteur des morceaux qui n'en ont pas encore (les fiches de démonstration n'en ont
// aucun). Tâche de fond (priorité « background » : une conversation passe toujours avant). Appelée par la fonction `cron`.
import { AuthContext } from "../context.ts";
import { DbDeps, serviceClient } from "../db.ts";
import { Errors } from "../errors.ts";
import { log } from "../log.ts";
import { redactText } from "../redact.ts";
import type { EmbeddingResult } from "../llm/types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export async function indexPendingChunks(
  auth: AuthContext,
  llm: { embed(texts: readonly string[], priority?: "interactive" | "background"): Promise<EmbeddingResult> },
  batch = 16,
  deps?: DbDeps,
): Promise<{ indexed: number }> {
  if (auth.kind !== "cron") throw Errors.forbidden(); // tâche interne seulement
  const db = serviceClient(auth, deps);
  const { data, error } = await db.from("kb_chunks").select("id, org_id, content").is("embedding", null).order("created_at", { ascending: true })
    .limit(Math.min(Math.max(batch, 1), 32));
  if (error) throw Errors.unavailable();
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return { indexed: 0 };
  const result = await llm.embed(rows.map((r) => redactText(String(r.content))), "background");
  if (result.vectors.length !== rows.length) throw Errors.unavailable();
  let indexed = 0;
  for (let i = 0; i < rows.length; i++) {
    // On ne modifie QUE ce morceau, dans SON organisation, et seulement s'il n'a toujours pas de vecteur (pas d'écrasement concurrent).
    const { error: e } = await db.from("kb_chunks").update({ embedding: JSON.stringify(result.vectors[i]), embedded_at: new Date().toISOString() })
      .eq("id", rows[i].id).eq("org_id", rows[i].org_id).is("embedding", null);
    if (e) log.warn("kb_indexation_morceau_en_echec", { chunk: rows[i].id });
    else indexed++;
  }
  return { indexed };
}
