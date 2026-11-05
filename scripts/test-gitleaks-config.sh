#!/usr/bin/env bash
# Teste la configuration gitleaks du projet (.gitleaks.toml) :
#   1. chaque règle propre au projet détecte un faux secret ;
#   2. les règles par défaut détectent toujours un vrai type de secret dans les
#      répertoires tiers autorisés (la liste d'autorisation ne masque pas tout) ;
#   3. les exemples génériques des skills tiers ne déclenchent pas d'alerte ;
#   4. les valeurs inoffensives (clé publique, URL locale, variable d'environnement) passent.
# Les faux secrets sont fabriqués à l'exécution, dans un répertoire temporaire hors
# du dépôt : aucun faux secret n'est versionné.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITLEAKS="${GITLEAKS:-gitleaks}"
CONFIG="$ROOT/.gitleaks.toml"
command -v "$GITLEAKS" >/dev/null || { echo "gitleaks introuvable (variable GITLEAKS)"; exit 2; }
command -v jq >/dev/null || { echo "jq introuvable"; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rand() { head -c 4096 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }
rand_b32() { head -c 4096 /dev/urandom | base32 -w0 | tr -dc 'A-Z2-7' | cut -c1-"$1"; }
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }

HEADER="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"
PAYLOAD="$(printf '%s' '{"iss":"supabase","ref":"abcdefghijklmnop","role":"service_role","iat":1700000000,"exp":2000000000}' | b64url)"

mkdir -p "$TMP/src" "$TMP/.claude/skills/demo" "$TMP/benign"

# 1. Faux secrets du projet
{
  printf 'const k = "sb_secret_%s";\n' "$(rand 30)"
  printf 'const jwt = "%s.%s.%s";\n' "$HEADER" "$PAYLOAD" "$(rand 43)"
  printf 'const db = "postgresql://postgres.abcdefgh:%s@aws-0-eu-west-3.pooler.supabase.com:6543/postgres";\n' "$(rand 18)"
  printf 'MISTRAL_API_KEY=%s\n' "$(rand 32)"
  printf 'const glpiToken = "%s";\n' "$(rand 28)"
} > "$TMP/src/leaks.ts"

# 2. Vrai type de secret dans un répertoire tiers autorisé (doit rester détecté)
printf 'aws_access_key_id = AKIA%s\naws_secret_access_key = %s\n' "$(rand_b32 16)" "$(rand 40)" \
  > "$TMP/.claude/skills/demo/SKILL.md"

# 3. Exemple générique d'un skill tiers (ne doit PAS être détecté)
printf 'curl -H "Authorization: Bearer %s" https://target.example/api\n' "$(rand 40)" \
  > "$TMP/.claude/skills/demo/EXAMPLE.md"

# 4. Valeurs inoffensives (ne doivent PAS être détectées)
{
  echo 'SUPABASE_URL=https://abcdefghijklmnop.supabase.co'
  printf 'SUPABASE_PUBLISHABLE_KEY=sb_publishable_%s\n' "$(rand 30)"
  echo 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  echo 'MISTRAL_API_KEY=${MISTRAL_API_KEY}'
  echo 'const key = Deno.env.get("MISTRAL_API_KEY");'
} > "$TMP/benign/.env.example"

(cd "$TMP" && "$GITLEAKS" dir . --config "$CONFIG" --no-banner --redact \
  --report-format json --report-path "$TMP/report.json" --exit-code 0 >/dev/null 2>&1)

fail=0
detected() { # $1 = id de règle, $2 = fragment de chemin
  jq -e --arg r "$1" --arg f "$2" 'any(.[]; .RuleID == $r and (.File | contains($f)))' "$TMP/report.json" >/dev/null
}
expect() {
  if detected "$1" "$2"; then echo "ok   détecté : $1 ($2)"; else echo "ECHEC non détecté : $1 ($2)"; fail=1; fi
}
expect_absent() {
  if jq -e --arg f "$2" 'any(.[]; (.File | contains($f)))' "$TMP/report.json" >/dev/null; then
    echo "ECHEC faux positif : $1 ($2)"; jq -r --arg f "$2" '.[] | select(.File|contains($f)) | "   règle \(.RuleID) ligne \(.StartLine)"' "$TMP/report.json"; fail=1
  else echo "ok   ignoré  : $1 ($2)"; fi
}

expect supabase-secret-key src/leaks.ts
expect supabase-service-role-jwt src/leaks.ts
expect postgres-connection-string-with-password src/leaks.ts
expect mistral-api-key src/leaks.ts
expect connector-credential-assignment src/leaks.ts
expect aws-access-token .claude/skills/demo/SKILL.md
expect_absent "exemple générique d'un skill tiers" .claude/skills/demo/EXAMPLE.md
expect_absent "valeurs inoffensives" benign/.env.example

if [ "$fail" -ne 0 ]; then echo; echo "Configuration gitleaks : ECHEC"; exit 1; fi
echo; echo "Configuration gitleaks : OK"
