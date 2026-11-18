#!/usr/bin/env node
// Porte npm audit de la CI : échoue sur tout avis de sévérité haute ou critique, sauf une exception de
// security/npm-audit-exceptions.json qui est encore valide ET dont le paquet est absent de l'arbre de production.
// Usage : node scripts/ci/npm-audit-gate.mjs <dossier contenant package-lock.json>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] ?? ".";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { exceptions } = JSON.parse(readFileSync(join(root, "security", "npm-audit-exceptions.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);

// npm audit sort en code 1 dès qu'il trouve une faille : on lit sa sortie JSON dans tous les cas.
const run = (args) => {
  try {
    return execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (typeof e.stdout === "string" && e.stdout.trim().startsWith("{")) return e.stdout;
    throw e;
  }
};
const audit = JSON.parse(run(["audit", "--json", "--prefix", dir]));

const advisories = new Map();
for (const [name, v] of Object.entries(audit.vulnerabilities ?? {})) {
  for (const via of v.via ?? []) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
    const id = String(via.url ?? "").split("/").pop();
    advisories.set(`${id}|${name}`, { id, name, title: via.title, severity: via.severity });
  }
}

// Deux lectures indépendantes, la plus prudente l'emporte : l'arbre installé sans les dépendances de développement, et le
// fichier de verrouillage, où chaque copie du paquet doit porter « dev: true » (devOptional compte comme production).
const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
const inProduction = (pkg) => {
  const tree = JSON.parse(run(["ls", "--omit=dev", "--all", "--json", "--prefix", dir, pkg]) || "{}");
  if (Object.keys(tree.dependencies ?? {}).length > 0) return true;
  const copies = Object.entries(lock.packages ?? {}).filter(([path]) => path === `node_modules/${pkg}` || path.endsWith(`/node_modules/${pkg}`));
  return copies.length === 0 || copies.some(([, meta]) => meta.dev !== true);
};

const blocking = [];
for (const a of advisories.values()) {
  const ex = exceptions.find((x) => x.id === a.id && x.package === a.name);
  if (!ex) blocking.push(`${a.severity} ${a.name} ${a.id} : ${a.title}`);
  else if (ex.expires < today) blocking.push(`exception expirée le ${ex.expires} : ${a.name} ${a.id}`);
  else if (inProduction(a.name)) blocking.push(`exception refusée, ${a.name} est dans l'arbre de production : ${a.id}`);
  else console.log(`exception admise jusqu'au ${ex.expires} : ${a.name} ${a.id} (${a.title})`);
}

if (blocking.length) {
  console.error(`npm audit (${dir}) : ${blocking.length} avis bloquant(s)\n- ${blocking.join("\n- ")}`);
  process.exit(1);
}
console.log(`npm audit (${dir}) : aucun avis bloquant`);
