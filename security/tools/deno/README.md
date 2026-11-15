# Verrou de l'exécutable Deno (CI)

Ce dossier ne contient **aucun code** : seulement `package.json` et `package-lock.json`, qui épinglent l'exécutable Deno utilisé pour tester les Edge Functions, avec l'empreinte (SHA-512) de chaque paquet. La CI l'installe par `npm ci --ignore-scripts` : une archive modifiée fait échouer l'étape.

Pour changer de version : modifier `package.json`, lancer `npm install --ignore-scripts --package-lock-only` dans ce dossier, relire le diff du verrou, puis laisser la CI valider. Dependabot propose la mise à jour chaque semaine, avec un délai de 7 jours avant d'adopter une version toute fraîche.

Les dépendances **des fonctions elles-mêmes** (`@supabase/supabase-js`) sont épinglées par `supabase/functions/deno.json` et `supabase/functions/deno.lock` ; la CI les exécute avec `--frozen` (le verrou ne peut pas changer en silence).
