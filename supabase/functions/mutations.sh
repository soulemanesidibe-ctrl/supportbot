#!/usr/bin/env bash
# Test de mutation des Edge Functions : on CASSE volontairement une défense dans une copie du code et on vérifie que le BON test échoue.
# Un test qui n'a jamais échoué ne prouve rien. Même principe que supabase/tests/mutations.sh (base de données).
#   1. le témoin (copie non modifiée) DOIT passer ;
#   2. chaque mutation DOIT faire échouer un test dont le nom contient « expect ».
# Usage : supabase/functions/mutations.sh        (ONLY=3,7 pour n'en rejouer que quelques-unes ; nécessite « deno » dans le PATH)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v deno >/dev/null || { echo "deno introuvable dans le PATH"; exit 2; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

echo "== témoin"
cp -r "$ROOT/supabase/functions" "$WORK/ctl"
if ! (cd "$WORK/ctl" && deno test --no-prompt --no-check --allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,CRON_SECRET,RELEVE_ALLOW_DEMO_CONNECTOR,CONNECTOR_ALLOWED_HOST_SUFFIXES,MS_APP_CLIENT_ID,MS_APP_CLIENT_SECRET >/dev/null 2>&1); then
  echo "TÉMOIN EN ÉCHEC : le banc est cassé, les mutations ne prouveraient rien."; exit 2
fi
echo "témoin : tests OK"

python3 -I - "$ROOT" "$WORK" <<'PY'
import json, os, re, shutil, subprocess, sys
root, work = sys.argv[1], sys.argv[2]
muts = json.load(open(os.path.join(root, 'supabase/functions/mutations.json'), encoding='utf-8'))
only = {x for x in os.environ.get('ONLY', '').split(',') if x}
ansi = re.compile(r'\x1b\[[0-9;]*m')
bad, ran = 0, 0
for i, m in enumerate(muts, 1):
    if only and str(i) not in only:
        continue
    ran += 1
    d = os.path.join(work, f'm{i}')
    shutil.copytree(os.path.join(root, 'supabase/functions'), d)
    path = os.path.join(d, m['file'])
    src = open(path, encoding='utf-8').read()
    invalid = False
    for old, new in m['edits']:
        if src.count(old) != 1:
            print(f"mutation {i:2d} ({m['label']}) : MOTIF {'INTROUVABLE' if src.count(old) == 0 else 'AMBIGU'}, mutation invalide ✘"); bad += 1; invalid = True; break
        src = src.replace(old, new, 1)
    if invalid:
        continue
    open(path, 'w', encoding='utf-8').write(src)
    r = subprocess.run(['deno', 'test', '--no-prompt', '--no-check', '--allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,CRON_SECRET,RELEVE_ALLOW_DEMO_CONNECTOR,CONNECTOR_ALLOWED_HOST_SUFFIXES,MS_APP_CLIENT_ID,MS_APP_CLIENT_SECRET'],
                       cwd=d, capture_output=True, text=True)
    out = ansi.sub('', r.stdout + r.stderr)
    failed = re.findall(r'^(.*?) \.\.\. FAILED', out, re.M)
    if r.returncode == 0:
        print(f"mutation {i:2d} ({m['label']}) : NON DÉTECTÉE ✘"); bad += 1
    elif not any(m['expect'] in f for f in failed):
        print(f"mutation {i:2d} ({m['label']}) : détectée par un AUTRE test ({(failed or ['plantage'])[0][:60]}), attendu « {m['expect']} » ✘"); bad += 1
    else:
        hit = next(f for f in failed if m['expect'] in f)
        print(f"mutation {i:2d} ({m['label']}) : détectée par « {hit[:70]} » ✔")
print(f"\n{ran - bad}/{ran} mutations détectées par le bon test")
sys.exit(1 if bad else 0)
PY
