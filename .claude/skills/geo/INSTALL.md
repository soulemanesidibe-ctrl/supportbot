# GEO-SEO — installation dans SupportBot

Portage de [`zubair-trabzada/geo-seo-claude`](https://github.com/zubair-trabzada/geo-seo-claude)
(MIT) en **skill projet** plutôt qu'en skill global.

## Pourquoi pas l'installeur upstream

`install.sh` écrit dans le `.claude` du répertoire personnel, qui n'est ni versionné
ni partagé entre machines — et qui disparaît avec les conteneurs éphémères de Claude Code web.
Ici tout est committé dans le dépôt : le skill suit le repo, fonctionne pour tous
les collaborateurs et sur toutes les surfaces (CLI Windows, web, CI).

## Ce qui est installé

| Composant | Emplacement |
|---|---|
| Skill principal | `.claude/skills/geo/SKILL.md` |
| 15 sous-skills | `.claude/skills/geo-*/` |
| 5 sous-agents | `.claude/agents/geo-*.md` |
| Scripts Python | `.claude/skills/geo/scripts/` |
| Templates JSON-LD | `.claude/skills/geo/schema/` |
| Templates rapport PDF | `.claude/skills/geo/templates/` |
| Doc upstream | `.claude/skills/geo/docs/` · `UPSTREAM-README.md` |
| White-label | `.claude/skills/geo/white-label/` |

## Setup après un clone

Le venv Python n'est pas versionné. Une seule commande le recrée :

```bash
bash .claude/skills/geo/setup.sh
# + navigateur pour les captures d'écran (optionnel, ~150 Mo)
bash .claude/skills/geo/setup.sh --playwright
```

Fonctionne sous Linux, macOS et Windows via **Git Bash** (pas PowerShell/CMD).
Utilise `uv` s'il est présent, sinon `python -m venv` + `pip`.

## Écarts volontaires vs upstream

1. **Chemins projet** — toutes les références au `.claude` du répertoire personnel
   sont réécrites en `.claude/…`, relatives à la racine du dépôt.
2. **Wrapper `geopy`** — les appels Python passent par `.claude/skills/geo/geopy`,
   qui résout l'interpréteur du venv (`bin/python3` sous Unix,
   `Scripts/python.exe` sous Windows) et retombe sur le `python3` système si le
   venv n'existe pas. L'upstream réécrit des shebangs en chemin absolu, ce qui
   casse dès qu'on change de machine — inutilisable pour un fichier versionné.
3. **`repath.sh`** — rejoue la réécriture des chemins ; idempotent, à lancer après
   chaque `/geo update` (le skill `geo-update` le rappelle dans son étape 4b).
4. **`setup.sh` remplace `install.sh`** — pas de copie de fichiers, seulement le venv.
   `uv venv` est appelé avec `--seed` pour que `pip` existe dans le venv.

## Commandes

```
/geo audit <url>        Audit GEO + SEO complet (5 sous-agents en parallèle)
/geo quick <url>        Snapshot visibilité IA en 60 s
/geo citability <url>   Score de citabilité IA d'une page
/geo crawlers <url>     Accès des crawlers IA (robots.txt)
/geo llmstxt <url>      Analyse ou génère llms.txt
/geo brands <url>       Mentions de marque sur les plateformes citées par les IA
/geo platforms <url>    Optimisation par plateforme (ChatGPT, Perplexity, AIO)
/geo schema <url>       Données structurées JSON-LD
/geo technical <url>    Audit SEO technique
/geo content <url>      Qualité de contenu & E-E-A-T
/geo report <url>       Rapport client en markdown
/geo report-pdf         Rapport PDF (nécessite pandoc + Chrome)
/geo prospect <cmd>     CRM-lite prospects
/geo proposal <domain>  Proposition commerciale
/geo compare <domain>   Delta mensuel entre deux audits
/geo update             Met à jour depuis l'upstream
```

## Limites connues

- **`/geo report-pdf`** exige `pandoc` et Chrome/Chromium. Le SKILL.md upstream
  code en dur le chemin macOS de Chrome — à adapter sous Windows/Linux.
- **`scripts/generate_pdf_report.py`**, cité dans le README upstream, n'existe pas
  dans le dépôt source. Le chemin PDF réel est pandoc + Chrome headless.
- **`/geo prospect|proposal|compare`** écrivent hors du dépôt, dans `~/.geo-prospects/`.
- Les chiffres de marché du SKILL.md sont ceux de l'upstream (début 2026) —
  les revérifier avant de les reprendre dans un livrable client.

## Données runtime

`~/.geo-prospects/` (prospects, propositions, rapports mensuels) n'est pas versionné
et n'est pas supprimé par une désinstallation.

## Désinstaller

```bash
rm -rf .claude/skills/geo .claude/skills/geo-* .claude/agents/geo-*.md
```
