#!/usr/bin/env node
// Règle des 7 jours (menace M06) : aucune version verrouillée ne doit avoir été publiée moins de 7 jours avant le verrouillage.
// Le réglage « min-release-age » de .npmrc ne s'applique qu'à npm 11.10 ou plus ; ce contrôle le vérifie quelle que soit la
// version de npm qui a produit le fichier. Date de référence : le dernier commit qui a modifié le fichier de verrouillage, ou
// maintenant s'il a des modifications non commitées.
// Usage : node scripts/ci/lockfile-age.mjs <dossier contenant package-lock.json>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIN_DAYS = 7;
const REGISTRY = "https://registry.npmjs.org/";
const dir = process.argv[2] ?? ".";
const lockPath = join(dir, "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const dirty = git(["status", "--porcelain", "--", lockPath]) !== "";
const reference = dirty ? new Date() : new Date(git(["log", "-1", "--format=%cI", "--", lockPath]) || Date.now());

// Une entrée par couple nom@version venu du registre public (les liens locaux et les dépôts git ne sont pas concernés).
const wanted = new Map();
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path || meta.link || typeof meta.resolved !== "string" || !meta.resolved.startsWith(REGISTRY)) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  wanted.set(`${name}@${meta.version}`, { name, version: meta.version });
}

const get = globalThis.fetch;
const published = async ({ name, version }) => {
  const res = await get(REGISTRY + name.replace("/", "%2F"), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${name} : registre ${res.status}`);
  const t = (await res.json()).time?.[version];
  if (!t) throw new Error(`${name}@${version} : date de publication absente`);
  return new Date(t);
};

const entries = [...wanted.values()];
const problems = [];
for (let i = 0; i < entries.length; i += 12) {
  const batch = entries.slice(i, i + 12);
  const dates = await Promise.all(batch.map((e) => published(e).catch((err) => err)));
  batch.forEach((e, k) => {
    const d = dates[k];
    if (d instanceof Error) problems.push(`vérification impossible : ${d.message}`);
    else {
      const days = (reference.getTime() - d.getTime()) / 86_400_000;
      if (days < MIN_DAYS) problems.push(`${e.name}@${e.version} publié le ${d.toISOString().slice(0, 10)}, ${days.toFixed(1)} jour(s) avant le verrouillage`);
    }
  });
}

if (problems.length) {
  console.error(`Âge des versions verrouillées (${dir}, référence ${reference.toISOString().slice(0, 10)}) : ${problems.length} problème(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Âge des versions verrouillées (${dir}) : ${entries.length} versions, toutes publiées au moins ${MIN_DAYS} jours avant le verrouillage`);
