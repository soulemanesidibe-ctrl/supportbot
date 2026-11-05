#!/usr/bin/env bash
# Crée le venv isolé du skill GEO et y installe les dépendances Python.
# À rejouer après un clone frais du dépôt (le venv n'est pas versionné).
#
#   bash .claude/skills/geo/setup.sh            # dépendances seules
#   bash .claude/skills/geo/setup.sh --playwright   # + navigateur Chromium
set -euo pipefail

GEO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$GEO_DIR/.venv"
WITH_PLAYWRIGHT=false
[ "${1:-}" = "--playwright" ] && WITH_PLAYWRIGHT=true

PYTHON_CMD=""
for c in python3 python; do
    command -v "$c" >/dev/null 2>&1 && { PYTHON_CMD="$c"; break; }
done
if [ -z "$PYTHON_CMD" ]; then
    echo "✗ Python 3.8+ requis mais introuvable." >&2
    exit 1
fi
echo "→ Python : $("$PYTHON_CMD" --version)"

rm -rf "$VENV_DIR"

if command -v uv >/dev/null 2>&1; then
    echo "→ 'uv' détecté — installation rapide"
    # --seed installe pip dans le venv : sans lui, les `python -m pip` de la doc
    # upstream échouent (uv n'y met pas pip par défaut).
    uv venv "$VENV_DIR" --python "$PYTHON_CMD" --seed --quiet
    VENV_PY="$VENV_DIR/bin/python3"
    [ -x "$VENV_PY" ] || VENV_PY="$VENV_DIR/Scripts/python.exe"
    uv pip install --python "$VENV_PY" -r "$GEO_DIR/requirements.txt" --quiet
else
    if ! "$PYTHON_CMD" -m venv "$VENV_DIR" 2>/dev/null; then
        echo "✗ Création du venv impossible (module 'venv' manquant ?)." >&2
        echo "  Debian/Ubuntu : sudo apt install python3-venv" >&2
        echo "  Ou installer uv : https://docs.astral.sh/uv/" >&2
        exit 1
    fi
    VENV_PY="$VENV_DIR/bin/python3"
    [ -x "$VENV_PY" ] || VENV_PY="$VENV_DIR/Scripts/python.exe"
    "$VENV_PY" -m pip install --upgrade pip --quiet
    "$VENV_PY" -m pip install -r "$GEO_DIR/requirements.txt" --quiet
fi

chmod +x "$GEO_DIR/geopy" 2>/dev/null || true
echo "✓ Venv prêt → $VENV_DIR"

if [ "$WITH_PLAYWRIGHT" = true ]; then
    echo "→ Installation du navigateur Chromium (Playwright)..."
    if "$VENV_PY" -m playwright install chromium; then
        echo "✓ Chromium installé"
    else
        echo "⚠ Échec Playwright — les captures d'écran seront indisponibles." >&2
    fi
else
    echo "→ Captures d'écran (optionnel) : bash .claude/skills/geo/setup.sh --playwright"
fi

echo ""
echo "✓ Skill GEO opérationnel. Exemples :"
echo "    /geo quick https://exemple.fr"
echo "    /geo audit https://exemple.fr"
