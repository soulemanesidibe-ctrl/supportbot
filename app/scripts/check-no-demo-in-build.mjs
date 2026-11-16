// Vérifie qu'un paquet de PRODUCTION ne contient aucune donnée fictive du mode démo (src/lib/api/demo.ts) : construit sans
// VITE_RELEVE_DEMO, le code de démonstration doit avoir disparu. Lancé par la CI après « npm run build ».
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MARKERS = ["c-imprimante", "Écran qui scintille", "createDemoWidgetApi", "camille.martin", "Démonstration de Relève"];
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|css|json)$/.test(f)) files.push(p);
  }
};
walk("dist");
const hits = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of MARKERS) if (s.includes(m)) hits.push(`${f} : « ${m} »`);
}
if (hits.length) {
  console.error("Données de démonstration trouvées dans le paquet de production :\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`Paquet de production : aucune donnée de démonstration (${files.length} fichiers vérifiés).`);
