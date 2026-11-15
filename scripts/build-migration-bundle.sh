#!/usr/bin/env bash
# Assemble TOUTES les migrations en un seul fichier à coller dans « SQL Editor » de Supabase :
#   supabase/bundle/appliquer-les-migrations.sql
# Pourquoi : appliquer onze fichiers à la main est long et fait se tromper d'ordre. Le fichier est une simple concaténation,
# dans l'ordre des noms, entre « begin » et « commit » : si une instruction échoue, RIEN n'est appliqué (retour arrière complet).
# La source de vérité reste supabase/migrations/ ; le fichier est régénéré par ce script et vérifié en CI.
# Usage : scripts/build-migration-bundle.sh [--check]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/supabase/bundle/appliquer-les-migrations.sql"

build() {
  local n; n="$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')"
  echo "-- Relève IA : application des $n migrations en une seule fois. GÉNÉRÉ par scripts/build-migration-bundle.sh : ne pas modifier à la main."
  echo "-- Mode d'emploi : tableau de bord Supabase, « SQL Editor », « New query », collez TOUT ce fichier, puis « Run »."
  echo "-- À faire UNE fois, sur un projet VIDE. Résultat attendu : « Success. No rows returned »."
  echo "-- Tout est dans une seule transaction : en cas d'erreur, rien n'est appliqué ; copiez le message d'erreur (sans clé ni mot de passe)."
  echo "-- Ne contient ni la graine de démonstration ni les tests."
  echo
  echo "begin;"
  for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
    echo
    echo "-- ===================================================================================================="
    echo "-- $(basename "$f")"
    echo "-- ===================================================================================================="
    cat "$f"
    echo
  done
  echo "commit;"
}

if [ "${1:-}" = "--check" ]; then
  if ! diff -q <(build) "$OUT" >/dev/null 2>&1; then
    echo "supabase/bundle/appliquer-les-migrations.sql n'est pas à jour : lancez scripts/build-migration-bundle.sh"; exit 1
  fi
  echo "Fichier d'application des migrations : à jour"; exit 0
fi
build > "$OUT"
echo "Écrit : supabase/bundle/appliquer-les-migrations.sql ($(wc -l < "$OUT") lignes, $(wc -c < "$OUT") octets)"
