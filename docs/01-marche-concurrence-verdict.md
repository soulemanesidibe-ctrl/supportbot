# 01 · Marché, concurrence et verdict honnête

> Date de l'analyse : 5 novembre 2026. Les sources sont listées dans [`sources.md`](sources.md) avec leur niveau de fiabilité. Les sources institutionnelles françaises ou européennes sont prioritaires ; quand je n'ai trouvé qu'une source éditeur ou anglo-saxonne, c'est indiqué.

## 1. Le verdict d'abord

**Le projet est cohérent et réalisable, mais le marché du « chatbot IA pour helpdesk » est saturé.** Il ne faut pas y entrer de front. Il existe en revanche un créneau réel et encore peu occupé, à condition de le viser précisément :

> **Assurer la continuité du support IT de niveau 1 pendant les absences, la nuit, les congés et les pics, pour les PME, ETI, collectivités et ESN françaises, avec une IA souveraine qui prépare le travail des techniciens au lieu de les remplacer.**

| Question | Réponse courte |
|---|---|
| Cohérent ? | Oui. Le besoin (manque de bras au niveau 1, tâches répétitives, absences non remplacées) est réel et documenté. |
| Réalisable techniquement ? | Oui, pour un MVP. Les briques (LLM, RAG, API des outils de ticketing) sont matures et peu chères. Le difficile est la fiabilité, la sécurité des actions et l'intégration, pas l'IA elle-même. |
| Marché saturé ? | **Oui en haut du marché** (grands comptes, ServiceNow, Freshservice, Jira, EasyVista). **Non** sur le segment PME/ETI/secteur public français sous GLPI et sur le positionnement « relève pendant les absences ». |
| Risque principal | Les éditeurs d'ITSM intègrent l'IA gratuitement ou presque dans leurs offres. Votre valeur doit donc être là où ils ne vont pas : multi-outils, marque blanche ESN, souveraineté, PME. |

## 2. Contexte du marché français

- **Les ESN françaises** représentent un marché de **34,3 Md€ en 2025, en recul de 1,8 %**, avec une reprise amorcée fin 2025 (Numeum, bilan S2 2025). Un marché qui se contracte cherche de la productivité : c'est un argument pour vous, pas contre.
- **Recrutement tendu mais prudent** : à mi-2025, près de la moitié seulement des ESN avaient atteint leurs objectifs de recrutement, et 36 % anticipaient moins de recrutements de jeunes diplômés (Numeum). Or le niveau 1 est historiquement le poste d'entrée des jeunes diplômés.
- **Coût d'un technicien helpdesk** : médiane d'environ **33 400 € brut par an** (Michael Page via Journal du Net), entre 24 000 et 29 000 € selon d'autres agrégateurs. En coût employeur chargé, on est autour de 45 000 € par an. *(Source non institutionnelle ; à confirmer avec les fiches APEC ou France Travail.)*
- **L'adoption de l'IA dans les DSI** est une priorité de l'État : Bpifrance annonce 10 Md€ pour l'IA d'ici 2029 et le programme **IA Booster** vise 500 PME et ETI par an.

## 3. Qui fait déjà quoi

| Acteur | Origine | Cible | Ce qu'ils font | Leur limite pour vous |
|---|---|---|---|---|
| **ServiceNow + Moveworks** (rachat 2025) | États-Unis | Grands comptes | Agent IA employé intégré à la plateforme | Prix et complexité hors de portée des PME |
| **Freshservice (Freddy AI)** | Inde / États-Unis | ETI | Agent autonome réservé à l'offre Enterprise | Facturé par agent, IA autonome au plus haut palier |
| **Jira Service Management** (agent virtuel, Rovo) | Australie | Équipes tech | 12 000 conversations par an incluses, puis environ 0,30 $ l'unité | Lié à l'écosystème Atlassian |
| **EasyVista + Konverso** (rachat juillet 2026) | **France** | ETI, grands comptes | EV Pulse AI Conversations, agents sans code, hébergés en Europe | **Concurrent français le plus sérieux**, mais réservé à ses propres clients EasyVista |
| **Atera** | Israël | MSP / ESN | RMM + IA agentique niveau 1 | Outil propriétaire complet à adopter, pas un ajout |
| **GLPI (Teclib)** | **France**, open source | PME, secteur public | ITSM très répandu, IA seulement via plugin | **Pas d'agent IA natif mature : c'est votre ouverture** |
| Chatbots génériques (Zendesk, Tensoria, eesel…) | Divers | Service client | Agents IA branchés sur une base documentaire | Pas spécialisés support IT interne |

