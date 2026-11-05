#!/usr/bin/env bash
# Installe les hooks Git de sécurité (gitleaks à chaque commit, Semgrep avant chaque push).
# À lancer une fois après le clonage du dépôt.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v pre-commit >/dev/null; then
  echo "pre-commit n'est pas installé. Installation conseillée :"
  echo "  pipx install pre-commit        (ou : python3 -m pip install --user pre-commit)"
  exit 1
fi
if ! command -v go >/dev/null; then
  echo "Attention : Go est nécessaire pour que pre-commit compile gitleaks (https://go.dev/dl/)."
fi

pre-commit install --install-hooks
echo
echo "Hooks installés : gitleaks à chaque commit, interdiction de commiter sur main."
echo "Vérification : pre-commit run --all-files"
