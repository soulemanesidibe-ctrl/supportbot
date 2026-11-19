// Fiches de la base de connaissance utilisées par l'évaluation : lues DIRECTEMENT dans la graine de démonstration
// (supabase/seed/02_base_de_connaissance.sql), pour que l'évaluation porte exactement sur les fiches de la démo, sans copie
// qui pourrait diverger. Seules les fiches du client Alpha sont gardées (celles du client Bêta servent au test d'isolation).
import type { Category } from "../_shared/llm/schemas.ts";

export const ALPHA_ORG = "00000000-0000-4000-8000-0000000000b1";
const SEED_URL = new URL("../../seed/02_base_de_connaissance.sql", import.meta.url);

export interface Fiche {
  readonly id: string;
  readonly title: string;
  readonly category: Category;
  readonly text: string;
}

/** Découpe les n-uplets « ('…', '…', 3, '…') » d'une instruction insert : chaînes SQL (avec '' pour une apostrophe) et nombres. */
export function sqlTuples(sql: string): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [];
  let i = 0;
  let depth = 0;
  let current: Array<string | number> = [];
  let token = "";
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let s = "";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          s += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          s += sql[i++];
        }
      }
      if (depth === 1) current.push(s);
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "(") {
      depth++;
      if (depth === 1) {
        current = [];
        token = "";
      }
    } else if (c === ")") {
      if (depth === 1) {
        if (token.trim() !== "") current.push(/^\d+$/.test(token.trim()) ? Number(token.trim()) : token.trim());
        out.push(current);
      }
      depth--;
      token = "";
    } else if (c === "," && depth === 1) {
      if (token.trim() !== "") current.push(/^\d+$/.test(token.trim()) ? Number(token.trim()) : token.trim());
      token = "";
    } else if (depth === 1) {
      token += c;
    }
    i++;
  }
  return out;
}

/** Fiches du client Alpha : titre et catégorie (kb_documents), texte (kb_chunks, morceaux réunis dans l'ordre). */
export function parseSeedFiches(sql: string): Fiche[] {
  const docsPart = sql.slice(sql.indexOf("insert into public.kb_documents"), sql.indexOf("insert into public.kb_chunks"));
  const chunksPart = sql.slice(sql.indexOf("insert into public.kb_chunks"));
  const docs = sqlTuples(docsPart.slice(docsPart.indexOf("values")))
    .filter((t) => t[1] === ALPHA_ORG)
    .map((t) => ({ id: String(t[0]), title: String(t[2]), category: String(t[3]) as Category }));
  const texts = new Map<string, Array<{ idx: number; content: string }>>();
  for (const t of sqlTuples(chunksPart.slice(chunksPart.indexOf("values")))) {
    if (t[0] !== ALPHA_ORG) continue;
    const list = texts.get(String(t[1])) ?? [];
    list.push({ idx: Number(t[2]), content: String(t[3]) });
    texts.set(String(t[1]), list);
  }
  return docs.map((d) => ({ ...d, text: (texts.get(d.id) ?? []).sort((a, b) => a.idx - b.idx).map((c) => c.content).join("\n") }));
}

export async function loadSeedFiches(): Promise<Fiche[]> {
  return parseSeedFiches(await Deno.readTextFile(SEED_URL));
}
