#!/usr/bin/env bash
# Installe un binaire de release GitHub après vérification de son empreinte SHA-256.
# L'empreinte est écrite dans le workflow (épinglage) : si l'archive change, l'étape échoue.
# Usage : install-release.sh <url> <sha256> <fichier-dans-l-archive | -> <nom> [répertoire]
#   <fichier-dans-l-archive> = « - » pour un binaire livré seul (sans archive).
set -euo pipefail

url="${1:?url}"; sha256="${2:?sha256}"; member="${3:?fichier-dans-archive-ou-tiret}"; name="${4:?nom}"
dest="${5:-$HOME/.local/bin}"

case "$url" in https://github.com/*) ;; *) echo "URL refusée (https://github.com/ seulement) : $url" >&2; exit 2 ;; esac
[[ "$sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "Empreinte SHA-256 invalide" >&2; exit 2; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 --output "$tmp/asset" "$url"
echo "$sha256  $tmp/asset" | sha256sum --check --strict --quiet - || { echo "Empreinte différente pour $url" >&2; exit 1; }

mkdir -p "$dest"
if [ "$member" = "-" ]; then
  install -m 0755 "$tmp/asset" "$dest/$name"
else
  tar -xzf "$tmp/asset" -C "$tmp" "$member"
  install -m 0755 "$tmp/$member" "$dest/$name"
fi
echo "$dest" >> "${GITHUB_PATH:-/dev/null}"
echo "Installé : $name ($(sha256sum "$dest/$name" | cut -c1-12)…) dans $dest"
