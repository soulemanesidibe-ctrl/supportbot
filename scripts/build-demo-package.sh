#!/usr/bin/env bash
# Fabrique le paquet de la DÉMONSTRATION (données fictives) à déposer chez alwaysdata : écrans construits en mode démo,
# petit serveur Node sans dépendance, package.json minimal. Aucune clé, aucune donnée réelle.
# Usage : scripts/build-demo-package.sh <fichier.zip de sortie>   (pas à pas : docs/deploiement-demo-alwaysdata.md)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(realpath -m "${1:?Indiquez le fichier .zip de sortie}")"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
(cd "$ROOT/app" && npm run build:demo >/dev/null)
mkdir -p "$WORK/releve/server"
cp -r "$ROOT/app/dist" "$WORK/releve/dist"
cp "$ROOT/app/server/node.ts" "$ROOT/app/server/headers.ts" "$ROOT/app/server/session.ts" "$WORK/releve/server/"
cat > "$WORK/releve/package.json" <<'JSON'
{
  "name": "releve-demo",
  "private": true,
  "description": "Démonstration de Relève (données fictives) : écrans et petit serveur Node sans dépendance.",
  "type": "module",
  "engines": { "node": ">=22.18" }
}
JSON
cat > "$WORK/releve/LISEZMOI.txt" <<'TXT'
Démonstration de Relève : données FICTIVES, aucune clé, aucune donnée réelle.

Commande à mettre dans le site Node.js d'alwaysdata (remplacez VOTRECOMPTE par le nom de votre compte, deux fois) :
node /home/VOTRECOMPTE/releve/server/node.ts https://VOTRECOMPTE.alwaysdata.net

Version de Node.js : 22.18 ou plus (choisissez 24).
Pour la connexion du personnel dans la démo : n'importe quelle adresse, n'importe quel mot de passe, et n'importe quel code à 6 chiffres.
TXT
rm -f "$OUT"; (cd "$WORK" && zip -qr "$OUT" releve)
echo "Écrit : $OUT ($(du -h "$OUT" | cut -f1))"
