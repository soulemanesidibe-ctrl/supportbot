#!/usr/bin/env bash
# Garde-fou sur les exceptions Semgrep : une règle de sécurité ne se désactive pas
# à la légère. Une exception `nosemgrep` est acceptée seulement si :
#   1. elle nomme la règle (jamais de `nosemgrep` nu qui coupe tout) ;
#   2. elle porte une justification : `// nosemgrep: id-de-règle -- raison` ;
#   3. elle est dans un des rares fichiers prévus pour cela (liste ci-dessous).
# Usage : scripts/check-nosemgrep.sh [racine]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

# Fichiers autorisés à porter une exception (les trois portes d'entrée uniques).
ALLOWED=(
  "supabase/functions/_shared/db.ts"
  "supabase/functions/_shared/capabilities/call.ts"
  "supabase/functions/_shared/actions/execute.ts"
)

fail=0
while IFS= read -r hit; do
  file="${hit%%:*}"
  rest="${hit#*:}"; line="${rest%%:*}"; text="${rest#*:}"

  allowed=0
  for a in "${ALLOWED[@]}"; do [ "$file" = "$a" ] && allowed=1; done
  if [ "$allowed" -eq 0 ]; then
    echo "REFUSÉ  $file:$line : exception Semgrep hors des fichiers prévus"; fail=1; continue
  fi
  if ! grep -Eq 'nosemgrep: *[a-z0-9-]+( *, *[a-z0-9-]+)* +-- +.{10,}' <<<"$text"; then
    echo "REFUSÉ  $file:$line : exception sans règle nommée ou sans justification (format : nosemgrep: id -- raison)"; fail=1
  fi
done < <(grep -rnI --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.claude --exclude-dir=.agents \
           --exclude-dir=semgrep --exclude-dir=docs --exclude-dir=scripts \
           -E '(//|#|/\*|<!--)[[:space:]]*nosem(grep)?([[:space:]:]|$)' . 2>/dev/null | sed 's#^\./##' || true)

if [ "$fail" -ne 0 ]; then echo "Exceptions Semgrep : ECHEC"; exit 1; fi
echo "Exceptions Semgrep : OK"
