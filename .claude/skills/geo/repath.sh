#!/usr/bin/env bash
# Réécrit les chemins de l'upstream geo-seo-claude vers l'installation projet.
#
# L'upstream s'installe dans le répertoire personnel (global, non versionné). Ici
# les skills vivent dans le dépôt, donc chaque référence doit être relative à la
# racine du dépôt, et les appels Python passer par le wrapper `geopy` (venv isolé).
#
# Idempotent — à rejouer après chaque `/geo update`.
set -euo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
CLAUDE_DIR="$ROOT/.claude"

# Fichiers propres à ce portage : ils documentent justement l'écart de chemins,
# donc les réécrire détruirait leur contenu. UPSTREAM-README.md est conservé
# verbatim comme référence amont.
SKIP_BASENAMES="INSTALL.md UPSTREAM-README.md"

should_skip() {
    local base
    base="$(basename "$1")"
    for s in $SKIP_BASENAMES; do
        [ "$base" = "$s" ] && return 0
    done
    return 1
}

count=0
while IFS= read -r f; do
    should_skip "$f" && continue
    sed -i.bak 's|python3 ~/\.claude/skills/geo/scripts/|.claude/skills/geo/geopy .claude/skills/geo/scripts/|g' "$f"
    sed -i.bak 's|~/\.claude/|.claude/|g' "$f"
    sed -i.bak 's|python3 -c |.claude/skills/geo/geopy -c |g' "$f"
    sed -i.bak 's|python3 -m |.claude/skills/geo/geopy -m |g' "$f"
    rm -f "${f}.bak"
    count=$((count + 1))
done < <(find "$CLAUDE_DIR/skills/geo" "$CLAUDE_DIR"/skills/geo-* "$CLAUDE_DIR/agents" -name '*.md' -type f 2>/dev/null)

chmod +x "$CLAUDE_DIR/skills/geo/geopy" "$CLAUDE_DIR/skills/geo/setup.sh" "$CLAUDE_DIR/skills/geo/repath.sh" 2>/dev/null || true

echo "✓ ${count} fichier(s) markdown réécrits vers les chemins projet"

leftovers=$(grep -rln '~/\.claude/' --include=*.md \
    "$CLAUDE_DIR/skills/geo" "$CLAUDE_DIR"/skills/geo-* "$CLAUDE_DIR/agents" 2>/dev/null \
    | grep -vE '/(INSTALL|UPSTREAM-README)\.md$' || true)

if [ -n "$leftovers" ]; then
    echo "⚠ Références au chemin global restantes :" >&2
    echo "$leftovers" >&2
    exit 1
fi
