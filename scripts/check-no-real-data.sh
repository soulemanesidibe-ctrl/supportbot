#!/usr/bin/env bash
# Garde-fou : aucune donnée réelle de pilote dans le dépôt Git (qui est public).
# Modèle de menace : M34. Règle du projet : le dépôt ne contient que des données SYNTHÉTIQUES ;
# le jeu réel (tickets anonymisés d'un pilote) reste dans un stockage privé de la plateforme.
#
#   1. Hors zones synthétiques : aucun chemin de données de pilote, aucun format d'export
#      (tableur, boîte mail, base, dump...).
#   2. Dans les zones synthétiques : aucune adresse e-mail hors domaines réservés, aucune
#      adresse IP hors plages de documentation, aucun numéro de téléphone français.
#
# Le script n'affiche JAMAIS la valeur trouvée (les journaux de CI d'un dépôt public sont lisibles
# de tous) : seulement le fichier, la ligne et le type de donnée.
# Usage : scripts/check-no-real-data.sh [racine-du-dépôt-git]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

SYNTH_DIRS_RE='^(eval/synthetic/|supabase/seed/)'
VENDORED_RE='^(\.claude/|\.agents/)'
FORBIDDEN_PATH_RE='(^|/)(data/real|eval/real|pilot[-_]?data|donnees[-_]?reelles|donnees[-_]?pilote|private)/'
FORBIDDEN_EXT_RE='\.(csv|tsv|xlsx|xls|ods|mbox|pst|ost|eml|msg|sqlite|sqlite3|db|dump|bak|ndjson|jsonl|parquet)$|\.sql\.gz$'

fail=0
report() { echo "REFUSÉ  $1 : $2"; fail=1; }

# Fichiers de l'index (inclut ceux qui sont indexés mais pas encore commités).
mapfile -t files < <(git ls-files --cached | grep -Ev "$VENDORED_RE" || true)

for f in "${files[@]}"; do
  [ -z "$f" ] && continue
  if [[ "$f" =~ $FORBIDDEN_PATH_RE ]]; then
    report "$f" "chemin réservé aux données réelles (stockage privé de la plateforme, pas le dépôt)"
    continue
  fi
  if [[ ! "$f" =~ $SYNTH_DIRS_RE ]] && [[ "$f" =~ $FORBIDDEN_EXT_RE ]]; then
    report "$f" "format d'export de données hors des zones synthétiques (eval/synthetic/, supabase/seed/)"
  fi
done

# Contenu des zones synthétiques
for f in "${files[@]}"; do
  [ -z "$f" ] && continue
  [[ "$f" =~ $SYNTH_DIRS_RE ]] || continue
  [ -f "$f" ] || continue
  grep -Iq . "$f" 2>/dev/null || continue   # ignore les fichiers binaires

  # Adresses e-mail : seuls les domaines réservés (RFC 2606) sont admis
  while IFS=: read -r line addr; do
    [ -z "$line" ] && continue
    domain="${addr##*@}"; domain="${domain,,}"
    if ! [[ "$domain" =~ (^|\.)(example\.(com|net|org)|[a-z0-9-]+\.(test|example|invalid|localhost))$ ]]; then
      report "$f:$line" "adresse e-mail hors domaine réservé (utiliser exemple.test, client-a.test, example.com...)"
    fi
  done < <(grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" || true)

  # Adresses IPv4 : seules les plages de documentation (RFC 5737) et les adresses techniques sont admises
  while IFS=: read -r line ip; do
    [ -z "$line" ] && continue
    IFS=. read -r a b c d <<<"$ip"
    valid=1; for o in "$a" "$b" "$c" "$d"; do [ "$o" -le 255 ] 2>/dev/null || valid=0; done
    [ "$valid" -eq 1 ] || continue            # ce n'est pas une adresse (ex. numéro de version 16.0.17328.20162)
    case "$a.$b.$c" in
      192.0.2|198.51.100|203.0.113) ;;        # plages de documentation
      *) case "$ip" in 127.0.0.1|0.0.0.0|255.255.255.*) ;; *)
           report "$f:$line" "adresse IP hors plage de documentation (utiliser 192.0.2.x, 198.51.100.x, 203.0.113.x)" ;;
         esac ;;
    esac
  done < <(grep -noE '\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b' "$f" || true)

  # Numéros de téléphone français (0X XX XX XX XX, +33, 0033)
  if grep -nEq '(\+33|0033|\b0)[1-9]([ .-]?[0-9]{2}){4}\b' "$f"; then
    while IFS=: read -r line _; do
      report "$f:$line" "numéro de téléphone (le remplacer par un repère comme [TELEPHONE])"
    done < <(grep -nE '(\+33|0033|\b0)[1-9]([ .-]?[0-9]{2}){4}\b' "$f" || true)
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "Données de pilote : ECHEC (le dépôt est public : retirer ces données et les ranger dans le stockage privé)"
  exit 1
fi
echo "Données de pilote : OK (${#files[@]} fichiers examinés)"