**Signal d'alerte du marché** : Gartner prévoit que **plus de 40 % des projets d'IA agentique seront abandonnés d'ici fin 2027** (coûts, valeur floue, contrôle des risques insuffisant), et estime que beaucoup de fournisseurs rebaptisent de simples chatbots en « agents ». Les DSI sont donc méfiantes. Votre discours doit être **mesurable et prudent**, pas « révolutionnaire ».

## 4. Les trous du marché

1. **GLPI** : l'ITSM le plus répandu dans les PME et le secteur public français, sans agent IA natif mature.
2. **Les ESN et infogéreurs de taille moyenne** n'ont pas d'agent IA en marque blanche à intégrer dans leurs contrats de support.
3. **La continuité pendant les absences** : aucun acteur ne se positionne sur « l'IA qui prend la garde ». Tous vendent du « 24/7 » générique.
4. **La souveraineté et la conformité prouvée** (AI Act, RGPD, NIS2), dans un contexte où les acteurs américains dominent.
5. **Le transfert de connaissance** : quand un technicien part ou s'absente, son savoir part avec lui. Personne ne vend la capitalisation automatique des tickets résolus comme bénéfice principal.

## 5. Le cadre réglementaire (contrainte et argument de vente)

- **AI Act, article 50** : depuis le **2 août 2026**, tout système conversationnel doit informer l'utilisateur qu'il échange avec une IA. Le Digital Omnibus n'a pas reporté cette obligation. Sanctions jusqu'à 15 M€ ou 3 % du CA mondial. Un support IT de niveau 1 n'est **pas** un système à haut risque au sens de l'annexe III, mais attention si l'agent touche aux droits d'accès des salariés : faire valider ce point par un juriste.
- **RGPD et CNIL** : la CNIL a finalisé en juillet 2025 ses recommandations sur le développement des systèmes d'IA (intérêt légitime possible avec garanties fortes). Les tickets contiennent des données personnelles : il faudra un **DPA** avec chaque client, une **AIPD** et une politique de conservation. Les skills `pia-generation`, `dpa-review` et `privacy-legal-setup` repris d'EchoBridge serviront directement.
- **NIS2** : la loi de transposition française (« Loi Résilience ») était examinée à l'Assemblée à partir d'octobre 2026. L'ANSSI publie le référentiel **ReCyF** depuis mars 2026. Beaucoup de vos clients (collectivités, santé, ETI industrielles) seront concernés. **Un agent qui touche au SI doit être auditable** : c'est un argument de vente si vous le prévoyez dès le départ.

## 6. Les risques à regarder en face

| Risque | Gravité | Parade |
|---|---|---|
| Réponse fausse ou action dangereuse (réinitialiser le mauvais compte) | Élevée | Autonomie progressive : lecture seule, puis actions validées par un humain, puis liste blanche. Journal d'audit systématique. |
| Injection de prompt via un ticket ou un mail piégé | Élevée | Garde-fous dès le MVP (skills `defending-llms-with-guardrails`, `testing-prompt-injection-in-rag-pipelines`). |
| Les éditeurs ITSM offrent l'IA en standard | Moyenne | Se positionner multi-outils, marque blanche et PME, là où ils ne vont pas. |
| Cycle de vente long avec les DSI | Moyenne | Passer par les ESN (canal indirect) et par des pilotes gratuits courts. |
| Fondateur seul sur deux sociétés | **Élevée** | Voir [06](06-synergies-echobridge.md) : mutualiser au maximum ou trouver un associé technique. |
| Promesse « remplacer un technicien » mal perçue | Moyenne | Ne jamais la faire. Le discours, c'est la relève, pas le remplacement. |
