// Rejoue tous les enregistrements à jour et écrit le rapport généré dans docs/evaluation.md, entre deux repères.
//   deno run --allow-read=../seed,_eval,../../docs --allow-write=../../docs/evaluation.md _eval/report.ts
import { makeAuth } from "../_shared/testing.ts";
import { CASES } from "./cases.ts";
import { evaluateRecording, freshness, reportMarkdown } from "./evaluate.ts";
import { loadSeedFiches } from "./kb.ts";
import type { Recording } from "./types.ts";

const DIR = new URL("./recordings/", import.meta.url);
const DOC = new URL("../../../docs/evaluation.md", import.meta.url);
const START = "<!-- DÉBUT DU RAPPORT GÉNÉRÉ -->";
const END = "<!-- FIN DU RAPPORT GÉNÉRÉ -->";

export async function loadRecordings(): Promise<Recording[]> {
  const out: Recording[] = [];
  for await (const e of Deno.readDir(DIR)) {
    if (e.isFile && e.name.endsWith(".json")) out.push(JSON.parse(await Deno.readTextFile(new URL(e.name, DIR))));
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

if (import.meta.main) {
  const fiches = await loadSeedFiches();
  const auth = await makeAuth();
  const evals = [];
  const stale = [];
  for (const rec of await loadRecordings()) {
    const f = await freshness(rec, CASES);
    if (!f.fresh) stale.push({ label: rec.label, reasons: f.reasons });
    else evals.push(await evaluateRecording(auth, rec, CASES, fiches));
  }
  const generated = reportMarkdown(evals, stale);
  const doc = await Deno.readTextFile(DOC);
  const a = doc.indexOf(START), b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error("Repères du rapport généré absents de docs/evaluation.md");
  await Deno.writeTextFile(DOC, `${doc.slice(0, a + START.length)}\n${generated}\n${doc.slice(b)}`);
  console.log(`docs/evaluation.md mis à jour (${evals.length} enregistrement(s) à jour, ${stale.length} périmé(s)).`);
}
