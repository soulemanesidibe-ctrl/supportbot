#!/usr/bin/env bash
# Test de mutation : on CASSE volontairement une défense dans une copie des migrations et on vérifie que les tests le voient,
# et que c'est le BON test qui le voit. Un test qui n'a jamais échoué ne prouve rien.
#   1. le témoin (copie non modifiée) DOIT passer ; sinon le banc lui-même est cassé et rien ne prouve rien ;
#   2. chaque mutation DOIT faire échouer le test nommé dans « expect ».
# Usage : supabase/tests/mutations.sh        (durée : environ 10 s par mutation)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"; chmod 755 "$WORK"     # lisible par l'utilisateur « postgres » (le banc se relance sous ce compte)
trap 'rm -rf "$WORK"' EXIT

copy() { rm -rf "$1" && mkdir -p "$1" && cp -r "$ROOT/supabase" "$1/supabase" && chmod -R a+rwX "$1"; }

echo "== témoin"
copy "$WORK/ctl"
if ! out="$(bash "$WORK/ctl/supabase/tests/run.sh" 2>&1)"; then echo "$out" | tail -5; echo "TÉMOIN EN ÉCHEC : le banc est cassé, les mutations ne prouveraient rien."; exit 2; fi
echo "$out" | tail -1

python3 -I - "$ROOT" "$WORK" <<'PY'
import json, os, re, subprocess, sys
root, work = sys.argv[1], sys.argv[2]
muts = json.load(open(os.path.join(root, 'supabase/tests/mutations.json'), encoding='utf-8'))
bad = 0
for i, m in enumerate(muts, 1):
    d = os.path.join(work, f'm{i}')
    subprocess.run(['rm', '-rf', d]); os.makedirs(d)
    subprocess.run(['cp', '-r', os.path.join(root, 'supabase'), os.path.join(d, 'supabase')], check=True)
    path = os.path.join(d, 'supabase/migrations', m['file'])
    src = open(path, encoding='utf-8').read()
    for old, new in m['edits']:
        if old not in src:
            print(f"mutation {i:2d} ({m['label']}) : MOTIF INTROUVABLE, mutation invalide"); bad += 1; break
        src = src.replace(old, new, 1)
    else:
        open(path, 'w', encoding='utf-8').write(src)
        subprocess.run(['chmod', '-R', 'a+rwX', d])
        r = subprocess.run(['bash', os.path.join(d, 'supabase/tests/run.sh')], capture_output=True, text=True)
        found = re.findall(r'ECHEC : (.*)', r.stdout + r.stderr)
        if r.returncode == 0:
            print(f"mutation {i:2d} ({m['label']}) : NON DÉTECTÉE ✘"); bad += 1
        elif not found:
            print(f"mutation {i:2d} ({m['label']}) : le banc plante sans test nommé ✘"); bad += 1
        elif m['expect'] not in found[0]:
            print(f"mutation {i:2d} ({m['label']}) : détectée par un AUTRE test ({found[0][:60]}), attendu « {m['expect']} » ✘"); bad += 1
        else:
            print(f"mutation {i:2d} ({m['label']}) : détectée par « {found[0][:70]} » ✔")
print(f"\n{len(muts) - bad}/{len(muts)} mutations détectées par le bon test")
sys.exit(1 if bad else 0)
PY
