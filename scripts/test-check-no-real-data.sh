#!/usr/bin/env bash
# Teste scripts/check-no-real-data.sh sur des dépôts jetables : chaque cas doit réussir ou échouer comme prévu.
# Aucune vraie donnée : les valeurs sont fabriquées ici et ne servent qu'à ce test.
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-no-real-data.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0

# case <nom> <attendu : 0|1> <chemin> <contenu>
run_case() {
  local name="$1" expect="$2" path="$3" content="$4" repo="$TMP/$RANDOM$RANDOM"
  mkdir -p "$repo"; git -C "$repo" init -q
  mkdir -p "$repo/$(dirname "$path")"; printf '%s\n' "$content" > "$repo/$path"
  git -C "$repo" add -A
  set +e; out="$("$SCRIPT" "$repo" 2>&1)"; code=$?; set -e
  if [ "$code" -eq "$expect" ]; then echo "ok   $name"; else echo "ECHEC $name (code $code, attendu $expect)"; echo "$out" | sed 's/^/     /'; fail=1; fi
  # La valeur détectée ne doit jamais apparaître dans la sortie (journaux de CI publics)
  if [ "$expect" -eq 1 ] && grep -qE 'dupont|10\.1\.2\.3|06 12 34 56 78' <<<"$out"; then echo "ECHEC $name : la sortie révèle la valeur détectée"; fail=1; fi
}

run_case "jeu synthétique propre"                 0 "eval/synthetic/t.jsonl" '{"from":"salarie@exemple.test","ip":"192.0.2.10","tel":"[TELEPHONE]","note":"Outlook 16.0.17328.20162"}'
run_case "documentation avec e-mail (non scannée)" 0 "docs/note.md"           'contact : dupont@societe.fr'
run_case "skill tiers avec csv (ignoré)"          0 ".claude/skills/x/data.csv" 'a,b'
run_case "chemin de données réelles"              1 "data/real/tickets.txt"   'x'
run_case "export csv hors zone synthétique"       1 "export.csv"              'a,b'
run_case "boîte mail hors zone synthétique"       1 "archive/box.mbox"        'From x'
run_case "e-mail réel en zone synthétique"        1 "eval/synthetic/t.jsonl"  '{"from":"dupont@societe.fr"}'
run_case "IP interne réelle en zone synthétique"  1 "eval/synthetic/t.jsonl"  '{"host":"10.1.2.3"}'
run_case "téléphone en zone synthétique"          1 "supabase/seed/s.sql"     "insert into t values ('06 12 34 56 78');"

[ "$fail" -eq 0 ] && echo && echo "Garde-fou données de pilote : tests OK" || { echo; echo "Garde-fou données de pilote : tests EN ECHEC"; exit 1; }
