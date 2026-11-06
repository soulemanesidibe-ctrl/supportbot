#!/usr/bin/env bash
# Teste les migrations et le script d'isolation sur un Postgres JETABLE (jamais sur un projet Supabase).
#   scripts : supabase/tests/harness/*.sql (imitation de Supabase) → migrations → seed → tests/*.sql
# Variables : PGBIN (dossier des binaires Postgres), KEEP=1 pour garder le cluster après coup.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "Binaires Postgres introuvables (variable PGBIN)"; exit 2; }

# Postgres refuse de tourner en root : on se relance sous l'utilisateur « postgres ».
if [ "$(id -u)" -eq 0 ]; then
  exec su postgres -s /bin/bash -c "PGBIN='$PGBIN' KEEP='${KEEP:-}' '$ROOT/supabase/tests/run.sh'"
fi

WORK="$(mktemp -d)"; PORT=54329
cleanup() { [ -n "${KEEP:-}" ] || { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --no-locale >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses='' -c unix_socket_directories=$WORK -c fsync=off" -l "$WORK/log" -w start >/dev/null
psql_() { "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql_ -d postgres -c "create database releve_test" >/dev/null
run_dir() { # $1 = libellé, $2 = glob
  for f in $2; do [ -e "$f" ] || continue; echo "-- $1 : $(basename "$f")"; psql_ -d releve_test -f "$f" >/dev/null; done
}
run_dir "banc d'essai" "$ROOT/supabase/tests/harness/*.sql"
run_dir "migration"    "$ROOT/supabase/migrations/*.sql"
run_dir "données de démonstration" "$ROOT/supabase/seed/*.sql"
echo "== tests"
fail=0
for f in "$ROOT"/supabase/tests/*.sql; do
  [ -e "$f" ] || continue
  echo "-- $(basename "$f")"
  if ! psql_ -d releve_test -o /dev/null -f "$f" 2>&1 | sed -E 's#^psql:[^ ]+ ##; s#^NOTICE:  ##; s#^#   #' | tee -a "$WORK/out.txt"; then fail=1; fi
done
n_ok=$(grep -c '^   ok ' "$WORK/out.txt" || true)
[ "$fail" -eq 0 ] && echo "Base de données : tests OK ($n_ok vérifications)" || { echo "Base de données : tests EN ECHEC"; exit 1; }
