// Évaluation RÉELLE : fait passer chaque cas dans l'orchestrateur avec le vrai modèle Mistral et ENREGISTRE ses sorties.
//
//   deno run --allow-net=api.mistral.ai --allow-env=MISTRAL_API_KEY,MISTRAL_BASE_URL,MISTRAL_MODEL_TRIAGE,MISTRAL_MODEL_ANSWER,MISTRAL_MODEL_EMBED \
//     --allow-read=../seed,_eval --allow-write=_eval/recordings \
//     _eval/run.ts --label small --answer-model mistral-small-latest
//
// Sans clé, chez OVHcloud (hébergeur français), accès anonyme limité à 2 requêtes par minute et par modèle (données synthétiques
// seulement) :
//   deno run --allow-net=oai.endpoints.kepler.ai.cloud.ovh.net --allow-read=../seed,_eval --allow-write=_eval/recordings \
//     _eval/run.ts --provider ovh --label ovh-small
// Avec une clé de projet OVHcloud rangée dans les secrets réseau de l'environnement (le relais l'ajoute lui-même aux requêtes vers
// OVHcloud ; ce script ne la lit ni ne la voit jamais) : ajouter --ovh-key proxy. Débit : 400 requêtes par minute et par modèle.
//
// Options : --provider (mistral par défaut, ou ovh), --label (nom de l'enregistrement), --answer-model, --triage-model (défaut mistral-small-latest), --embed-model
// (défaut mistral-embed), --only id1,id2 (quelques cas), --dataset <fichier.json HORS du dépôt> et --out <fichier HORS du dépôt>
// pour un jeu réel anonymisé. Un jeu réel ne doit JAMAIS entrer dans le dépôt : la commande refuse un chemin qui s'y trouve.
// La clé n'est jamais écrite ni affichée ; elle n'est lue que dans MISTRAL_API_KEY.
import { makeAuth } from "../_shared/testing.ts";
import { LlmGateway } from "../_shared/llm/gateway.ts";
import { MistralConfig, mistralConfigFromEnv, MistralProvider } from "../_shared/llm/mistral.ts";
import { ovhConfig, OvhProvider } from "../_shared/llm/ovh.ts";
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

const provider = arg("provider") ?? "mistral";
if (provider !== "mistral" && provider !== "ovh") {
  console.error("--provider : mistral ou ovh.");
  Deno.exit(2);
}
// Mistral : la clé est lue par la fonction de production (mistralConfigFromEnv), jamais par ce script : elle ne peut pas finir dans
// un affichage. OVHcloud : accès anonyme, sans clé.
// « --ovh-key proxy » : la clé est injectée par le relais réseau de l'environnement. On envoie un jeton FACTICE, remplacé en route ;
// sans secret enregistré côté relais, OVHcloud répond 401 et l'évaluation s'arrête aussitôt (rien n'est inventé).
const ovhKeyed = provider === "ovh" && arg("ovh-key") === "proxy";
if (provider === "ovh" && arg("ovh-key") !== undefined && !ovhKeyed) {
  console.error("--ovh-key : seule la valeur « proxy » est acceptée (la clé ne se passe jamais en argument).");
  Deno.exit(2);
}
const config: MistralConfig = provider === "ovh"
  ? ovhConfig({ apiKey: ovhKeyed ? "jeton-factice-remplace-par-le-relais" : "", triage: arg("triage-model"), answer: arg("answer-model"), embed: arg("embed-model") })
  : {
    ...mistralConfigFromEnv(),
    modelTriage: arg("triage-model") ?? "mistral-small-latest",
    modelAnswer: arg("answer-model") ?? "mistral-medium-latest",
    modelEmbed: arg("embed-model") ?? "mistral-embed",
  };
const llm = provider === "ovh" ? new OvhProvider(config) : new MistralProvider(config);
// Passerelle de production (reprises, disjoncteur), avec des échéances longues : les cas passent un par un. Chez OVHcloud en
// anonyme, 2 requêtes par minute et par modèle : une passerelle par modèle, un appel toutes les 31 secondes.
const slow = provider === "ovh" && !ovhKeyed;
const opts = {
  minIntervalMs: slow ? 31_000 : 1_100,
  maxConcurrent: 1,
  queueDeadlineMs: { interactive: slow ? 900_000 : 120_000, background: slow ? 900_000 : 300_000 },
  attemptTimeoutMs: { interactive: 90_000, background: 120_000 },
  backoffBaseMs: slow ? 31_000 : 1_000,
  backoffCapMs: slow ? 120_000 : 30_000,
};
const chatGateway = new LlmGateway(llm, opts);
const embedGateway = slow ? new LlmGateway(llm, opts) : chatGateway;
const gateway = {
  complete: (req: Parameters<LlmGateway["complete"]>[0]) => chatGateway.complete(req),
  embed: (texts: readonly string[], priority?: "interactive" | "background") => embedGateway.embed(texts, priority),
};

// Vecteurs des fiches, calculés comme en production : le texte de la fiche, masqué, sans son titre.
async function embedFiches(fiches: readonly Fiche[]): Promise<Array<{ fiche: Fiche; vector: number[] }>> {
  if (fiches.length === 0) return [];
  const r = await gateway.embed(fiches.map((f) => redactText(f.text)), "background");
  return fiches.map((fiche, i) => ({ fiche, vector: r.vectors[i] }));
}

const seed = await loadSeedFiches();
const base = await embedFiches(seed);
const auth = await makeAuth();
// Reprise : un enregistrement partiel du même nom, fait avec les mêmes prompts et le même jeu de cas, est complété (les cas déjà
// enregistrés ne sont pas rejoués). L'enregistrement est réécrit après chaque cas : une interruption ne perd rien.
const hash = await casesHash(dataset ? cases : CASES);
const recorded: Record<string, RecordedCase> = {};
try {
  const prev = JSON.parse(await Deno.readTextFile(out)) as Recording;
  if (prev.label === label && prev.casesHash === hash && JSON.stringify(prev.prompts) === JSON.stringify(promptVersions())) {
    Object.assign(recorded, prev.cases);
    console.log(`Reprise : ${Object.keys(recorded).length} cas déjà enregistrés.`);
  }
} catch {
  // pas d'enregistrement précédent
}
let embedModel = config.modelEmbed;
let answerModel = config.modelAnswer;
let triageModel = config.modelTriage;
let ok = 0;
console.log(`Évaluation « ${label} » (${provider}) : ${selected.length} cas, tri ${config.modelTriage}, réponse ${config.modelAnswer}, vecteurs ${config.modelEmbed}.`);
const save = async () => {
  const recording: Recording = {
    label,
    date: new Date().toISOString().slice(0, 10),
    models: { triage: triageModel, answer: answerModel, embed: embedModel },
    prompts: promptVersions(),
    casesHash: hash,
    cases: recorded,
  };
  await Deno.writeTextFile(`${out}.tmp`, `${JSON.stringify(recording, null, 1)}\n`);
  await Deno.rename(`${out}.tmp`, out);
};
for (const [i, c] of selected.entries()) {
  if (recorded[c.id]) continue;
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
  await save();
}

await save();
console.log(`${ok} cas réussis parmi ceux passés dans cette exécution. Enregistrement : ${out} (${Object.keys(recorded).length} cas).`);
