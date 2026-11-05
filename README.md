# SupportBot (nom de travail, proposition de marque : **Relève**)

La relève IA du support informatique : un agent de niveau 1 qui prend la garde quand les techniciens d'une ESN ou d'une DSI sont absents (congés, nuits, arrêts, postes vacants), traite les demandes simples, prépare les tickets complexes et **rend la main avec un rapport de passation**. Il ne remplace pas l'humain : il garantit la continuité du service.

## Dossier stratégique

| Document | Contenu |
|---|---|
| [01 · Marché, concurrence et verdict](docs/01-marche-concurrence-verdict.md) | Est-ce cohérent ? Le marché est-il saturé ? Les risques |
| [02 · Différenciation et modèle économique](docs/02-differenciation-et-modele.md) | Les 7 différences, la grille de prix, l'économie unitaire |
| [03 · Go-to-market](docs/03-go-to-market.md) | Les cibles par priorité, le plan en 3 temps, les financements |
| [04 · Marque et DA](docs/04-marque-et-DA.md) | Nom, plateforme de marque, palette, typographie |
| [05 · Architecture technique et MVP](docs/05-architecture-technique-mvp.md) | Pile à moindre coût, feuille de route, règles de sécurité |
| [06 · Synergies avec EchoBridge](docs/06-synergies-echobridge.md) | Ce qui se mutualise, l'offre commune, la question du temps du fondateur |
| [07 · Intégrations](docs/07-integrations.md) | Ticketing, Microsoft 365, RMM, prise en main à distance, supervision |
| [08 · Expérience premium](docs/08-experience-ux-premium.md) | Chat, console technicien, qualité perçue |
| [09 · Sécurité](docs/09-securite.md) | Modèle de menace, défenses par couche, skills de sécurité, calendrier |
| [10 · Rôles et tableaux de bord](docs/10-roles-administration-cockpits.md) | Super administrateur, ESN multi-clients, accès délégués, tableau de bord de chaque rôle |
| [Sources](docs/sources.md) | Toutes les sources, classées par fiabilité |
| [Prompt de démarrage](docs/PROMPT-DEMARRAGE.md) | Le prompt à coller pour lancer le développement |

## Skills Claude

Le dépôt embarque les skills repris d'EchoBridge (hors skills propres à EchoBridge) :

- `.claude/skills/` : sécurité (dont la sécurité des LLM et des agents), juridique et RGPD, GEO/SEO, UX et design ; `ui-ux-pro-max` et `plan-task` sont adaptés à ce projet ;
- `.claude/agents/` : les 5 agents GEO ;
- `.agents/skills/impeccable` : audit et finition d'interface.
