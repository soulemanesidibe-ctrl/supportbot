# Backlog

Tout ce qui dépasse le jalon en cours est noté ici au lieu d'être fait (règle du projet). Une ligne = une tâche, avec son origine et le jalon où elle sera reprise.

| ID | Tâche | Origine | Reprise en |
|---|---|---|---|
| B01 | Exporter le modèle de menace au format JSON d'OWASP Threat Dragon (diagramme de flux dessiné dans l'outil) et le versionner à côté de `docs/threat-model.md` | J0 : le modèle v1 est en Markdown avec diagramme Mermaid ; l'export Threat Dragon n'a pas pu être validé dans l'outil depuis cet environnement | Avant J4 (premier connecteur Microsoft 365) |
| B02 | Activer CodeQL : le workflow est prêt, il suffit que le fondateur ajoute la variable de dépôt `ENABLE_CODEQL=true` (le dépôt est public, donc gratuit) | J0 | Fondateur, quand il veut |
| B03 | Analyse antivirus des pièces jointes (captures d'écran, fichiers) avant stockage durable | Modèle de menace M20 | J3 ou J7 |
| B04 | Interface : parcours clairs par rôle (ce que je vois, ce que je peux faire, ce que je ne peux pas faire) et indicateurs de valeur de production à définir avec le fondateur | Consigne du fondateur du 5 novembre 2026 | J1 (spec) puis J5 |
| B05 | Rendre vérifiable l'engagement « même l'éditeur ne lit pas vos données sans votre accord » : chiffrement applicatif par organisation du contenu des conversations (clés dans Vault), car la RLS n'empêche pas le propriétaire du projet Supabase de lire la base | Modèle de menace M30 | Avant le premier client payant |
| B06 | Au premier `package-lock.json` : ajouter npm à Dependabot, vérifier sur GitHub les étapes de dépendances (qui n'ont tourné qu'en local), trier les alertes GuardDog puis le rendre bloquant, et revoir la règle `releve-env-bulk-read` pour la configuration Vite si elle gêne | J0 : ces étapes dorment sans fichier de verrouillage | Premier jalon applicatif (J3 ou J5) |
| B07 | Publier le rapport Semgrep dans l'onglet « Code scanning » de GitHub (gratuit sur un dépôt public) : demande un job séparé avec `security-events: write` pour garder les permissions minimales | J0 | Avant J6 |

## Plan des jalons à jour (6 novembre 2026)

Ce plan réconcilie le prompt de démarrage, le complément du 5 novembre (rôles, administration, tableaux de bord) et le complément n°2 du 6 novembre (recentrage, fiabilité, alertes, ESN revendeur). **En cas de différence, le complément n°2 prime**, en particulier : un tableau de bord par rôle n'est plus demandé, seuls les écrans listés au jalon J5 le sont. Références : `docs/10-roles-administration-cockpits.md`, `docs/11-demo-resserree-et-fiabilite.md`, `docs/07-integrations.md` § 3 bis.

| Jalon | Périmètre retenu | Part au backlog (code non écrit) |
|---|---|---|
| **J0** | **Fait.** Ajouts du 6 novembre : modèle de menace v1.1 (alertes, mode ombre, données de pilote, revendeur, dépôt public), garde-fou contre les données réelles dans le dépôt public. | |
| **J1** | Spec limitée au périmètre de la démo. Parcours des rôles actifs : `super_admin` (par script), `partner_admin`, `partner_technician`, `org_admin`, `end_user`, plus la capacité de valideur suppléant. Parcours d'administration : nouvelle ESN (script), nouveau client créé par l'ESN (formulaire simple), client direct, import des salariés (Entra ID ou CSV), départ d'un technicien, fin de contrat ESN. Contrat des capacités, schéma, moteur d'automatisations, découpage en commits. **En plus :** `docs/modele-demande-donnees-pilote.md`. Questions au fondateur : voir ci-dessous. | Parcours des autres rôles (`platform_support`, `partner_manager`, `org_technician`, `org_viewer`, `auditor`) |
| **J2** | Migrations du prompt (organisations typées `platform` / `partner` / `client`, appartenances, relations ESN-client, assignations, accès d'assistance, invitations, revues d'accès, conversations, tickets, connecteurs avec Vault, base de connaissance avec pgvector, plannings de relève, rapports de passation, incidents, règles et exécutions d'automatisations, `action_requests`, politiques et délégations d'approbation, journal d'audit en insertion seule). **Ajouts du 6 novembre :** `alert_sources`, `alerts`, `alert_events`, `response_ratings` (notes des techniciens), `partner_pricing` (prix partenaire et marge de l'ESN). Les 10 rôles existent dans le schéma (il accueille tout) même si seuls 5 sont utilisés. Script d'isolation : technicien non assigné ou assignation expirée = rien ; relation révoquée = tout coupé ; super administrateur sans accès d'assistance = rien. Migrations à appliquer par le fondateur. | |
| **J3** | Orchestrateur, circuit des actions de niveau 1, revérification serveur de l'organisation active et du rôle à chaque requête, réauthentification MFA (créer une organisation, approuver une relation, déléguer, changer un niveau d'autonomie, ouvrir un accès d'assistance). **Ajout :** mode ombre configurable par organisation et par catégorie, avec retour arrière automatique (une note « Dangereuse », ou un taux de fausses réponses au-dessus de la barre sur une semaine, remet la catégorie en conseil seul). | |
| **J4** | Périmètre A seulement : connecteur **GLPI** et connecteur « démo » qui le simule, `docker-compose` GLPI ; **Microsoft 365** (diagnostic, état des services, niveau 1 limité à MFA, mot de passe, déblocage, révocation de sessions ; `docs/permissions-graph.md`) ; **supervision** par webhook générique et schéma normalisé d'alerte (déduplication, regroupement des rafales, anti-battement, fenêtres de maintenance, alerte « non rattachée », table des gravités, silence anormal) ; **corrélation** : incident regroupé, panne Microsoft 365 reconnue si le temps le permet ; **vérification d'identité hors bande** et refus d'une réinitialisation suspecte (non négociable). | Jira SM, iTop, Zabbix, Centreon et leurs `docker-compose` ; toutes les autres automatisations de `docs/07` § 3 |
| **J5** | Écrans : **technicien** (file unifiée, boîte de validation, notation des réponses), **ESN** (tous les clients avec zoom, rapport mensuel à sa marque, tableau d'opportunités, revenu et marge, création de client, relations ESN-client, assignations), **administrateur client** (accès et suppléance, état du support), **widget de chat** du salarié, et l'écran **« Qualité de Relève »** (ESN et administrateur client, vrais chiffres avec effectifs). Skills : `ui-ux-pro-max`, `impeccable`, `dataviz`, `design-critique`, `ux-review`, `accessibility-review`. | Tous les autres écrans (plateforme, direction, auditeur, salarié complet) |
| **J6** | Évaluation : jeu synthétique dans le dépôt (en CI), **jeu réel anonymisé hors dépôt**, barres de passage de `docs/11` § 2, comparaison Mistral Small et Medium (qualité, coût, délai), tests d'abus de rôle et de suppléance, rapport `docs/evaluation.md`. | |
| **J7** | Conformité et exploitation uniquement (brouillons à faire relire par un juriste : registre, AIPD, DPA, mentions AI Act art. 50, conservation, plan de réponse à incident, sous-traitants, sauvegarde testée, page « Sécurité »). | Tous les connecteurs du lot B |
| **J8** | Mise en ligne pas à pas ; compte super administrateur dédié protégé par passkey ; vue ESN multi-clients dans le scénario de démonstration. **Ajout :** pas à pas pour monter le jeu d'évaluation avec les pilotes (consentement, anonymisation, envoi). | |

### Backlog produit ordonné (hors démo)

On n'écrit pas leur code avant le premier client payant. Le schéma et les interfaces de connecteurs les accueillent déjà (`docs/11` § 1).

| Ordre | Contenu |
|---|---|
| 1 | Ce que le **premier client payant** utilise : son outil de ticketing, son RMM, sa supervision |
| 2 | Adaptateurs Zabbix et Centreon, Jira Service Management |
| 3 | **E-mail vers alerte** (outils qui ne savent qu'envoyer un mail) |
| 4 | RG System, NinjaOne, Atera, ScreenConnect, iTop, TeamsWork, PRTG, Freshservice, Zendesk |
| 5 | Écrans plateforme, direction, auditeur complet, salarié complet ; rôles restants |
| 6 | Automatisations de prévention et d'organisation du support (`docs/07` § 3.2 et 3.4) |
| 7 | Boîtes mail, licences, arrivées et départs ; relais Relève pour l'AD local ; EasyVista et les autres RMM |

**Exception :** un élément du backlog peut être ajouté avant le premier client payant seulement si **un pilote en donne l'accès** et si **la barre de fiabilité est déjà franchie** sur le périmètre existant. **La sécurité ne fait jamais partie de ce qu'on réduit.**

### Barres de fiabilité (propositions, à calibrer avec les pilotes)

Source : `docs/11` § 2. Jamais de pourcentage sans son effectif ; avec 100 demandes l'incertitude est d'environ 8 points, viser 300 par catégorie avant de conclure.

| Indicateur | Barre avant les réponses directes |
|---|---|
| Correcte et utile | 80 % ou plus |
| Fausse mais affirmée avec assurance | 2 % ou moins |
| Dangereuse | zéro |
| Escalade justifiée | 90 % ou plus |
| Escalade manquée | 3 % ou moins |
| « Je ne sais pas » à propos | 95 % ou plus |
| Niveau 1 : actions préparées avec la bonne cible | 100 % sur au moins 50 actions, aucune exécution sur le mauvais compte |

### Création de client par une ESN (décision du 5 novembre)

- À la création, la relation ESN-client est créée en même temps, active, pour que l'ESN puisse configurer le client.
- L'ESN invite l'administrateur du client ; à l'activation de son compte, il voit la relation, la confirme ou la réduit, et garde le droit de la révoquer seul.
- Réauthentification MFA de l'administrateur ESN, notification au super administrateur, plafond de clients selon l'offre partenaire.
- Le client est rattaché à l'offre partenaire de l'ESN pour la facturation, et lui reste rattaché (Relève ne le démarche jamais).
- Un client créé par une ESN ne peut pas être rattaché à une autre ESN sans l'accord de son administrateur.

### Questions ouvertes pour le fondateur

À poser au démarrage de J1 ; je n'invente ni la grille de remise ni le contrat revendeur, qui seront relus par un juriste (`docs/11` § 3).

1. Remise revendeur : 25 %, 30 % ou 35 % selon le volume ?
2. Engagement minimal du partenaire (nombre de clients, durée) ?
3. L'ESN peut-elle revendre sous son seul nom, sans mention « propulsé par Relève » ?
4. Le kit de vente de l'ESN (démonstration en un clic, calculateur de valeur, modèles de proposition et de contrat de sous-traitance) est-il dans la démo ? Il n'est pas listé au périmètre A.
5. Dans la démo, « panne localisée » et « fin d'incident » (`docs/07` § 3.1) sont-elles incluses avec l'incident regroupé ?
6. Avant que l'administrateur d'un client créé par l'ESN ait activé son compte, l'ESN peut-elle brancher un connecteur ou importer des salariés réels ? (risque posé dans le modèle de menace, § 8)
