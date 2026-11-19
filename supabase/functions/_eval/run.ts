// Évaluation RÉELLE : fait passer chaque cas dans l'orchestrateur avec le vrai modèle Mistral et ENREGISTRE ses sorties.
//
//   deno run --allow-net=api.mistral.ai --allow-env=MISTRAL_API_KEY,MISTRAL_BASE_URL,MISTRAL_MODEL_TRIAGE,MISTRAL_MODEL_ANSWER,MISTRAL_MODEL_EMBED \
//     --allow-read=../seed,_eval --allow-write=_eval/recordings \
//     _eval/run.ts --label small --answer-model mistral-small-latest
//
// Options : --label (nom de l'enregistrement), --answer-model, --triage-model (défaut mistral-small-latest), --embed-model
// (défaut mistral-embed), --only id1,id2 (quelques cas), --dataset <fichier.json HORS du dépôt> et --out <fichier HORS du dépôt>
// pour un jeu réel anonymisé. Un jeu réel ne doit JAMAIS entrer dans le dépôt : la commande refuse un chemin qui s'y trouve.
// La clé n'est jamais écrite ni affichée ; elle n'est lue que dans MISTRAL_API_KEY.
import { makeAuth } from "../_shared/testing.ts";
import { LlmGateway } from "../_shared/llm/gateway.ts";
import { MistralConfig, mistralConfigFromEnv, MistralProvider } from "../_shared/llm/mistral.ts";
import { redactText } from "../_shared/redact.ts";
import { CASES, casesHash } from "./cases.ts";
import { promptVersions } from "./evaluate.ts";
import { Fiche, loadSeedFiches } from "./kb.ts";
import { liveBackend, runCase } from "./rig.ts";
import { scoreCase } from "./score.ts";
import type { EvalCase, RecordedCase, Recording } from "./types.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

async function absolute(path: string): Promise<string> {
  const p = path.startsWith("/") ? path : `${Deno.cwd()}/${path}`;
  try {
    return await Deno.realPath(p);
  } catch {
    return p;
  }
}

async function outsideRepo(path: string, what: string): Promise<string> {
  const abs = await absolute(path);
  if (abs.startsWith(REPO_ROOT)) {
    console.error(`${what} « ${path} » est DANS le dépôt : un jeu réel et ses résultats doivent rester hors du dépôt (docs/11 § 2).`);
    Deno.exit(2);
  }
  return abs;
}

const label = arg("label") ?? "essai";
if (!/^[a-z0-9-]{1,40}$/.test(label)) {
  console.error("--label : lettres minuscules, chiffres et tirets seulement.");
  Deno.exit(2);
}
const dataset = arg("dataset");
const cases: EvalCase[] = dataset
  ? JSON.parse(await Deno.readTextFile(await outsideRepo(dataset, "Le jeu de données")))
  : [...CASES];
const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const selected = only ? cases.filter((c) => only.includes(c.id)) : cases;
const out = dataset
  ? await outsideRepo(arg("out") ?? "", "Le fichier de sortie")
  : new URL(`./recordings/${label}.json`, import.meta.url).pathname;

// La clé est lue par la fonction de production (mistralConfigFromEnv), jamais par ce script : elle ne peut pas finir dans un affichage.
const config: MistralConfig = {
  ...mistralConfigFromEnv(),
  modelTriage: arg("triage-model") ?? "mistral-small-latest",
  modelAnswer: arg("answer-model") ?? "mistral-medium-latest",
  modelEmbed: arg("embed-model") ?? "mistral-embed",
};
// Passerelle de production (cadence de l'offre gratuite, reprises), avec une échéance plus longue : les cas passent un par un.
const gateway = new LlmGateway(new MistralProvider(config), { queueDeadlineMs: { interactive: 120_000, background: 300_000 }, attemptTimeoutMs: { interactive: 60_000, background: 120_000 } });

// Vecteurs des fiches, calculés comme en production : le texte de la fiche, masqué, sans son titre.
async function embedFiches(fiches: readonly Fiche[]): Promise<Array<{ fiche: Fiche; vector: number[] }>> {
  if (fiches.length === 0) return [];
  const r = await gateway.embed(fiches.map((f) => redactText(f.text)), "background");
  return fiches.map((fiche, i) => ({ fiche, vector: r.vectors[i] }));
}

const seed = await loadSeedFiches();
const base = await embedFiches(seed);
const auth = await makeAuth();
const recorded: Record<string, RecordedCase> = {};
let embedModel = config.modelEmbed;
let answerModel = config.modelAnswer;
let triageModel = config.modelTriage;
let ok = 0;
console.log(`Évaluation « ${label} » : ${selected.length} cas, tri ${config.modelTriage}, réponse ${config.modelAnswer}.`);
for (const [i, c] of selected.entries()) {
  const rec: { -readonly [K in keyof RecordedCase]: RecordedCase[K] } = {};
  const extra = await embedFiches((c.kbExtra ?? []).map((f) => ({ ...f })));
  const run = await runCase(auth, c, liveBackend(gateway, [...base, ...extra], rec));
  recorded[c.id] = rec;
  if (rec.embedModel) embedModel = rec.embedModel;
  if (rec.answer?.ok) answerModel = rec.answer.model;
  if (rec.triage?.ok) triageModel = rec.triage.model;
  const s = scoreCase(c, run);
  if (s.correct) ok++;
  const flag = s.dangerPublic.length ? ` DANGER ${s.dangerPublic.join(",")}` : "";
  console.log(`${String(i + 1).padStart(3)}/${selected.length} ${c.id.padEnd(8)} ${s.correct ? "ok " : "NON"} ${run.outcome}${run.reason ? ` (${run.reason})` : ""}${flag}`);
}

const recording: Recording = {
  label,
  date: new Date().toISOString().slice(0, 10),
  models: { triage: triageModel, answer: answerModel, embed: embedModel },
  prompts: promptVersions(),
  casesHash: await casesHash(dataset ? cases : CASES),
  cases: recorded,
};
await Deno.writeTextFile(out, `${JSON.stringify(recording, null, 1)}\n`);
console.log(`${ok}/${selected.length} cas réussis. Enregistrement : ${out}`);
