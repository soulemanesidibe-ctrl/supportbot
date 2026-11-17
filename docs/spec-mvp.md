# Spécification de la démo de Relève IA (périmètre A)

| | |
|---|---|
| **Statut** | Brouillon pour accord du fondateur (jalon J1). Rien n'est construit tant que ce document n'est pas validé |
| **Version** | 1.0, 6 novembre 2026 |
| **Périmètre** | Uniquement le **périmètre A** de `docs/11-demo-resserree-et-fiabilite.md` § 1. Tout le reste est au backlog (`docs/backlog.md`) : le schéma et les interfaces l'accueillent, le code n'est pas écrit |
| **Documents liés** | `docs/threat-model.md` (menaces M01 à M40, invariants), `docs/securite-code-et-ci.md` (conventions de code), `docs/07-integrations.md` (capacités, alertes, suppléance), `docs/10-roles-administration-cockpits.md` (rôles), `docs/11-demo-resserree-et-fiabilite.md` (fiabilité, ESN revendeur) |

**Comment lire.** Les titres et les passages en gras suffisent pour saisir l'essentiel. Chaque exigence est marquée **P0** (la démo ne sort pas sans elle), **P1** (juste après, si le temps le permet) ou **P2** (hors démo, mais le schéma l'accueille). Les décisions déjà prises sont au § 1 ; ce qui reste ouvert est au § 17.

## 1. Décisions déjà prises (ne pas rediscuter)

| Sujet | Décision | Source |
|---|---|---|
| Première version | Une démo, pas un catalogue : GLPI, Microsoft 365, webhook de supervision, incident regroupé, suppléance, trois écrans et le widget | Fondateur, 6 nov. |
| Actions de niveau 1 | **Sur Microsoft 365, quatre seulement** : réinitialiser le MFA, réinitialiser le mot de passe, débloquer un compte, révoquer les sessions (tenant de test, comptes dédiés). S'y ajoute, dans GLPI, la **clôture des tickets enfants** d'un incident résolu, proposée par Relève et confirmée par un technicien | Fondateur, 6 nov. |
| Sécurité | Ne se réduit jamais. Vérification d'identité hors bande et refus d'une réinitialisation suspecte : non négociables | Fondateur, 6 nov. |
| Rôles actifs | `super_admin` (par script, sans écran), `partner_admin`, `partner_technician`, `org_admin`, `end_user`. Les cinq autres rôles existent dans le schéma | Fondateur, 6 nov. |
| Création de client par l'ESN | Autorisée ; la relation est créée active en même temps ; l'administrateur du client la confirme, la réduit ou la révoque seul | Fondateur, 5 nov. |
| Avant activation par le client | L'ESN **prépare** (GLPI, import des salariés par fichier, plannings) mais **aucune action de niveau 1 et aucune connexion Microsoft 365** tant que l'administrateur du client n'a pas activé son compte | Fondateur, 6 nov. |
| Incidents | **Incident regroupé** et **fin d'incident** dans la démo. Panne localisée au backlog. Panne Microsoft 365 reconnue : si le temps le permet (P1) | Fondateur, 6 nov. |
| Revendeur | Remise par paliers de 25, 30 et 35 % (seuils à fixer) ; aucun engagement pendant les pilotes puis 12 mois ; marque blanche sans mention (Relève reste nommé comme sous-traitant) ; kit de vente hors démo | Fondateur, 6 nov. |
| Qualité | Mode ombre, notation par les techniciens, barres de passage chiffrées avant toute réponse directe ou action élargie (§ 10) | Fondateur, 6 nov. |
| Données | Jamais de donnée réelle dans le dépôt (public). Jeu synthétique dans le dépôt, jeu réel dans un stockage privé | Fondateur, 6 nov. |
| Demande d'action sur un compte | Le salarié reçoit la **même réponse**, que la demande soit jugée suspecte ou non ; le soupçon n'existe que dans le ticket de sécurité vu des techniciens (§ 9.4, SEC-11) | Fondateur, 16 nov. |
| Messages d'incident | Le message fixe « un incident est en cours » (et celui de fin d'incident) part **directement** au salarié, même si sa catégorie est en mode ombre : c'est un gabarit écrit par nous, pas une réponse de l'IA, et il ne part que sur une alerte confirmée et au moins deux demandes de la même catégorie (§ 12) | Fondateur, 16 nov. |

## 2. Problème, objectifs, non-objectifs

### Problème

Quand les techniciens d'une ESN ou d'une DSI sont absents (nuit, congés, astreinte), le support de niveau 1 s'arrête : les salariés attendent, les demandes simples s'accumulent, et au retour le technicien reprend un tas de tickets sans contexte. Les outils d'IA existants promettent l'autonomie ; les DSI les refusent parce qu'**une mauvaise action sur un compte est pire qu'une absence de réponse**. Relève prend la garde, traite le simple, prépare le reste, et **ne fait jamais rien sans qu'un humain nommé ait validé**.

### Objectifs de la démo

| # | Objectif | Comment on le mesure | Cible (hypothèse, à calibrer avec les pilotes) |
|---|---|---|---|
| G1 | **Aucune mauvaise action sur un compte** | Actions de niveau 1 préparées avec la bonne cible ; exécutions sur un mauvais compte | 100 % de bonnes cibles sur au moins 50 actions ; **zéro** exécution sur un mauvais compte |
| G2 | **Une qualité mesurée sur de vraies demandes, par catégorie** | Notes des techniciens en mode ombre, avec effectifs | Barres du § 10, mesurées sur au moins 300 demandes par catégorie avant de conclure |
| G3 | **Résoudre une part réelle des demandes de niveau 1 sans technicien** | Part des demandes résolues par Relève **et confirmées par l'utilisateur** | 30 % ou plus à la fin d'un pilote de 8 semaines (`docs/03`), sur les catégories ouvertes |
| G4 | **Des utilisateurs satisfaits** | Note donnée à la clôture | 4 sur 5 ou plus |
| G5 | **Une ESN qui peut revendre simplement** | Activation d'un nouveau client ; envoi du rapport mensuel | Client activé en **moins d'une journée** ; rapport à la marque de l'ESN envoyé en **un clic** |
| G6 | **Une passation de garde utile** | Un technicien de retour sait en 2 minutes ce qui a été traité, en attente, escaladé | Mesuré par la satisfaction des techniciens (`docs/03` § 5) |

### Non-objectifs (et pourquoi)

| Hors démo | Pourquoi |
|---|---|
| Autres connecteurs (Jira, iTop, Zabbix, Centreon, RMM...) et leurs `docker-compose` | Une DSI pardonne un connecteur manquant, pas une mauvaise action : on prouve d'abord la fiabilité |
| Autres actions de niveau 1 (boîtes mail, licences, groupes, arrivées et départs, scripts) | Chaque action est un risque supplémentaire ; quatre suffisent à démontrer le circuit |
| Niveau 2 (autonomie sur liste blanche) | N'existe pas pendant le pilote |
| Canal Teams (Bot Framework) | La démo porte sur le widget web. Hypothèse à confirmer (§ 17) |
| Écrans plateforme, direction, auditeur, salarié complet | Backlog n° 5. Les données d'audit existent ; seul l'écran manque |
| Panne localisée, automatisations de prévention et d'organisation | Dépendent de la qualité de l'inventaire de chaque client |
| Kit de vente de l'ESN, e-mail vers alerte, relais Relève, Active Directory local | Après le premier client payant |
| Entraînement ou ajustement d'un modèle | Inutile : base de connaissance et garde-fous suffisent |

## 3. Rôles et droits

Les droits se calculent **toujours dans le contexte d'une organisation**, jamais globalement (menace M27, invariant R2). Le **valideur** n'est pas un rôle mais une **capacité** attribuée par catégorie d'action à un `partner_technician` (ou, plus tard, à un `org_technician`).

| Rôle (actif dans la démo) | Voit | Peut | Ne peut pas |
|---|---|---|---|
| **`super_admin`** (le fondateur, par script) | L'état de la plateforme et la configuration des organisations | Créer, suspendre une ESN ou un client ; inviter le premier administrateur ; **demander** un accès d'assistance | Lire les données d'un client sans accès d'assistance actif (lecture seule, 4 h, approuvé par le client) |
| **`partner_admin`** (administrateur ESN) | Tous les clients de son ESN **qui ont approuvé la relation**, leurs indicateurs, le revenu et la marge | Créer ses clients, inviter leurs administrateurs, gérer les techniciens de l'ESN et leurs assignations, préparer les connecteurs et plannings, envoyer le rapport mensuel, fixer son prix client | Accéder à un client sans relation active ; dépasser les rôles approuvés par le client ; lire le contenu d'une conversation hors des clients où il est assigné |
| **`partner_technician`** | Les demandes, tickets, incidents et actions à valider des **seuls clients qui lui sont assignés**, tant que l'assignation est active | Répondre, noter les réponses de l'IA, valider ou refuser une action dans sa chaîne, déléguer son rôle (MFA récent) | Voir un client non assigné ; valider une action qui cible son propre compte ; étendre sa propre chaîne |
| **`org_admin`** (administrateur client) | Son organisation uniquement : support, accès, valideurs, connecteurs, qualité | Activer sa relation avec l'ESN et la **réduire ou la révoquer seul**, définir les chaînes de valideurs, régler le niveau d'autonomie (0 ou 1) par catégorie, approuver un accès d'assistance, réattribuer les validations d'un absent | Toucher aux autres clients ; voir le prix partenaire ou la marge de l'ESN |
| **`end_user`** (salarié) | Ses propres demandes | Poser une question, demander une action sur son compte, parler à un technicien | Voir les demandes des autres |

Rôles présents dans le schéma mais **sans écran ni parcours** en démo : `platform_support`, `partner_manager`, `org_technician`, `org_viewer`, `auditor`. Un client sans ESN (« client direct ») est aussi accepté par le schéma (organisation de type `client` sans relation) mais n'est pas détaillé ici (§ 17).

## 4. Parcours et user stories

Chaque story porte une priorité. Les critères d'acceptation des P0 sont en cases à cocher ; **ils incluent ce qui ne doit pas arriver**. Les textes d'interface sont en français d'abord, sans tiret cadratin.

### 4.1 Le salarié (`end_user`), dans le widget

*Sa question : « Je suis bloqué, qu'est-ce que je fais ? »*

| ID | En tant que salarié, je veux... | pour... | Prio |
|---|---|---|---|
| S1 | poser ma question et savoir tout de suite à qui je parle | ne pas attendre sans savoir (badge « Assistant IA » toujours visible, badge « Relève active » avec l'heure de retour d'un humain) | P0 |
| S2 | être guidé pas à pas pour une manipulation | résoudre seul un problème simple (« ça a marché » / « ça ne marche pas ») | P0 |
| S3 | demander « Parler à un technicien » à tout moment | ne jamais rester bloqué face à l'IA ; le résumé est transmis, je ne répète rien | P0 |
| S4 | demander une action sur mon compte (MFA, mot de passe, déblocage, sessions) | retrouver l'accès sans attendre | P0 |
| S5 | savoir où en est ma demande | ne pas relancer | P0 |
| S6 | être prévenu quand une panne en cours est rétablie | ne pas réessayer en vain | P0 |
| S7 | coller une capture d'écran | éviter de décrire une erreur | P1 |
| S8 | voir qu'une panne Microsoft 365 est connue, sans ouvrir de ticket inutile | gagner du temps | P1 |

**Critères d'acceptation**

- **S1** : [ ] le badge « Assistant IA » est visible dans toute conversation, sur chaque écran du widget ; [ ] lorsque la relève est active, le badge ambre indique l'heure de retour prévue ; [ ] la première réponse commence à s'afficher en streaming en moins de 2 secondes (indicateur de frappe immédiat) ; [ ] **jamais** de réponse présentée comme venant d'un humain.
- **Mode ombre (S1, S2)** : *Given* la catégorie de ma demande n'a pas franchi la barre de qualité, *When* j'envoie ma demande, *Then* je ne reçois **aucun texte produit par l'IA** : un message fixe m'indique qu'un technicien va répondre, avec le délai habituel, et un ticket qualifié est créé ; [ ] la réponse préparée par l'IA existe, mais n'est visible que d'un technicien.
- **S3** : [ ] le bouton « Parler à un technicien » est présent à toute étape, même en mode ombre et même quand le service du modèle est indisponible ; [ ] le technicien reçoit un résumé (catégorie, diagnostic déjà fait, ce que l'utilisateur a essayé).
- **S4** : [ ] l'agent **ne demande jamais de mot de passe** ni de code, et masque ce qu'il détecte avant tout stockage ; [ ] il déclenche la vérification d'identité hors bande (§ 9.3) ; [ ] il annonce « en attente de validation » avec le délai habituel ; [ ] si la demande est jugée suspecte (§ 9.4), il **refuse de la traiter dans le chat** et escalade à un humain avec le contexte, sans dire pourquoi à l'utilisateur d'une façon qui aiderait un attaquant ; [ ] la réponse est la même que le compte existe ou non.
- **S6** : [ ] quand l'alerte liée à mon incident passe à « résolue », je reçois un message ; [ ] mon ticket enfant n'est clos qu'après confirmation d'un technicien.

### 4.2 Le technicien (`partner_technician`), dans la console

*Sa question : « Quoi faire maintenant, et sur quel client ? »*

| ID | En tant que technicien, je veux... | pour... | Prio |
|---|---|---|---|
| T1 | une **file unifiée** de tous mes clients assignés, triée par urgence | traiter le plus important en premier sans changer d'outil | P0 |
| T2 | **noter chaque réponse préparée** par l'IA en moins de 5 secondes (Correcte, Partielle, Fausse, Dangereuse + motif en un clic) | que la qualité soit mesurée et que Relève ne s'ouvre que là où il est fiable | P0 |
| T3 | une **boîte de validation** : l'action exacte, sa cible, l'objectif, les effets, le diagnostic déjà fait, la vérification d'identité | valider ou refuser en connaissance de cause | P0 |
| T4 | que l'action s'exécute **avec mon identité** et non celle de l'IA | que le journal dise qui a validé quoi | P0 |
| T5 | valider **en tant que suppléant** quand le valideur est absent, avec un bandeau explicite | couvrir une absence sans compte partagé | P0 |
| T6 | **déléguer** mon rôle à un collègue nommé, pour des catégories et une durée limitées | m'absenter sans bloquer mes clients | P0 |
| T7 | une **vue incident** : alertes et demandes sur une même ligne de temps, un ticket parent | comprendre et traiter une panne d'un coup | P0 |
| T8 | un écran **« Pendant votre absence »** à mon retour | savoir en 2 minutes ce qui est résolu, en attente, escaladé, à surveiller | P0 |
| T9 | reprendre une conversation escaladée sans demander à l'utilisateur de répéter | gagner du temps | P0 |
| T10 | une palette de commandes `Ctrl K` | aller vite au clavier | P1 |
| T11 | valider depuis mon téléphone (console utilisable sur mobile ; installation en PWA) | rester d'astreinte sans ordinateur | P1 |
| T12 | **connecter mon compte Microsoft** une fois (bouton « Connecter mon compte Microsoft » dans mon profil), et voir si ce lien est actif | que les actions de niveau 1 s'exécutent avec **mon** compte d'administration, sans compte partagé | P0 |

**Critères d'acceptation**

- **T1** : [ ] un technicien ne voit que les clients dont **la relation et son assignation sont actives** ; [ ] une assignation expirée ou une relation révoquée fait disparaître le client **à la requête suivante** ; [ ] chaque ligne indique le client, le type (incident, demande, validation), l'urgence et le délai de SLA lu dans GLPI s'il existe (affichage seul, aucune relance automatique en démo).
- **T2** : [ ] quatre boutons et un motif en un clic (source manquante, mauvaise version, hors périmètre, sur-confiance, autre) ; [ ] une note est rattachée au technicien, horodatée, **non modifiable** ; [ ] une note « Dangereuse » remet **immédiatement** la catégorie en conseil seul (§ 10.4).
- **T3** : [ ] l'écran montre l'action exacte (capacité, cible, paramètres) ; [ ] il indique si la vérification d'identité a réussi, et comment ; [ ] valider un autre contenu que celui affiché est **impossible** (empreinte, § 9.2) ; [ ] un technicien ne peut pas valider une action dont **il est la cible** ni une action qu'il a lui-même demandée.
- **T4** : [ ] l'exécution utilise le jeton délégué du valideur ; [ ] si le valideur n'a pas les droits Microsoft 365 suffisants, l'action échoue **sans repli** sur un autre compte.
- **T12** : [ ] la connexion est une **connexion Microsoft normale** (fenêtre de l'éditeur, MFA compris) : Relève ne voit **jamais** le mot de passe et ne **stocke aucun jeton** ; [ ] Relève retient seulement qui est lié (locataire, identifiant d'objet, nom d'utilisateur) ; [ ] seul un technicien habilité de l'organisation peut lier son compte, et seulement au locataire du connecteur ; [ ] le lien se révoque (départ du technicien : révocation **avec** ses assignations, ses délégations et ses places dans les chaînes de valideurs) ; [ ] **aucun compte d'administration partagé** et aucune permission d'application en écriture (menaces M05, invariant I1).
- **T5/T6** : invariants I1 à I12 de `docs/threat-model.md` § 5. En particulier : [ ] créer une délégation exige une session réauthentifiée par MFA récemment ; [ ] durée maximale 30 jours, périmètre limité aux catégories choisies ; [ ] une délégation expirée ou révoquée **cesse d'agir au moment de l'exécution**, même si l'action était déjà validée ; [ ] l'administrateur du client et le valideur remplacé sont notifiés.
- **T8** : [ ] regroupe par client ce qui a été résolu par Relève, ce qui attend une validation, ce qui a été escaladé, et ce à surveiller ; [ ] chaque élément ouvre la conversation ou l'action concernée.

### 4.3 L'administrateur de l'ESN (`partner_admin`)

*Sa question : « Lequel de mes clients a besoin de moi maintenant, et est-ce que je gagne de l'argent ? »*

| ID | En tant qu'administrateur ESN, je veux... | pour... | Prio |
|---|---|---|---|
| E1 | un **tableau de tous mes clients**, trié par urgence, avec filtres par étiquette | savoir où intervenir | P0 |
| E2 | un **zoom sur un client** : tous les blocs se recalculent sur lui | descendre dans le détail | P0 |
| E3 | **créer un client** avec un formulaire simple et inviter son administrateur | l'activer en moins d'une journée | P0 |
| E4 | **assigner mes techniciens** à un client (rôle, date de fin) et retirer un technicien d'un coup quand il part | garder la maîtrise des accès | P0 |
| E5 | **préparer** un client avant son activation : brancher GLPI, importer les salariés (fichier), régler les plannings de relève | tenir l'activation rapide | P0 |
| E6 | un **rapport mensuel** à mon logo et mes couleurs, avec un bloc « prochaine étape », que je relis et envoie en un clic | prouver ma valeur à mon client | P0 |
| E7 | fixer **mon prix client** et voir **ma marge** par client | savoir ce que je gagne | P0 |
| E8 | un **tableau d'opportunités** (clients sans relève active, pilotes qui se terminent, clients ayant connu des absences) | savoir qui contacter | P0 |
| E9 | l'écran **« Qualité de Relève »** avec les vrais chiffres et leurs effectifs | rassurer mon client avec des faits | P0 |
| E10 | ma **marque blanche** : logo, couleurs, nom, expéditeur des rapports | revendre sous mon nom | P1 pour le domaine d'expéditeur, P0 pour logo et couleurs |

**Critères d'acceptation**

- **E3** : [ ] exige une session réauthentifiée par MFA récemment ; [ ] respecte le plafond de clients de l'offre partenaire ; [ ] **notifie** le super administrateur ; [ ] crée **en même temps** la relation, active ; [ ] un client déjà existant ne peut pas être rattaché sans l'accord de son administrateur ; [ ] le client créé **reste rattaché à l'ESN** et Relève ne le démarche jamais.
- **E5** : [ ] avant l'activation par l'administrateur du client, **aucune action de niveau 1** n'est exécutable et la connexion Microsoft 365 est **refusée** ; [ ] l'import de salariés ne crée aucun compte dans le système du client ; [ ] chaque import est audité.
- **E6** : [ ] tout chiffre de « temps gagné » ou de « valeur » est affiché comme une **estimation avec sa méthode** ; [ ] aucun pourcentage sans son effectif ; [ ] le rapport ne contient ni la marge ni le prix partenaire ; [ ] l'envoi utilise le domaine vérifié de l'ESN (sinon le rapport est téléchargeable, pas envoyé).
- **E7** : [ ] `partner_admin` et `super_admin` seuls lisent le prix partenaire et la marge ; [ ] l'administrateur du client ne les voit dans aucun écran, rapport ou export.

### 4.4 L'administrateur du client (`org_admin`)

*Sa question : « Mon support tient-il, et qui a accès à quoi ? »*

| ID | En tant qu'administrateur client, je veux... | pour... | Prio |
|---|---|---|---|
| A1 | **activer mon compte** (MFA) et voir la relation que l'ESN a créée | décider de la confirmer, de la réduire ou de la refuser | P0 |
| A2 | voir **qui a accès à quoi et jusqu'à quand**, et **révoquer en un clic** sans passer par l'ESN | garder la main sur mon SI | P0 |
| A3 | définir les **chaînes de valideurs** par catégorie d'action, et **réattribuer** les validations d'un absent qui n'a rien délégué | qu'aucune demande ne reste sans valideur | P0 |
| A4 | régler le **niveau d'autonomie** par catégorie (0 : conseil seul, 1 : action après validation) | n'ouvrir que ce que je maîtrise | P0 |
| A5 | **approuver ou refuser** un accès d'assistance demandé par Relève | garder la main sur mes données | P0 |
| A6 | voir l'**état du support** et la **qualité de Relève** | savoir si ça vaut ce que ça coûte | P0 |
| A7 | voir l'état de mes connecteurs et accorder le **consentement Microsoft 365** | contrôler ce que Relève peut lire | P0 |
| A8 | faire la **revue trimestrielle** des accès | rester en règle (NIS2) | P1 |

**Critères d'acceptation**

- **A1/A2** : [ ] la relation affichée indique les rôles approuvés, la date de fin (12 mois maximum) et chaque technicien assigné ; [ ] « Révoquer » coupe l'accès de l'ESN **immédiatement** (même une session déjà ouverte) et conserve l'historique ; [ ] l'ESN est notifiée.
- **A4** : [ ] toute modification exige une session réauthentifiée par MFA ; [ ] le niveau 1 est refusé tant que le connecteur Microsoft 365 n'est pas marqué comme **tenant de test** ou **production** par l'administrateur ; [ ] le niveau 2 n'existe pas dans l'interface.
- **A5** : [ ] l'accès d'assistance est limité à ce client, en **lecture seule**, 4 heures par défaut, non prolongeable sans nouvelle approbation ; [ ] le demandeur ne peut jamais l'approuver ; [ ] l'ouverture et la fermeture sont notifiées.

### 4.5 Le super administrateur (`super_admin`), par script

*Pas d'écran en démo.* Un script (fonction SQL appelée avec un compte dédié protégé par passkey, J8) permet de : créer une ESN et inviter son premier administrateur ; suspendre une ESN ou un client ; **demander** un accès d'assistance (l'approbation reste celle du client). **Aucune policy de lecture** ne lui donne accès aux données des clients.

### 4.6 Parcours d'administration

| Parcours | Étapes | Garde-fous |
|---|---|---|
| **Nouvelle ESN** | Le super administrateur lance le script → invitation de l'administrateur ESN → il active son compte avec MFA → il invite ses techniciens | Invitation à usage unique, expirante, rôle fixé côté serveur |
| **Nouveau client via une ESN** | L'ESN crée le client (formulaire) → relation créée active → l'ESN prépare (GLPI, salariés, plannings) → l'ESN invite l'administrateur du client → il active son compte, **confirme ou réduit** la relation → le niveau 1 devient possible | MFA, plafond, notification du super administrateur ; **aucune action ni connexion Microsoft 365 avant l'activation** |
| **Import des salariés** | Fichier CSV (nom, e-mail, service) ; lecture des utilisateurs depuis Microsoft Entra ID en **P1** | Aucune création de compte chez le client ; permission de lecture documentée une par une (`docs/permissions-graph.md`, J4) |
| **Départ d'un technicien ESN** | L'administrateur ESN le retire → assignations, délégations, sessions et places de valideur révoquées **de façon atomique** | Invariant R7 ; notification des clients concernés |
| **Fin de contrat ESN** | Le client révoque la relation → accès coupés immédiatement, historique conservé, export possible | Révocable par le client seul |
| **Client sans ESN (« client direct »)** | Accepté par le schéma ; non détaillé dans la démo | Voir § 17 |

## 5. Architecture et arborescence

### 5.1 Vue d'ensemble

```mermaid
flowchart LR
  subgraph NAV["Navigateurs"]
    W["Widget salarié<br/>(page hébergée)"]
    C["Console technicien"]
    E["Écran ESN"]
    K["Écran administrateur client"]
  end
  subgraph CF["Cloudflare Pages"]
    BFF["Fonctions Pages<br/>session (cookie HttpOnly)"]
  end
  subgraph SB["Supabase (UE)"]
    EF["Edge Functions<br/>chat, alerts-ingest, actions,<br/>admin, reports, cron"]
    DB[("Postgres + RLS<br/>Vault, pgvector, audit")]
  end
  MIS["Mistral<br/>(Small / Medium)"]
  GLPI["GLPI du client"]
  M365["Microsoft 365<br/>(tenant de test)"]
  SUP["Supervision<br/>(webhook signé)"]
  W & C & E & K --> BFF --> EF
  EF <--> DB
  EF --> MIS
  EF <--> GLPI
  EF <--> M365
  SUP --> EF
```

### 5.2 Les Edge Functions et leur porte d'entrée

Chaque fonction commence par **une** vérification d'authentification (convention § 6), jamais par du métier.

| Fonction | Rôle | Garde d'entrée |
|---|---|---|
| `chat` | Conversation du salarié (streaming), RAG, mode ombre, création de ticket qualifié, préparation d'une `action_request` | `requireUser` (session salarié) puis `requireOrgMember` |
| `alerts-ingest` | Réception des alertes (webhook signé) ; l'interrogation de l'état des services Microsoft 365 est au backlog (B25) | `requireWebhookSource` (secret par source) |
| `actions` | Validation, refus et exécution des `action_request` | `requireOrgMember` (session avec second facteur) ; la validation exige en plus l'authentification Microsoft du valideur (§ 9.6) |
| `admin` | Organisations, invitations, relations, assignations, délégations, accès d'assistance, niveaux d'autonomie | `requireOrgMember` + `requireRecentMfa` |
| `reports` | Rapport de passation, rapport mensuel à la marque de l'ESN | `requireOrgMember` |
| `cron` | Index de la base de connaissance (`kb-index`) ; chaque minute, état des alertes et moteur d'automatisations (`alerts-tick`) | `requireCronSecret` |

**Clés et vérification du jeton (constaté le 15 novembre 2026 sur le projet réel et dans la documentation Supabase).** Le projet utilise les nouvelles clés (`sb_publishable_...`, `sb_secret_...`) ; les anciennes (`anon`, `service_role`) sont annoncées retirées début 2027. Les fonctions lisent donc `SUPABASE_SECRET_KEYS` et `SUPABASE_PUBLISHABLE_KEYS` (dictionnaires JSON, clé nommée `default`), avec repli sur les anciennes variables (`pickKey`, `_shared/db.ts`). Ces clés ne sont **pas des jetons JWT** : la vérification intégrée `verify_jwt` de la plateforme ne les comprend pas. Chaque fonction est donc déclarée avec `verify_jwt = false` dans `supabase/config.toml` et **fait elle-même sa vérification** (`requireUser`, `requireCronSecret`, signature de webhook), ce qu'elle faisait déjà. Deux points restent à confirmer **au premier déploiement réel** : que la clé secrète donne bien le rôle `service_role` à la base (l'acteur du journal d'audit en dépend, migration 11), et que le client envoie la clé dans l'en-tête `apikey` seulement.

La **console lit en direct** avec le client Supabase (la RLS protège) et **écrit par les Edge Functions** pour tout ce qui est sensible (validation, délégation, relation, niveau d'autonomie). Le client Supabase du navigateur utilise la clé publique uniquement.

**Mise en œuvre de la fonction `admin` (J3.9).** `_shared/admin/` : une **liste fermée d'opérations** (`ops.ts` ; 19 en J3, 24 après J4), chacune déclarant ses rôles, sa voie d'accès (membre, ou aussi ESN assignée), le second facteur et si elle reste possible en arrêt d'urgence. La porte (`handler.ts`) applique toujours le même ordre : méthode, corps borné à 20 Ko, opération connue, authentification et rôle, lecture stricte des champs (`input.ts`, jamais le corps entier recopié dans une écriture), lecture seule refusée, arrêt d'urgence refusé sauf pour ce qui **restreint** (geler, révoquer une relation, une assignation, une délégation ou un accès d'assistance, revenir au niveau 0, fermer une catégorie, retirer un technicien), second facteur de moins de 10 minutes, **trace d'audit avant d'agir** (si le journal ne répond pas, rien n'est fait), puis l'opération. Aucune opération ne reçoit l'organisation en paramètre : elle agit dans l'organisation du contexte, confrontée à la base.

| Famille | Opérations | Qui | Second facteur |
|---|---|---|---|
| Création et invitations | `client.create`, `invitation.create`, `invitation.accept` | administrateur ESN ; administrateur ESN ou client ; toute personne **avec adresse e-mail confirmée** | oui, oui, non |
| Relation avec l'ESN | `client.activate`, `relationship.reduce`, `relationship.revoke` | administrateur du client | oui, oui, **non** |
| Techniciens de l'ESN | `assignment.create`, `assignment.revoke`, `technician.offboard` | administrateur ESN | oui, **non**, oui |
| Arrêt d'urgence | `org.freeze`, `org.unfreeze` | administrateur du client ou de l'ESN (le dégel est réservé par la base au client ou à la plateforme) | **non**, oui |
| Autonomie et catégories | `autonomy.set`, `category.set_state` | administrateur du client | seulement pour le niveau 1 et pour « réponse directe » |
| Accès d'assistance | `support_access.request`, `.approve`, `.revoke` | super administrateur ; administrateur du client | oui, oui, **non** |
| Suppléance | `delegation.create`, `delegation.revoke` | technicien valideur (ses propres validations) ; administrateur du client (réattribution) | oui, **non** |
| Connecteur | `connector.qualify` | administrateur du client | oui |
| Connexions (J4) | `connector.create_glpi`, `connector.test`, `connector.create_m365` | administrateur du client ou de l'ESN | oui, **non**, oui |
| Compte Microsoft du technicien (J4, T12) | `microsoft.link`, `microsoft.unlink` | technicien, administrateur du client | oui, **non** |
| Règles d'automatisation (J4.8) | `automation.set_state` (`incident-grouped`, `incident-resolved`, `source-silent` : active, simulation, désactivée) | administrateur du client ou de l'ESN | seulement pour activer ; couper ou simuler reste possible pendant un arrêt d'urgence |

Choix à connaître. (1) **Un arrêt d'urgence ne demande pas de second facteur** : il doit pouvoir se faire en une seconde ; lever le gel en exige un. (2) **Une invitation est à usage unique, expirante (7 jours), son jeton n'est jamais stocké** (seule l'empreinte SHA-256 l'est) et n'est renvoyé qu'une fois à la personne qui invite. L'acceptation exige l'adresse e-mail **confirmée** par le serveur d'authentification (`requireUserWithEmail`) ; tout refus (jeton inconnu, expiré, déjà utilisé, autre adresse, organisation suspendue) donne le **même message**. (3) Une personne qui accepte une invitation n'a encore aucune organisation : `serviceClient` la refuse toujours ; elle n'obtient qu'une **porte étroite** (`acceptInvitationRpc`) qui n'appelle que la fonction SQL d'acceptation, avec son identifiant posé par le code. (4) Le client créé par une ESN naît **non activé**, avec une relation active de 12 mois limitée aux rôles administrateur et technicien, ses 11 catégories fermées (mode ombre) et aucun niveau d'autonomie ; **aucune opération ne rattache un client existant** à une ESN sans lui. (5) Le plafond de clients (10 par défaut) est **provisoire** et ne se modifie par aucune opération. **Pas encore fait :** notification du super administrateur à la création d'un client (la trace d'audit existe ; l'envoi attend les canaux de J4/J5), chaînes de valideurs (`approval_policies`, écran J5), import des salariés, envoi des invitations par e-mail (J5).

**Limitation de débit (J3.10, SEC-24, menace M10).** `_shared/ratelimit.ts` et la fonction SQL `rate_limit_hit` (migration 13) : un compteur en base, à fenêtre fixe d'une minute, atomique, donc valable quel que soit le nombre d'instances d'une fonction. Chaque porte HTTP (`chat`, `actions`, `admin`) **reçoit obligatoirement** un limiteur (le type l'impose : on ne peut pas l'oublier) et l'appelle **juste après l'authentification, avant tout travail** (modèle, base). Valeurs de départ, **provisoires** : 12 messages par minute et par salarié et 120 par organisation pour `chat` ; 30 par personne et 120 par organisation pour `actions` et `admin`. Dépasser = réponse 429 avec l'en-tête `Retry-After` ; le compteur qui ne répond pas = **refus (503), jamais un passage**. Les clés sont composées par le code à partir du contexte vérifié, jamais d'une donnée de la requête ; une personne sans organisation (acceptation d'une invitation) n'a que la règle « personne ». **Limites assumées :** (1) fenêtre fixe : à cheval sur deux minutes, une personne peut obtenir jusqu'à deux fois la limite ; (2) une requête sans jeton valide ne consomme aucun compteur (sinon un inconnu pourrait épuiser celui d'un autre), elle est arrêtée par la vérification du jeton ; la protection contre un déluge volumétrique relève de la plateforme (Supabase) ; (3) la file d'attente vers le fournisseur de modèle reste propre à chaque instance (§ ci-dessus) : le limiteur protège le quota, il ne le répartit pas.

**Connecteurs (J4.1 et J4.2).** `_shared/connectors/` : `http.ts` (**seul** client sortant : https, port 443, nom de domaine public, aucune adresse IP écrite en clair sous aucune forme, aucun nom interne, aucune information d'identification dans l'adresse, jamais de redirection, délai de 10 s, réponse bornée à 1 Mo, erreurs typées sans donnée sensible ; liste blanche de domaines facultative `CONNECTOR_ALLOWED_HOST_SUFFIXES`), `demo.ts` (connecteur de démonstration, sans réseau, **inerte en production** sauf `RELEVE_ALLOW_DEMO_CONNECTOR=1`), `glpi.ts` (API REST de GLPI : une session par appel, jetons lus du coffre à chaque appel, références de ticket validées en chiffres avant d'entrer dans une adresse, **tout texte d'un salarié neutralisé** avant d'entrer dans un champ de GLPI, suivi **privé par défaut**, paramètres validés **avant** d'ouvrir une session), `secrets.ts`, `register.ts`. Une règle Semgrep (`releve-direct-fetch`) interdit tout appel direct à `fetch`. Opérations d'administration `connector.create_glpi` (l'ESN peut la **préparer avant l'activation du client** ; les jetons vont directement au coffre, la configuration ne garde que l'adresse, le statut vient d'un vrai test de connexion) et `connector.test`. **Copie des tickets** : un ticket créé par le chat est copié vers l'outil de ticketing de l'organisation (`chat/mirror.ts`), **après coup, sans jamais bloquer la conversation**, de façon idempotente, avec le seul message masqué du salarié et un résumé fixe du diagnostic. **À valider sur une instance réelle** (la documentation générique de l'API ne les décrit pas) : les valeurs de statut des tickets, le type de lien « fils de », les champs d'un suivi, les numéros de colonnes de recherche : ils sont isolés en constantes dans `glpi.ts`.

**Microsoft 365 (J4.3 et J4.4).** `_shared/connectors/m365.ts` et `docs/permissions-graph.md`. **Deux régimes jamais mélangés** : le diagnostic et l'état des services (lus par l'agent pendant le chat, sans technicien) utilisent un jeton d'**application en lecture seule** ; les quatre actions utilisent **uniquement le jeton délégué du technicien qui valide** (le connecteur refuse toute écriture sans lui, et l'application n'a aucune permission d'écriture). Diagnostic **fermé en cas d'échec** (historique des connexions, rôles ou méthodes illisibles = aucune action préparée). Réinitialisation du mot de passe : mot de passe **généré par Microsoft**, remis au technicien **seulement après confirmation** de l'opération, par un **canal à usage unique** (`deliverSecret`) : présent dans la seule réponse à ce technicien, jamais stocké ni journalisé ; sans canal, rien n'est réinitialisé. Second facteur : suppression de toutes les méthodes sauf le mot de passe (méthode documentée par Microsoft). Erreur **certaine** (Microsoft a refusé avant toute écriture) ou **incertaine** (panne, délai, écriture partielle : jamais rejouée seule). **Correction d'un défaut de J3** trouvée ici : l'exécuteur transmettait au connecteur les paramètres libres de l'action, sans la cible ; la cible vient désormais **toujours** de l'action approuvée (`target_ref`, couverte par l'empreinte). Opérations d'administration `connector.create_m365` (**refusée avant l'activation du client**, SEC-30) et, pour chaque technicien (T12), `microsoft.link` (jeton vérifié **par Microsoft** via `/me`, tenant attendu lu sur le connecteur, seul le lien est conservé) et `microsoft.unlink`. Les identifiants de l'application (`MS_APP_CLIENT_ID`, `MS_APP_CLIENT_SECRET`) vont dans les secrets des fonctions.

**Alertes (J4.5 et J4.6).** Fonction `alerts-ingest` (`_shared/alerts/`) : adresse `/alerts-ingest/<source>`, corps borné à 64 Ko et lu en **octets bruts**, signature HMAC-SHA-256 de « horodatage.corps » vérifiée en temps constant (`requireWebhookSource`, dans `auth.ts`), horodatage à plus ou moins 5 minutes. **Même réponse 401** pour une source inconnue, désactivée, d'une organisation suspendue, ou une signature fausse, et **même calcul** dans tous les cas (secret de remplacement tiré au hasard au démarrage : le temps de réponse ne dit rien). Débit compté **après** la signature : 120 livraisons par minute et par source, 600 par organisation. La **correspondance des champs** est de la configuration (chemins simples, propriétés propres seulement, jamais le prototype) ; une correspondance vide lit le **format natif** de Relève. Gravité et état inconnus, date illisible, adresse non https : tolérés, signalés par des **codes** dans la réponse (l'outil le voit dès l'envoi d'essai). Secrets masqués dans le résumé, l'actif et la charge brute ; une clé de déduplication trop longue ou porteuse d'un secret est remplacée par son empreinte. Tout le reste est fait par la base, **en une transaction** (migration 15, `alert_ingest`) : rejeu (une livraison refusée n'est pas marquée reçue et peut être renvoyée ; un doublon répond 200 « duplicate », sans effet), déduplication, rattachement par le motif d'actif le plus précis (« * » seul joker) sinon « non rattachée », maintenance (alerte gardée, jamais confirmée pendant la fenêtre), **anti-battement** (confirmée après 2 événements ou 3 minutes), résolution (l'incident se résout avec sa **dernière** alerte), silence d'une source (alerte « silence anormal » de Relève, résolue seule quand la source revient ; clé `releve:` interdite aux sources). La fonction ne déclenche **aucune** automatisation : l'outil de supervision reçoit une réponse immédiate.

**Moteur d'automatisations (J4.7).** `_shared/automations/` : `rules.ts` (lecture **stricte** des règles : champ, opérateur, type de valeur, action, paramètres et plafonds ; tout écart rend la règle inerte et l'inscrit au registre), `engine.ts`, `templates.ts`, `tick.ts`. La tâche planifiée `cron?job=alerts-tick` (chaque minute, **à planifier au déploiement**, B27) confirme les alertes à l'échéance, réévalue les alertes confirmées sans incident (les demandes arrivent souvent après l'alerte), détecte les sources muettes, traite les incidents résolus et **suit les incidents ouverts** (une demande arrivée après l'ouverture est rattachée et son auteur prévenu). Chaque organisation reçoit son propre contexte, l'état relu en base (`scopeCronToOrg`). **Plafonds appliqués par la base avant tout effet** (`automation_claim`) : une exécution par déclencheur, nombre par heure, délai minimal **par périmètre** (la catégorie pour un regroupement), simulation ; règle de l'organisation sinon modèle de la plateforme. Règles livrées actives : `incident-grouped` (incident, ticket parent, tickets enfants, **gabarit fixe** aux salariés, astreinte prévenue), `incident-resolved` (gabarit de fin et **propositions** de clôture à valider ; au niveau 0, défaut du pilote, la base refuse et la raison est inscrite), `source-silent` (astreinte). L'astreinte est la personne inscrite **et** qui a encore accès au client, sinon les techniciens qui y ont accès (table `notifications`, lue dans la console en J5 ; envoi par e-mail ou Teams : B26). Les copies vers GLPI passent par une **porte fermée** des automatisations (`callSystemCapability` : créer un ticket, lier deux tickets, rien d'autre). Les messages aux salariés ne contiennent **jamais** le texte d'une alerte ni le nom d'un actif (SEC-18) et rappellent que Relève est un assistant IA. `suspicious-reset` reste appliquée **dans le code de l'orchestrateur** (J3, plus fort qu'une règle : non désactivable) ; `m365-outage` est au backlog (B25). Opération d'administration `automation.set_state` (J4.8) : l'organisation choisit seulement l'**état** d'une règle de la plateforme (active, simulation, désactivée), jamais sa définition ; une règle verrouillée ne se change pas. **Pas encore fait :** l'écran « Automatisations » (backlog).

### 5.3 Session et jetons : décision technique à confirmer

Aucun jeton dans `localStorage` (CSP stricte, menace M15). Conception retenue :

- le **widget est une page hébergée** par Relève (`/w/<organisation>`), que l'intranet du client ouvre dans un onglet ou une fenêtre. L'**intégration par iframe** est un P1 : les navigateurs bloquent de plus en plus les cookies tiers, ce qui la fragilise ;
- une **fonction Pages** (même origine que le front) joue le rôle de « passerelle de session » : le jeton de rafraîchissement vit dans un cookie `__Host-` **HttpOnly**, `Secure`, `SameSite=Lax` ; le jeton d'accès (10 minutes) vit **en mémoire** du navigateur seulement ;
- **salariés** : connexion par code à usage unique envoyé à leur adresse professionnelle, **uniquement si l'adresse figure dans la liste des salariés importée** du client, **vérifiée avant l'envoi du code** et non après ; la conversation seule n'authentifie jamais une action sur un compte (§ 9.3) ;
- **techniciens et administrateurs** : e-mail, mot de passe et second facteur (TOTP) obligatoires ; « MFA récent » se lit dans la revendication `amr` du jeton (horodatage de la dernière vérification du second facteur ; **format confirmé le 15 novembre 2026** par la documentation Supabase, *JWT Claims Reference* et FAQ du guide *Multi-Factor Authentication* : tableau d'objets `{method, timestamp}`, méthode `totp`).

**Mise en œuvre (J5.2).** Fonction `employee-auth` (trois opérations) : `org` (nom et couleur d'un client activé, sinon « introuvable »), `request_code` (réponse **identique et immédiate** : la vérification dans l'annuaire, les deux compteurs de débit, 60 par organisation et par minute et 5 par adresse et par quart d'heure, et l'envoi se font **après** la réponse ; ni le contenu ni la durée ne disent si l'adresse est connue ; le compte est créé par l'API d'administration, les inscriptions libres restent fermées), `link` (rattache la personne **du jeton** à sa ligne d'annuaire). Le code est vérifié par la passerelle de session, jamais par cette fonction. **CORS** (SEC-23) : seules les origines exactes de `RELEVE_ALLOWED_ORIGINS` reçoivent les en-têtes, jamais « * » ni cookie ; sans variable, aucune origine. **Réglages à faire au déploiement** (tableau de bord Supabase, pas dans le dépôt) : inscriptions libres fermées, code de 6 chiffres valable 600 secondes, modèle d'e-mail qui montre le code (`{{ .Token }}`) et non un lien, jeton d'accès de 600 secondes, rotation des jetons de rafraîchissement, service d'envoi d'e-mails dédié (le service intégré est limité à quelques messages par heure).

**Passerelle de session (J5.2).** `app/server/session.ts`, en API web standard : la même fonction tourne en fonction Cloudflare Pages (`app/functions/api/session/[op].ts`) ou derrière le petit serveur Node sans dépendance (`app/server/node.ts`) d'un hébergeur français, au choix du déploiement (question ouverte Q12). Opérations `otp`, `password`, `mfa`, `refresh`, `logout` ; cookie `__Host-releve-e` (salarié, 7 jours) distinct de `__Host-releve-s` (personnel, 12 heures) : une session du widget n'ouvre jamais la console. Défenses : POST seulement, en-tête `Origin` égal à l'origine de la passerelle, `Sec-Fetch-Site` same-origin, corps JSON borné, clé **publiable** seulement (une clé secrète est refusée), jeton de rafraîchissement jamais dans une réponse, messages de Supabase jamais renvoyés. Les écrans appellent ensuite les fonctions Edge directement avec le jeton d'accès en mémoire (`app/src/lib/api/session.ts`, un seul renouvellement à la fois). **En-têtes de sécurité** (`app/server/headers.ts`, une seule définition pour les deux hébergements) : CSP `default-src 'none'`, scripts de notre origine seulement, connexions limitées à notre origine, au projet Supabase et à Microsoft, aucun cadre ; HSTS deux ans ; `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP et CORP. **Limite assumée :** les limites de débit de Supabase Auth sont comptées par adresse IP ; derrière la passerelle, toutes les connexions partagent les adresses de l'hébergeur : à régler dans le tableau de bord au déploiement, et à surveiller pendant le pilote.

### 5.4 Arborescence du dépôt

```
app/                          Front React + Vite + TypeScript (Cloudflare Pages)
  src/widget/                 Widget salarié (thème clair par défaut)
  src/console/                Console technicien (thème sombre par défaut)
  src/esn/                    Écran ESN
  src/client/                 Écran administrateur client
  src/ui/                     Système de design « Signal » (tokens de docs/04)
  src/lib/                    Client Supabase, i18n (fr puis en), formats
  functions/api/session/      Fonctions Pages : passerelle de session
supabase/
  migrations/                 Migrations (appliquées par le fondateur)
  seed/                       Données de démonstration SYNTHÉTIQUES
  tests/                      Scripts SQL de test d'isolation
  functions/
    _shared/auth.ts           requireUser, requireOrgMember, requireRecentMfa, verifyWebhookSignature, requireCronSecret
    _shared/db.ts             serviceClient(auth) : seul accès service_role
    _shared/log.ts            log.* et redact()
    _shared/llm/              Couche LLM abstraite, prompts statiques, wrapExternal, garde-fous
    _shared/capabilities/     Registre des capacités, callCapability()
    _shared/actions/          Machine à états, empreinte, validateurs, executeApprovedAction()
    _shared/connectors/       types.ts, glpi/, m365/, demo/
    _shared/alerts/           Normalisation, déduplication, regroupement, silence
    _shared/automations/      Moteur de règles et règles livrées
    chat/  alerts-ingest/  actions/  admin/  reports/  cron/
eval/
  synthetic/                  Jeu d'évaluation synthétique (en CI)
  promptfoo/                  Configuration des tests offensifs et de qualité
docker/glpi/                  docker-compose GLPI pour le développement
security/                     Règles Semgrep et verrous d'outils (J0)
docs/  scripts/  .github/
```

## 6. Conventions de code figées

Ces noms sont **ceux que les règles Semgrep de J0 imposent** (`docs/securite-code-et-ci.md` § 2) ; ils ne changent plus sans modifier les règles et leurs tests.

| Nom | Signature | Rôle |
|---|---|---|
| `AuthContext` | `{ kind, userId, orgId, role, via, readOnly, frozen, activated, aal, mfaAt, requestId }` | Preuve, **par le type et à l'exécution**, qu'une authentification et une appartenance ont été vérifiées pour **cette** requête. Gelé, fabriqué par le seul `auth.ts` : un littéral, une copie ou un JSON n'en sont pas un. `via` : `member`, `partner` ou `support_access` (lecture seule) |
| `requireUser(req)` | `Promise<AuthContext>` | Vérifie le JWT |
| `requireOrgMember(req, orgId, roles?)` | `Promise<AuthContext>` | Vérifie le JWT, l'appartenance, le rôle, et pour une ESN la relation **et** l'assignation actives |
| `requireRecentMfa(auth, maxAgeSeconds)` | `AuthContext` | Refuse si le second facteur est plus ancien que la limite (défaut : 600 s) |
| `verifyWebhookSignature(req)` | `Promise<AuthContext>` (`kind: "source"`) | Signature HMAC d'une source d'alertes, horodatage anti-rejeu. **Livrée en J4 (commit 4.5)**, avec le secret de la source lu dans Vault |
| `requireCronSecret(req)` | `Promise<AuthContext>` (`kind: "cron"`) | Appels planifiés internes ; refus si le secret est absent ou de moins de 32 caractères |
| `serviceClient(auth)` | `SupabaseClient` | **Seul** moyen d'obtenir un client `service_role` |
| `log.info/warn/error(événement, champs)`, `redact(valeur)` | | Journalisation avec masquage |
| `SYSTEM_PROMPT`, `getSystemPrompt()` | `string` | Prompt système **statique** versionné |
| `wrapExternal(étiquette, donnée)` | `string` | Encadre un contenu externe comme **donnée** dans un message `user` |
| `callCapability(ctx, nom, params)` | | Porte des capacités de lecture et autonomes ; applique `assertCapabilityAllowed` |
| `executeApprovedAction(actionRequestId)` | | Porte des actions privilégiées ; appelle `assertApprovedActionRequest` |
| `connector.invokeCapability(...)` | | Appel brut, **réservé** aux deux portes |

## 7. Contrat des capacités (TypeScript)

L'agent ne connaît ni GLPI ni Microsoft 365 : il connaît des **capacités** (`docs/07` § 1). Le contrat déclare **toutes** les capacités prévues pour que le backlog s'y ajoute sans refonte ; seules celles marquées `demo` sont implémentées. Fichier cible : `supabase/functions/_shared/capabilities/types.ts`.

```ts
// Famille et nom : tous déclarés, seuls ceux de DEMO_CAPABILITIES sont implémentés.
export type CapabilityName =
  // Ticketing
  | 'ticket.create' | 'ticket.get' | 'ticket.search' | 'ticket.comment'
  | 'ticket.update_status' | 'ticket.assign' | 'ticket.link_parent' | 'kb.search'
  // Identité et messagerie (Microsoft 365)
  | 'user.diagnose' | 'user.reset_password' | 'user.unlock' | 'user.revoke_sessions'
  | 'user.mfa_reregister' | 'tenant.service_health'
  | 'mailbox.diagnose' | 'mailbox.grant_shared_access' | 'mailbox.set_auto_reply'
  | 'mailbox.set_forwarding' | 'license.assign' | 'group.add_member'
  | 'user.onboard' | 'user.offboard' | 'tenant.license_usage'
  // RMM et parc
  | 'device.find_by_user' | 'device.health' | 'device.patch_status'
  | 'device.backup_status' | 'script.run'
  // Prise en main à distance
  | 'remote.create_session' | 'remote.session_status'
  // Supervision
  | 'alert.ingest' | 'alert.list_active' | 'alert.acknowledge' | 'host.status';

/** autonomous : l'agent l'appelle seul. approval_required : action_request validée par un humain. forbidden : jamais. */
export type ActionClass = 'autonomous' | 'approval_required' | 'forbidden';

/** Catégories d'action pour les chaînes de valideurs et le niveau d'autonomie (docs/07 § 5). */
export type ApprovalCategory = 'accounts' | 'mailboxes' | 'licenses' | 'scripts' | 'tickets';

export interface CapabilityMeta {
  readonly family: 'ticketing' | 'identity' | 'device' | 'remote' | 'monitoring';
  readonly effect: 'read' | 'write';
  /** Classe par défaut ; une organisation peut la durcir, jamais l'assouplir. */
  readonly class: ActionClass;
  readonly category: ApprovalCategory;
  /** La cible doit être l'utilisateur authentifié de la conversation, ou choisie par un technicien. */
  readonly targetPolicy: 'none' | 'self_only' | 'technician_chosen';
  readonly requiresIdentityCheck: boolean;
  /** Implémentée dans la démo. */
  readonly demo: boolean;
}

// `as const satisfies` : vérifie que toutes les capacités sont décrites SANS élargir les types littéraux
// (sinon PrivilegedCapability ci-dessous serait vide).
export const CAPABILITIES = {
  'ticket.create':        { family: 'ticketing', effect: 'write', class: 'autonomous',        category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'ticket.get':           { family: 'ticketing', effect: 'read',  class: 'autonomous',        category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'ticket.search':        { family: 'ticketing', effect: 'read',  class: 'autonomous',        category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'ticket.comment':       { family: 'ticketing', effect: 'write', class: 'autonomous',        category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'ticket.link_parent':   { family: 'ticketing', effect: 'write', class: 'autonomous',        category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'ticket.update_status': { family: 'ticketing', effect: 'write', class: 'approval_required', category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'ticket.assign':        { family: 'ticketing', effect: 'write', class: 'approval_required', category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: false },
  'kb.search':            { family: 'ticketing', effect: 'read',  class: 'autonomous',        category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },

  'user.diagnose':        { family: 'identity', effect: 'read',  class: 'autonomous',         category: 'accounts', targetPolicy: 'self_only',         requiresIdentityCheck: false, demo: true },
  'tenant.service_health':{ family: 'identity', effect: 'read',  class: 'autonomous',         category: 'accounts', targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'user.reset_password':  { family: 'identity', effect: 'write', class: 'approval_required',  category: 'accounts', targetPolicy: 'self_only',         requiresIdentityCheck: true,  demo: true },
  'user.unlock':          { family: 'identity', effect: 'write', class: 'approval_required',  category: 'accounts', targetPolicy: 'self_only',         requiresIdentityCheck: true,  demo: true },
  'user.revoke_sessions': { family: 'identity', effect: 'write', class: 'approval_required',  category: 'accounts', targetPolicy: 'self_only',         requiresIdentityCheck: true,  demo: true },
  'user.mfa_reregister':  { family: 'identity', effect: 'write', class: 'approval_required',  category: 'accounts', targetPolicy: 'self_only',         requiresIdentityCheck: true,  demo: true },

  'alert.ingest':         { family: 'monitoring', effect: 'write', class: 'autonomous',       category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'alert.list_active':    { family: 'monitoring', effect: 'read',  class: 'autonomous',       category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: true },
  'host.status':          { family: 'monitoring', effect: 'read',  class: 'autonomous',       category: 'tickets',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: false },
  'alert.acknowledge':    { family: 'monitoring', effect: 'write', class: 'approval_required', category: 'tickets', targetPolicy: 'none',              requiresIdentityCheck: false, demo: false },

  // Backlog : déclarées « interdites » tant que leur connecteur et leurs tests n'existent pas.
  'mailbox.diagnose':           { family: 'identity', effect: 'read',  class: 'forbidden', category: 'mailboxes', targetPolicy: 'self_only',         requiresIdentityCheck: false, demo: false },
  'mailbox.grant_shared_access':{ family: 'identity', effect: 'write', class: 'forbidden', category: 'mailboxes', targetPolicy: 'technician_chosen', requiresIdentityCheck: true,  demo: false },
  'mailbox.set_auto_reply':     { family: 'identity', effect: 'write', class: 'forbidden', category: 'mailboxes', targetPolicy: 'self_only',         requiresIdentityCheck: true,  demo: false },
  'mailbox.set_forwarding':     { family: 'identity', effect: 'write', class: 'forbidden', category: 'mailboxes', targetPolicy: 'self_only',         requiresIdentityCheck: true,  demo: false },
  'license.assign':             { family: 'identity', effect: 'write', class: 'forbidden', category: 'licenses',  targetPolicy: 'technician_chosen', requiresIdentityCheck: false, demo: false },
  'group.add_member':           { family: 'identity', effect: 'write', class: 'forbidden', category: 'accounts',  targetPolicy: 'technician_chosen', requiresIdentityCheck: true,  demo: false },
  'user.onboard':               { family: 'identity', effect: 'write', class: 'forbidden', category: 'accounts',  targetPolicy: 'technician_chosen', requiresIdentityCheck: false, demo: false },
  'user.offboard':              { family: 'identity', effect: 'write', class: 'forbidden', category: 'accounts',  targetPolicy: 'technician_chosen', requiresIdentityCheck: false, demo: false },
  'tenant.license_usage':       { family: 'identity', effect: 'read',  class: 'forbidden', category: 'licenses',  targetPolicy: 'none',              requiresIdentityCheck: false, demo: false },
  'device.find_by_user':        { family: 'device',   effect: 'read',  class: 'forbidden', category: 'scripts',   targetPolicy: 'self_only',         requiresIdentityCheck: false, demo: false },
  'device.health':              { family: 'device',   effect: 'read',  class: 'forbidden', category: 'scripts',   targetPolicy: 'self_only',         requiresIdentityCheck: false, demo: false },
  'device.patch_status':        { family: 'device',   effect: 'read',  class: 'forbidden', category: 'scripts',   targetPolicy: 'none',              requiresIdentityCheck: false, demo: false },
  'device.backup_status':       { family: 'device',   effect: 'read',  class: 'forbidden', category: 'scripts',   targetPolicy: 'none',              requiresIdentityCheck: false, demo: false },
  'script.run':                 { family: 'device',   effect: 'write', class: 'forbidden', category: 'scripts',   targetPolicy: 'technician_chosen', requiresIdentityCheck: true,  demo: false },
  'remote.create_session':      { family: 'remote',   effect: 'write', class: 'forbidden', category: 'scripts',   targetPolicy: 'self_only',         requiresIdentityCheck: true,  demo: false },
  'remote.session_status':      { family: 'remote',   effect: 'read',  class: 'forbidden', category: 'scripts',   targetPolicy: 'none',              requiresIdentityCheck: false, demo: false },
} as const satisfies Readonly<Record<CapabilityName, CapabilityMeta>>;

export type PrivilegedCapability = {
  [N in CapabilityName]: (typeof CAPABILITIES)[N]['class'] extends 'approval_required' ? N : never;
}[CapabilityName];

/** Entrées et sorties des capacités de la démo (les autres s'ajoutent avec leur connecteur). */
export interface CapabilityIO {
  'ticket.create':        { params: { title: string; body: string; category: string; priority: 'low' | 'normal' | 'high' | 'urgent'; requesterRef: string; diagnosticSummary?: string; parentRef?: string }; result: { ref: string; url: string } };
  'ticket.get':           { params: { ref: string }; result: TicketView };
  'ticket.search':        { params: { query: string; limit?: number }; result: TicketView[] };
  'ticket.comment':       { params: { ref: string; body: string; internal: boolean }; result: { ok: true } };
  'ticket.link_parent':   { params: { parentRef: string; childRef: string }; result: { ok: true } };
  'ticket.update_status': { params: { ref: string; status: 'solved' | 'closed' | 'pending' }; result: { ok: true } };
  'kb.search':            { params: { query: string; limit?: number }; result: { chunkId: string; documentId: string; text: string; score: number }[] };
  'user.diagnose':        { params: { userRef: string }; result: UserDiagnosis };
  'tenant.service_health':{ params: Record<string, never>; result: ServiceHealth[] };
  'user.reset_password':  { params: { userRef: string }; result: { ok: true; temporaryPasswordDeliveredTo: 'technician' } };
  'user.unlock':          { params: { userRef: string }; result: { ok: true } };
  'user.revoke_sessions': { params: { userRef: string }; result: { ok: true } };
  'user.mfa_reregister':  { params: { userRef: string }; result: { ok: true } };
  'alert.ingest':         { params: { alert: NormalizedAlertInput }; result: { alertId: string; deduplicated: boolean } };
  'alert.list_active':    { params: { assetRef?: string }; result: NormalizedAlert[] };
}

export type DemoCapability = keyof CapabilityIO;

export interface TicketView { ref: string; url: string; title: string; status: string; category?: string; updatedAt: string }
export interface UserDiagnosis {
  accountEnabled: boolean; locked: boolean;
  mfaMethods: { type: string; createdAt: string }[];
  lastPasswordChangeAt?: string;
  recentFailedSignIns: number;
  hasPrivilegedRole: boolean;
}
export interface ServiceHealth { service: string; status: 'operational' | 'degraded' | 'incident'; summary?: string; url?: string }

export interface InvocationContext {
  readonly orgId: string;
  readonly connectorId: string;
  readonly requestId: string;
  /** Qui agit. L'agent n'a jamais de jeton d'administration. */
  readonly actor:
    | { kind: 'agent'; conversationId: string }
    | { kind: 'system'; reason: 'cron' | 'webhook' | 'automation' }
    | { kind: 'human'; userId: string; delegatedToken: string; viaDelegationId?: string };
  readonly actionRequestId?: string;
  readonly idempotencyKey?: string;
}

export interface ConnectorHealth { ok: boolean; checkedAt: string; detail?: string }

export interface Connector {
  readonly id: string;
  readonly type: 'glpi' | 'm365' | 'demo';
  /** Un connecteur de niveau 1 doit être qualifié « test » ou « production » par l'administrateur du client (menace M22). */
  readonly environment: 'test' | 'production';
  capabilities(): ReadonlySet<CapabilityName>;
  invokeCapability<N extends DemoCapability>(
    name: N, params: CapabilityIO[N]['params'], ctx: InvocationContext,
  ): Promise<CapabilityIO[N]['result']>;
  health(ctx: InvocationContext): Promise<ConnectorHealth>;
}
```

**Règles du contrat.**
- Une capacité de classe `approval_required` n'est **jamais** appelée par l'agent : il crée une `action_request` (§ 9). Une organisation peut **durcir** une classe, jamais l'assouplir.
- `targetPolicy: 'self_only'` : la cible est l'utilisateur authentifié **de la conversation**, jamais une valeur lue dans un message, un ticket ou une alerte.
- Un nouveau connecteur déclare ses capacités et fournit ses tests ; il ne modifie ni l'orchestrateur ni le registre, sauf pour passer une capacité de `forbidden` à sa vraie classe, ce qui exige une revue de sécurité (mise à jour du modèle de menace).
- Le connecteur « démo » implémente le même contrat avec des données fictives et **aucun accès réseau**.

**Mise en œuvre (J3.4).** `capabilities/types.ts` reprend ce contrat à l'identique, avec les types `AutonomousCapability` et `PrivilegedCapability` **dérivés** du tableau (un oubli ne compile pas). `capabilities/call.ts` est la porte unique : `assertCapabilityAllowed` refuse par défaut (nom inconnu ou fabriqué, capacité du backlog, classe effective autre que « autonomous », cible hors de l'utilisateur de la conversation, organisation gelée, accès d'assistance en écriture), puis `callCapability` appelle le connecteur et journalise l'appel **sans ses paramètres**. Le test parcourt **les 31 capacités** du contrat : seules les 10 autonomes de la démo atteignent le connecteur. `capabilities/registry.ts` choisit le connecteur actif de l'organisation ; les connecteurs s'y enregistrent en J4. Le durcissement de classe par organisation (« une organisation peut durcir une classe ») est implémenté dans le code mais **non stocké** : le schéma n'a pas de table pour cela (backlog B10).

## 8. Schéma de données

Les migrations sont écrites en J2 ; **chacune doit être appliquée par le fondateur** (signalé à chaque fois). Toute table a la RLS activée dans sa migration. Les fonctions de contrôle : `is_member_of(org)`, `has_role(org, role)`, `org_has_feature(org, feature)`, `partner_can_access(client_org, min_role)` (relation **et** assignation actives, évaluées à la lecture), `recent_mfa(max_age_seconds)`.

| Groupe | Table | Contenu clé | Lecture | Écriture |
|---|---|---|---|---|
| **Organisations** | `organizations` | `type` (`platform`, `partner`, `client`), nom, `slug`, état, `labels`, `plan`, `autonomy_default`, `branding`, `created_via_partner_id` (ESN créatrice, pour la facturation) | membres ; ESN via `partner_can_access` | `admin` (MFA récent) |
| | `memberships` | utilisateur, organisation, **rôle** (les 10 rôles), état | soi-même ; `org_admin` et `partner_admin` de l'organisation | `admin` |
| | `plan_features` | fonctionnalités par offre (jamais de test d'offre en dur dans le code ni le SQL) | tous les connectés | migration |
| | `directory_users` | salariés importés : e-mail, nom, service, e-mail du manager, source (`csv`, `entra`) | `org_admin` ; techniciens assignés | `admin` (import audité) |
| **Accès** | `partner_relationships` | ESN, client, **rôles approuvés**, état (`active`, `reduced`, `suspended`, `revoked`, `expired`), `created_by_partner`, `confirmed_at`, `expires_at` (12 mois maximum), `revoked_at` | les deux parties | création par l'ESN ; confirmation, réduction et **révocation par le client seul** |
| | `partner_assignments` | relation, technicien, rôle, `starts_at`, `ends_at`, `revoked_at` | `partner_admin`, le technicien, `org_admin` du client | `partner_admin` |
| | `support_access_grants` | client, demandeur, **motif**, approbateur (≠ demandeur), `ends_at` (4 h par défaut), `revoked_at`, `scope = read_only` | `org_admin` du client, demandeur | demande : `super_admin` ; approbation : client |
| | `invitations` | organisation, e-mail, rôle fixé, `token_hash`, `expires_at`, `used_at` | `org_admin` / `partner_admin` | `admin` |
| | `access_reviews` | période, éléments, décisions | `org_admin`, `partner_admin` | idem (P1) |
| **Support** | `conversations` | organisation, salarié, canal, catégorie, état, `relief_active`, résumé | techniciens assignés ; le salarié pour les siennes | `chat` |
| | `messages` | contenu **masqué**, rôle (`user`, `assistant`, `technician`), **`visibility`** (`public`, `technician`), modèle et version du prompt | idem, **le salarié ne lit que `public`** | `chat` |
| | `tickets` | miroir local : connecteur, référence externe, parent, catégorie, priorité, état, échéance de SLA lue dans GLPI | techniciens assignés, `org_admin` | `chat`, automatisations |
| | `incidents` | titre, gravité, état, ticket parent, alertes et conversations rattachées | idem | automatisations |
| **Connaissance** | `kb_documents` | titre, source, `status` (`draft`, `validated`), version, empreinte | membres | `admin` (publication par un humain) |
| | `kb_chunks` | `org_id`, texte, `embedding vector(1024)` avec index **HNSW** | via `match_kb_chunks` seulement | `admin` |
| **Relève** | `relief_schedules` | plages d'absence ou de nuit, technicien, récurrence | membres | `org_admin`, `partner_admin` |
| | `handover_reports` | période, technicien, contenu, lu le | le technicien concerné, `org_admin` | `cron` |
| **Connecteurs** | `connectors` | type, **`environment`** (`test`, `production`), état, config **non secrète**, `vault_secret_id`, qualifié par, dernière synchronisation | `org_admin`, `partner_admin` ; **jamais les secrets** | `admin` |
| **Alertes** | `alert_sources` | type (`webhook`, `api_poll`), secret (Vault), **table des gravités**, intervalle attendu, dernier signe de vie | `org_admin`, `partner_admin` | idem |
| | `maintenance_windows` | source ou actif, début, fin, motif | idem | idem |
| | `alerts` | format normalisé (§ 11), `dedup_key`, état, **`attachment_status`** (`attached`, `unattached`), `raw` (donnée, jamais exécutée) | techniciens assignés, `org_admin` | `alerts-ingest` |
| | `alert_events` | historique des changements d'état | idem | idem |
| | `asset_links` | motif d'actif (hôte, service) vers **catégorie** de demande et site : c'est ce qui permet de rapprocher une alerte des demandes. Sans lien, l'alerte reste « non rattachée » | `org_admin`, `partner_admin` | idem |
| **Actions** | `action_requests` | capacité, cible, paramètres, **`params_hash`**, état (§ 9.1), vérification d'identité, valideur effectif, délégation utilisée, `idempotency_key`, expiration | techniciens concernés, demandeur | `chat` (création), `actions` (transitions) |
| | `autonomy_settings` | organisation, catégorie d'action, **niveau** (0 ou 1 ; le 2 n'existe pas), modifié par ; **la base refuse le niveau 1 sans second facteur vérifié** au moment du changement | `org_admin`, `partner_admin` | `admin` (MFA récent) |
| | `microsoft_identities` | organisation, technicien, connecteur, **locataire, identifiant d'objet, nom d'utilisateur** du compte Microsoft lié, dates de liaison, d'usage et de révocation. **Aucun jeton, aucun secret** | le technicien, `org_admin` | `admin` |
| | `approval_policies` | catégorie, **chaîne ordonnée** de valideurs, délai | `org_admin`, `partner_admin` | `org_admin` |
| | `approval_delegations` | délégant, délégué, catégories, début, fin (**≤ 30 jours**, contrainte de base), MFA au moment de la création, révocation | parties, `org_admin` | `admin` (MFA récent) |
| **Automatisations** | `automation_rules` | déclencheur, conditions, action, **niveau d'autonomie**, plafonds, `dry_run`, version | `org_admin`, `partner_admin` | `org_admin` (MFA récent) |
| | `automation_runs` | règle, déclencheur, décision, résultat, lien vers l'`action_request` | idem | moteur |
| **Qualité** | `response_ratings` | message, catégorie, **note** (`correct`, `partial`, `wrong`, `dangerous`), motif, technicien, date. **Insertion seule** | `org_admin`, `partner_admin`, techniciens | techniciens assignés |
| | `category_gates` | organisation, catégorie, **état** (`shadow`, `direct`, `advice_only`), dernière décision, effectifs | `org_admin`, `partner_admin` | moteur de décision (§ 10.4) ; ouverture validée par un humain |
| **Revendeur** | `partner_pricing` | ESN, client, palier, **prix partenaire**, **prix client**, devise | **`partner_admin` et `super_admin` seulement** | `partner_admin` (prix client) |
| | `monthly_reports` | ESN, client, période, état (`draft`, `reviewed`, `sent`), contenu, marque appliquée | `partner_admin`, `org_admin` (sans marge) | `reports` |
| **Pilotage** | `llm_usage` | organisation, modèle, jetons, délai, coût estimé | `partner_admin`, `org_admin` (agrégé) | `chat` |
| **Audit** | `audit_logs` | acteur, **pour le compte de**, événement, objet, détails masqués, identifiant de requête. **INSERT seulement**, aucun droit de modification ni de suppression, même pour `service_role` | `org_admin` ; `super_admin` : événements de plateforme | `serviceClient` uniquement |

**Rôles dans le schéma (10)** : `super_admin`, `platform_support`, `partner_admin`, `partner_manager`, `partner_technician`, `org_admin`, `org_technician`, `org_viewer`, `auditor`, `end_user`. Cinq sont actifs en démo (§ 3).

**Conservation (propositions, à valider en J7).** Conversations et réponses de l'IA : 90 jours, durée réglable par organisation ; charges brutes d'alerte : 30 jours ; notes de qualité et décisions de catégorie : durée du contrat ; journal d'audit : 12 mois minimum (la CNIL recommande 6 mois à 1 an pour les traces d'accès). Une purge planifiée supprime les conversations échues.

**Secrets.** Clés des connecteurs et secrets de webhook dans Supabase Vault ; jamais dans une colonne, jamais renvoyés au navigateur, jamais dans un prompt ni un journal.

## 9. Le circuit des actions de niveau 1

C'est le point qui fera accepter ou refuser Relève par une DSI (`docs/07` § 4). Principe : **l'IA prépare, un humain nommé valide, l'action s'exécute avec l'identité de cet humain.**

### 9.1 États d'une `action_request`

```mermaid
stateDiagram-v2
  [*] --> pending_approval: l'agent prépare l'action (cible = salarié de la conversation)
  pending_approval --> approved: un valideur éligible valide (empreinte + vérification d'identité)
  pending_approval --> rejected: refus (motif)
  pending_approval --> expired: délai dépassé, rien n'est exécuté
  pending_approval --> cancelled: annulée (gel de l'organisation, départ du demandeur)
  approved --> executing: exécution unique (transition atomique)
  executing --> succeeded
  executing --> failed: échec connu, jamais rejoué seul
  executing --> unknown: issue incertaine (arrêt en cours d'exécution), vérification humaine
  succeeded --> [*]
  failed --> [*]
  unknown --> [*]
  rejected --> [*]
  expired --> [*]
  cancelled --> [*]
```

Seule la fonction `actions` fait avancer les états ; chaque transition écrit une ligne d'audit. **Une action `unknown` ou `failed` n'est jamais relancée automatiquement** (menace M13) : un humain vérifie puis crée une nouvelle demande.

### 9.2 Empreinte et idempotence (menaces M12, M13)

- À la création, la demande est figée : capacité, organisation, cible, paramètres. `params_hash = SHA-256(organisation, capacité, cible, paramètres en JSON canonique à clés triées)`.
- L'écran de validation affiche **le contenu stocké** ; la validation envoie l'empreinte vue ; le serveur refuse si elle diffère de l'empreinte stockée. Après approbation, seul l'état change.
- `idempotency_key` unique par (organisation, capacité, cible, empreinte) tant qu'une demande est ouverte : un double clic ou une relance ne crée pas deux exécutions.
- Le passage `approved` vers `executing` est une écriture conditionnelle (`WHERE status = 'approved'`) : au plus une exécution.

### 9.3 Vérification d'identité hors bande (non négociable)

Le chat **n'authentifie jamais** une action sur un compte : la réponse d'une personne dans la conversation ne vaut pas preuve. Dans la démo, la vérification est faite **par le valideur** avant de valider, par un canal différent de la conversation :

| Méthode | Ce que fait le valideur |
|---|---|
| `callback` | Rappelle le salarié au numéro de l'**annuaire** (jamais celui donné dans le chat) |
| `manager_confirmation` | Obtient la confirmation du responsable par un canal connu |
| `in_person` | Constate l'identité sur place |

La validation est **impossible côté serveur** tant qu'une méthode n'est pas enregistrée (valideur, heure). Un code envoyé automatiquement au responsable est un **P1**.

### 9.4 Demande suspecte : refus dans le chat

Règles **déterministes**, évaluées par le code (jamais par le modèle) sur `UserDiagnosis` et la demande. Seuils de départ, à calibrer :

| Règle | Condition | Effet |
|---|---|---|
| X1 | Le compte cible a un **rôle à privilèges** | Aucune action préparée ; escalade humaine systématique |
| X2 | Méthode MFA ajoutée ou mot de passe changé depuis **moins de 24 h** | Suspecte |
| X3 | **10 échecs de connexion ou plus** récents | Suspecte |
| X4 | **2 demandes** de réinitialisation sur la même cible en 24 h | Suspecte |
| X5 | La cible n'est pas l'utilisateur authentifié de la conversation (« pour mon collègue ») | Refus : la politique `self_only` l'interdit |

**Effet d'une demande suspecte :** l'agent répond d'une façon neutre (« je ne peux pas traiter cette demande ici, un technicien va vous contacter »), sans dire quelle règle a joué ; un ticket de sécurité de priorité haute est créé avec le contexte ; l'astreinte est prévenue ; l'événement est audité. La réponse est identique que le compte existe ou non. **Décision du fondateur (16 novembre 2026, J3) :** pour ne donner **aucun indice** sur l'état du compte (MFA récente, échecs de connexion, répétition), le salarié reçoit **exactement la même réponse** (même texte, même résultat) pour toute demande d'action sur un compte, qu'elle soit ordinaire ou jugée suspecte ; le message neutre ci-dessus reste réservé à la détection de manipulation du modèle. Le caractère suspect n'existe que dans le ticket de sécurité (priorité haute) visible des techniciens. Test SEC-11.

### 9.5 Chaîne de valideurs et suppléance

Pour une demande de catégorie *C* dans l'organisation *O*, les valideurs éligibles sont évalués dans cet ordre (`approval_policies`) :

1. le technicien **d'astreinte** selon les plannings de relève ;
2. ses **suppléants** (délégations actives couvrant *C*), puis les suivants de la chaîne ;
3. en dernier recours, **l'ESN**, seulement si la chaîne le prévoit **et** si la relation et l'assignation sont actives.

Un valideur est éligible si : membre assigné de *O* avec la capacité de valider *C* ; ni le demandeur ni la cible (invariant I2) ; la relation ESN-client et son assignation actives **à cet instant** (R3, R4). Après le délai d'un niveau (15 minutes par défaut), le niveau suivant est notifié. **Si personne ne valide**, la demande reste `pending_approval`, l'utilisateur est prévenu du délai, le ticket est escaladé, **rien ne s'exécute** (I8). Une demande expire au bout de 24 heures par défaut.

Les 12 invariants de suppléance (`docs/threat-model.md` § 5) sont des **critères d'acceptation** de J2, J3 et J6.

### 9.6 Exécution avec l'identité du valideur

- Au moment de valider, la console demande au valideur une **authentification Microsoft** (fenêtre de connexion, silencieuse si la session existe) pour obtenir un jeton **délégué** aux permissions limitées aux quatre actions. Le jeton est **transmis une fois, utilisé dans la même requête, jamais stocké**. L'exécution a donc lieu pendant la validation : les contrôles d'éligibilité et de délégation sont revérifiés à cet instant (I5).
- Les permissions déléguées sont limitées par les rôles Entra du valideur lui-même : une escalade de privilège passant par Relève est impossible par construction. **Aucune permission d'application en écriture** (menace M05). Liste des permissions : `docs/permissions-graph.md` (J4), une par une, avec revue de minimisation.
- Si le valideur n'a pas les droits suffisants, l'action **échoue sans repli** sur un autre compte.
- **Connecter son compte Microsoft (histoire T12).** Le fondateur a demandé de pouvoir « connecter le compte admin Office afin d'effectuer les actions ». Réponse : chaque technicien valideur connecte **son propre** compte d'administration (une fois), et non un compte commun. Relève ne garde ni mot de passe ni jeton : la table `microsoft_identities` mémorise seulement quel compte Microsoft (locataire, identifiant d'objet, nom d'utilisateur) appartient à quel technicien. À chaque validation, la console redemande un jeton délégué, utilisé dans la même requête, et la fonction `actions` vérifie que l'identifiant d'objet du jeton est **celui du compte lié** à ce technicien. Un compte partagé ou une permission d'application en écriture auraient permis à l'IA, ou à quiconque lui parle, d'agir avec des droits que personne n'a validés : c'est exactement ce que le modèle de menace interdit (M05, I1). Un compte lié à un autre locataire que celui du connecteur est refusé par la base.
- Le journal indique : qui a demandé, qui a validé, par quelle délégation, quelle vérification d'identité, quel résultat.

### 9.7 Niveau d'autonomie, arrêt d'urgence

- Niveau par catégorie d'action et par organisation : **0** (l'agent guide, ne prépare aucune action) ou **1** (il prépare des `action_request`). Défaut : 0. Le niveau 2 n'existe pas.
- Passer au niveau 1 exige : une session réauthentifiée par MFA, un connecteur Microsoft 365 marqué `test` ou `production` par l'administrateur du client, la relation activée par le client (§ 4.6).
- **Arrêt d'urgence** : l'administrateur du client, l'administrateur ESN ou le super administrateur peut « geler » une organisation : toutes les catégories passent en conseil seul, les demandes en attente sont annulées, rien ne s'exécute. Vérifié par `chat` et `actions` à chaque requête (ANSSI, principe 6).

**Mise en œuvre (J3.7 et J3.8).** `_shared/actions/` et la fonction `actions` (porte HTTP : `requireOrgMember` limité aux rôles `partner_technician` et `org_technician`, corps borné à 20 Ko, opérations `approve`, `execute`, `reject`). Le salarié, l'administrateur et l'IA n'ont aucune route vers l'exécution.
- **Préparation** (`prepare.ts`, appelée par l'orchestrateur, jamais par le modèle) : dans l'ordre, organisation non gelée, action connue (liste fermée du tri, `requested_action` ajouté au prompt de tri : `triage@v2`), client activé, **niveau d'autonomie 1 pour la catégorie** (sinon rien n'est préparé : « niveau 0 »), salarié retrouvé dans l'annuaire (la cible est toujours l'utilisateur de la conversation, X5), diagnostic en lecture, règles X1 à X4 (`risk.ts`, seuils figés par un test), puis insertion. Un compte à privilèges (X1) n'obtient aucune action ; X2 à X4 donnent une réponse neutre et un ticket de sécurité (§ 9.4). Le salarié reçoit seulement « un technicien va traiter votre demande » : il ne voit ni l'action, ni l'empreinte, ni la règle qui a joué.
- **Validation** (`approve.ts`) : second facteur de moins de 10 minutes (`aal2`), empreinte vue par le valideur égale à l'empreinte stockée (M12), **contrôle préalable du jeton Microsoft avant d'approuver** (une approbation ne reste pas sans suite si le jeton est faux), puis approbation et exécution dans la même requête. La base refuse en plus l'auto-validation et exige la vérification d'identité attribuée au valideur lui-même (§ 9.3).
- **Exécution** (`execute.ts`, seul fichier avec `callCapability` autorisé à appeler un connecteur pour une action privilégiée) : l'action doit être « approuvée », non expirée, de l'organisation de la requête, portée par **la même empreinte** qu'à l'approbation, et exécutée **par le valideur nommé**. Le jeton Microsoft doit appartenir au compte lié à ce valideur (locataire et identifiant d'objet ; la signature n'est pas revérifiée ici : Microsoft Graph la vérifie à l'appel et refuse un jeton qui n'est pas le bon). Passage à « en cours » par mise à jour conditionnelle : **deux requêtes simultanées n'obtiennent jamais deux exécutions**. Une issue **incertaine** (délai dépassé, réponse illisible) est enregistrée « incertaine » et **n'est jamais rejouée automatiquement** : un technicien vérifie l'état du compte d'abord. Le résultat du connecteur est masqué et borné à 8 Ko avant stockage ; le jeton n'est ni stocké, ni journalisé, ni renvoyé.
- **Refus** : motifs fermés (mauvaise cible, mauvais périmètre, identité non confirmée, autre) ; l'état et l'organisation sont vérifiés dans la même écriture.
- **Reste à faire hors de ce bloc :** notification de la chaîne de valideurs et de l'utilisateur (J4 pour les canaux, J5 pour la console), écran de validation (J5). L'expiration des demandes en attente est déjà assurée côté base par la tâche planifiée `releve-expire`. Le contrôle déterministe hors du modèle et l'arrêt d'urgence s'appuient sur [ANSSI, *Les essentiels : Sécuriser un système IA agentique*, V1.0 (10/26)](https://messervices.cyber.gouv.fr/documents-guides/anssi_essentiels_ia_agentique_1.0.pdf), déjà référencé dans `docs/securite-code-et-ci.md`.

## 10. L'orchestrateur, le mode ombre et la mesure de la qualité

### 10.1 Traitement d'un message du salarié (`chat`)

1. **Authentification et organisation** (`requireUser`, `requireOrgMember`) ; vérification que l'organisation n'est pas gelée.
2. **Limitation de débit** par utilisateur et par organisation, puis **file d'attente avec reprise progressive** : l'offre gratuite de Mistral limite à environ 1 requête par seconde. Si l'attente dépasse un seuil (10 secondes par défaut), l'utilisateur reçoit « je transmets à un technicien » plutôt qu'une attente indéfinie. Priorité : conversation interactive avant tâches de fond.
3. **Masquage** des secrets avant stockage et avant envoi au modèle.
4. **Tri** par le modèle léger (Mistral Small) : intention (question, panne, demande d'action sur un compte, autre), catégorie, urgence, indice de manipulation.
5. **Recherche** dans la base de connaissance de l'organisation (`match_kb_chunks`, filtrée par organisation à l'intérieur de la fonction).
6. **Réponse** par le modèle moyen (Mistral Medium), prompt système **statique**, données encadrées par `wrapExternal`, appels d'outils limités aux capacités `autonomous` via `callCapability`.
7. **Contrôle de sortie** : pas d'image ni de lien externe, détection de secret et de fuite d'instructions.
8. **Porte de catégorie** (§ 10.2) : selon l'état, la réponse part à l'utilisateur ou reste visible du seul technicien.
9. **Si le modèle ne sait pas** : ticket qualifié (catégorie, priorité, diagnostic déjà fait, ce que l'utilisateur a essayé) et passage à un humain.
10. **Audit** de chaque appel : modèle, version du prompt, jetons, délai, identifiants.

**Ajouts de J5 (widget du salarié).** (a) **Quand un technicien a la main** (état « avec un technicien »), un nouveau message du salarié est enregistré pour lui et **l'IA se tait** : aucun appel au modèle, aucune réponse automatique au milieu d'un échange humain. (b) **« Parler à un technicien »** depuis l'accueil envoie le premier message **directement à un humain**, masqué, avec ticket et copie GLPI, **sans aucun appel au modèle**. (c) La même fonction `chat` porte les opérations du widget, toutes bornées aux demandes du salarié et sans modèle : `context`, `list`, `get` (messages publics seulement), `escalate` (idempotente ; une demande résolue est **rouverte** et ne compte plus comme résolue), `confirm` (« oui » : résolue **par Relève** si l'IA a répondu en dernier, **par un humain** sinon ; « non » : un technicien reprend), `rate` (1 à 5, une fois résolue). Débit propre : 60 par minute et par salarié, 1 200 par organisation. Une demande sur un compte se lit **exactement pareil** pour le salarié, ordinaire ou suspecte (même état, même carte « en attente d'un technicien »).

La couche LLM est une interface (`LlmProvider`) : Mistral par défaut ; modèles par rôle (tri, réponse) réglés par configuration ; un autre fournisseur se branche sans toucher l'orchestrateur.

**Mise en œuvre (J3.2).** `_shared/llm/` : `types.ts` (contrat, **sans rôle « system »** dans les messages), `prompt_registry.ts` (le prompt système est un `StaticPrompt` enregistré : la passerelle refuse tout autre texte), `mistral.ts` (fournisseur), `gateway.ts` (validation, cadence de 1,1 s, deux priorités, échéance de 10 s pour une conversation, reprises à délai croissant, disjoncteur), `usage.ts` (`llm_usage` et audit `llm.call`, sans aucun contenu). Variables d'environnement : `MISTRAL_API_KEY` (obligatoire, par le formulaire sécurisé), `MISTRAL_BASE_URL` (facultative, **https vers mistral.ai seulement**), `MISTRAL_MODEL_TRIAGE`, `MISTRAL_MODEL_ANSWER`, `MISTRAL_MODEL_EMBED`. Les noms de modèles par défaut (`mistral-small-latest`, `mistral-medium-latest`, `mistral-embed`) et les tarifs (`PriceTable`, vide par défaut : coût 0 tant qu'un tarif n'est pas renseigné) sont **à confirmer sur la grille officielle de Mistral avant J6** ; le nom du modèle réellement utilisé est enregistré à chaque appel. Contrat de l'API vérifié dans [la documentation de Mistral](https://docs.mistral.ai/api/endpoint/chat) le 15 novembre 2026 ; elle ne documente pas d'en-tête `Retry-After`, d'où le délai croissant par défaut. Limite assumée : la file d'attente vit dans une instance de la fonction ; plusieurs instances se partagent le quota du fournisseur sans se coordonner.

**Fonction `chat` (J3.5).** `chat/index.ts` (porte HTTP : méthode, corps borné à 20 Ko, `requireOrgMember` limité au rôle salarié, puis l'orchestrateur) et `_shared/chat/` : `orchestrator.ts` (les dix étapes ci-dessus), `store.ts` (accès à la base, toujours filtré par organisation et demandeur), `texts.ts` (messages fixes), `ports.ts`. **Ce que fait le code, et que le modèle ne décide jamais :** masquage avant stockage et avant tout envoi ; message du salarié enregistré en premier ; arrêt d'urgence sans appel au modèle ; manipulation (modèle OU indices déterministes) = réponse neutre identique et ticket de sécurité ; action sur un compte = jamais dans le chat ; **aucune fiche trouvée = l'IA ne tente pas de répondre** ; sortie rejetée si sa forme, ses sources ou les garde-fous ne passent pas ; **mode ombre : le salarié ne reçoit qu'un message fixe, le technicien reçoit le brouillon à noter et un ticket** ; échec de la porte ou refus de la base = mode ombre ; échec d'une étape = un technicien reprend. La fonction `cron` (`?job=kb-index`) calcule les vecteurs des fiches (`_shared/kb/index.ts`), car les fiches de démonstration n'en ont pas. **Pas encore fait :** réponse en flux (J5, avec le widget), limitation de débit (faite en 3.10, voir plus bas), préparation d'une `action_request` (3.8), connecteur de ticketing externe (J4 : le ticket est local), textes en anglais (J5). Le seuil de similarité (0,5) est provisoire : à calibrer sur le jeu réel (J6).

**Prompts, encadrement et garde-fous (J3.3).** `llm/prompts.ts` : deux prompts statiques versionnés (tri `triage@v1`, réponse `reponse@v1`), sans donnée ni secret, qui demandent une **sortie JSON** validée champ par champ (`llm/schemas.ts` : catégorie, intention, urgence, indicateur de manipulation ; réponse, « je sais », « j'escalade », sources limitées aux fiches fournies ; tout doute = rejet, donc passage à un technicien). `llm/wrap.ts` : `wrapExternal` retire les caractères invisibles, masque secrets et données personnelles, neutralise les chevrons, borne la taille et encadre la donnée par une balise à identifiant aléatoire. `llm/guards.ts` : `injectionSignals` (signal d'entrée, pas une barrière) et `checkOutput` (bloque image, HTML, lien hors liste, secret, **fausse action annoncée**, **demande de secret**, **fuite d'instructions**, réponse trop longue). La réponse bloquée n'atteint jamais le salarié : elle reste visible du technicien. Les jeux de test contiennent 18 attaques et 14 demandes ordinaires (zéro faux positif attendu) ; ce ne sont pas des garanties, ils s'enrichiront en J6 avec `promptfoo` et le jeu réel.

### 10.2 Les catégories et leur état

Catégories de la démo (alignées sur les 20 fiches de connaissance) : `password`, `mfa`, `vpn`, `printer`, `outlook`, `teams`, `onedrive`, `slow_pc`, `onboarding`, `offboarding`, `other`.

| État (`category_gates`) | Ce que reçoit le salarié | Ce que voit le technicien |
|---|---|---|
| `shadow` (état initial) | Message fixe : un technicien va répondre, délai habituel. **Aucun texte de l'IA** | La réponse préparée, à noter |
| `direct` | La réponse de l'IA | La réponse, notable |
| `advice_only` (après retour arrière ou réduction manuelle) | Comme `shadow` | Comme `shadow`, avec le motif du retour arrière |

L'IA est toujours présentée comme telle. L'ouverture d'une catégorie (`shadow` ou `advice_only` vers `direct`) est une décision **humaine** de l'administrateur du client (avec MFA), sur recommandation affichée par le système.

### 10.3 Notation par les techniciens

Chaque réponse préparée porte quatre boutons : **Correcte**, **Partielle**, **Fausse**, **Dangereuse**, et un motif en un clic. Moins de 5 secondes, sinon elle ne sera pas faite. Les motifs d'un **refus d'action** sont : mauvaise cible, mauvais périmètre, identité non confirmée, autre.

### 10.4 Barres de passage et retour arrière automatique

Barres proposées, **par catégorie**, à calibrer avec les pilotes (`docs/11` § 2) :

| Indicateur | Barre avant `direct` |
|---|---|
| Correcte et utile | 80 % ou plus |
| Fausse mais affirmée avec assurance | 2 % ou moins |
| Dangereuse | **zéro** |
| Escalade justifiée | 90 % ou plus |
| Escalade manquée | 3 % ou moins |
| « Je ne sais pas » à propos | 95 % ou plus |
| Niveau 1 : actions préparées avec la bonne cible | **100 %** sur au moins 50 actions, **aucune** exécution sur le mauvais compte |

**Règles de calcul (décidées par le code, sur les notes brutes, jamais par le modèle) :**

- Un pourcentage n'est affiché qu'**avec son effectif** et son intervalle d'incertitude. Avec moins de 300 notes dans une catégorie, l'état est « données insuffisantes » : le système **ne recommande pas** l'ouverture, même si le taux observé est bon.
- **Retour arrière immédiat** : une note « Dangereuse » remet la catégorie en `advice_only`, notifie l'administrateur du client et l'ESN, et ouvre une analyse.
- **Retour arrière hebdomadaire** : sur 7 jours, si le taux de réponses fausses dépasse la barre avec au moins 20 notes (seuil à calibrer, pour éviter de basculer sur du bruit), la catégorie repasse en `advice_only`.
- Les notes sont **non modifiables**, rattachées à un technicien assigné (menace M36).

### 10.5 Écran « Qualité de Relève »

Visible de l'ESN et de l'administrateur client. Par catégorie : état, effectif, taux avec intervalle, indicateurs du tableau ci-dessus, dernier retour arrière et son motif, comparaison des modèles testés (qualité, coût, délai). **Les mauvais chiffres sont affichés comme les bons.**

## 11. Les alertes

Toute alerte entre par un **format normalisé** quelle que soit la source. L'IA les lit et les croise avec les demandes ; **elle n'agit jamais sur la foi du contenu d'une alerte, qui est une donnée** (menaces M01, M16, M35).

```ts
export type AlertSeverity = 'information' | 'warning' | 'major' | 'critical';
export type AlertState = 'open' | 'acknowledged' | 'resolved';

export interface NormalizedAlertInput {
  sourceId: string;
  dedupKey: string;                       // clé de déduplication (source + actif + contrôle)
  asset: { kind: 'host' | 'service' | 'unknown'; name: string; site?: string };
  severity: AlertSeverity;                // après application de la table des gravités de la source
  state: AlertState;
  summary: string;                        // texte libre : DONNÉE, tronquée, jamais une instruction
  occurredAt: string;                     // ISO 8601
  originUrl?: string;                     // lien vers l'alerte d'origine
  raw: unknown;                           // charge brute conservée pour l'audit, jamais exécutée ni interprétée
}

export interface NormalizedAlert extends NormalizedAlertInput {
  id: string;
  orgId: string;
  attachment: 'attached' | 'unattached';  // rattachée à une catégorie via asset_links, sinon « non rattachée »
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  incidentId?: string;
}
```

### 11.1 Les quatre voies d'entrée

| Voie | Sources couvertes | Sécurité | Quand |
|---|---|---|---|
| **Webhook entrant signé** | Toute source capable d'appeler une URL (Zabbix, Centreon, PRTG, Checkmk, Nagios via script, RMM, outils de sauvegarde...) | URL unique par source ; signature HMAC ; horodatage anti-rejeu ; limitation de débit | **Démo** |
| **Interrogation d'API** | État des services Microsoft 365 (`ServiceHealth.Read.All`), toutes les 5 minutes | Lecture seule | **Démo** (état des services) |
| **E-mail vers alerte** | Outils qui ne savent qu'envoyer un e-mail | SPF et DKIM vérifiés ; contenu = donnée | Après la démo |
| **Relais Relève** | Syslog, traps SNMP, réseau local | Connexion sortante uniquement | Après le premier client payant |

**Ce que « toutes les sources » veut dire :** toute source capable d'émettre par l'une de ces voies. Un outil qui ne sait ni appeler une URL ni envoyer un e-mail attend le relais. **La compatibilité de chaque outil se vérifie à son ajout** (test d'envoi et revue du mapping).

### 11.2 Webhook : contrat

- Adresse : `/functions/v1/alerts-ingest/<source_id>` ; en-têtes `X-Releve-Timestamp` (secondes) et `X-Releve-Signature: sha256=<hex>` (HMAC-SHA-256 de `horodatage + "." + corps` avec le secret de la source).
- Refusé : signature invalide, horodatage à plus de 5 minutes, corps de plus de 64 Ko, source inconnue ou désactivée. La réponse est la même pour une source inconnue et une signature fausse.
- Le mapping des champs de la source vers le format normalisé est de la **configuration** (chemins simples), pas du code : `asset`, `severity`, `state`, `summary`, `dedup`.

### 11.3 Garde-fous de qualité (dans la démo)

| Problème | Parade |
|---|---|
| Rafale d'alertes lors d'une panne | Regroupement par actif et par fenêtre de temps ; un seul incident |
| Alerte qui s'allume et s'éteint | Délai de confirmation (3 minutes par défaut, ou 2 événements) avant d'ouvrir un incident |
| Même alerte répétée | Déduplication par `dedupKey` ; compteur et dernier signe de vie |
| Maintenance planifiée | `maintenance_windows` : alerte conservée, ni incident ni message aux utilisateurs |
| Alerte sans rattachement | Statut « non rattachée », **visible et jamais jetée** |
| Gravités différentes selon les outils | Table de correspondance par source, modifiable par un administrateur (audit) |
| Source muette | Tâche planifiée : si aucun signe depuis 3 fois l'intervalle attendu, alerte « silence anormal » de gravité majeure |
| Texte d'alerte piégé | Seuls les champs normalisés sont transmis au modèle ; `summary` est tronqué (500 caractères), encadré par `wrapExternal`, sans effet sur les appels d'outils |

### 11.4 Limite honnête

La qualité du rapprochement entre une alerte et les demandes dépend de `asset_links` : sans lien entre l'actif et une catégorie ou un site, l'alerte reste « non rattachée » et aucune corrélation n'est tentée.

## 12. Le moteur d'automatisations

Des **règles déclaratives**, évaluées par un moteur déterministe. Le modèle de langage ne décide jamais si une action est exécutée ; il peut seulement rédiger du texte destiné à un humain, jamais l'envoyer lui-même à partir de contenu externe.

```ts
export type TriggerKind =
  | 'alert.opened' | 'alert.resolved' | 'alert.source_silent'
  | 'conversation.message' | 'm365.service_degraded';

export interface Condition { field: string; op: 'eq' | 'neq' | 'gte' | 'lte' | 'in' | 'exists'; value?: string | number | string[] }

export type RuleActionKind =        // ensemble FERMÉ : ajouter une action = modifier le moteur et le modèle de menace
  | 'group_into_incident' | 'notify_users' | 'notify_oncall' | 'propose_close_children'
  | 'create_security_ticket' | 'suppress';

export interface AutomationRule {
  id: string;
  version: number;
  name: string;
  enabled: boolean;
  /** Simulation : décision journalisée dans automation_runs, aucun effet. À utiliser avant d'activer. */
  dryRun: boolean;
  /** 0 : informe et prépare. 1 : peut créer une action_request (jamais l'exécuter). */
  autonomy: 0 | 1;
  /** Règle système : ne peut être ni supprimée ni désactivée (protège contre l'ingénierie sociale). */
  locked?: boolean;
  trigger: { kind: TriggerKind };
  all: Condition[];                 // toutes les conditions
  any?: Condition[];                // au moins une, si présent
  action: { kind: RuleActionKind; params: Record<string, string | number> };
  /** Protection contre les tempêtes (menace M21). */
  limits: { maxRunsPerHour: number; maxItemsPerRun: number; cooldownMinutes: number };
}
```

**Garanties du moteur.** Les conditions portent sur un contexte typé fixe, pas sur du code ni sur des gabarits issus de contenu externe ; les messages aux utilisateurs viennent de **gabarits fixes** dont les variables sont des champs typés échappés ; une règle d'autonomie 1 ne crée que des `action_request` ; les `limits` sont appliquées avant tout effet ; chaque exécution est auditée, y compris en simulation.

**Règles livrées dans la démo**

| Règle | Déclencheur | Ce qu'elle fait | Prio |
|---|---|---|---|
| `incident-grouped` | Alerte ouverte de gravité majeure ou critique, rattachée à une catégorie, et au moins 2 conversations de cette catégorie en 15 minutes | Crée l'incident et **un ticket parent** dans GLPI, rattache les demandes, répond aux utilisateurs (gabarit), prévient l'astreinte | P0 |
| `incident-resolved` | Alerte résolue | Prévient les utilisateurs rattachés (gabarit) et **propose** la clôture des tickets enfants : une `action_request` `ticket.update_status` à valider | P0 |
| `suspicious-reset` | Demande de réinitialisation jugée suspecte (§ 9.4) | Pas d'action ; ticket de sécurité de priorité haute ; prévient l'astreinte. **Règle verrouillée** | P0 |
| `source-silent` | Source d'alertes muette | Alerte « silence anormal » et prévient l'astreinte | P0 |
| `m365-outage` | Service Microsoft 365 dégradé et au moins 2 conversations des catégories `outlook`, `teams` ou `onedrive` | Répond que la panne vient de Microsoft (lien vers l'incident), aucun ticket inutile, suivi jusqu'au rétablissement | P1 |

Pas d'écran d'édition des règles en démo : elles sont livrées en configuration, et l'administrateur du client ou de l'ESN peut les activer, les mettre en simulation ou les désactiver (sauf les règles verrouillées) par l'API d'administration. Un écran « Automatisations » est au backlog.

## 13. L'ESN revendeur

Le produit doit servir l'ESN autant que le client final (`docs/11` § 3). Dans la démo :

| Besoin | Réponse |
|---|---|
| **Gagner de l'argent** | `partner_pricing` : l'ESN voit le **prix partenaire** (prix public moins la remise par paliers de 25, 30, 35 %, seuils à fixer), saisit **son prix client**, et voit sa **marge** par client et au total. La facturation elle-même est hors démo ; l'écran présente un calcul à partir des prix saisis |
| **Garder son client** | Un client créé par l'ESN lui reste rattaché. Relève n'envoie **aucun message commercial** aux administrateurs ni aux salariés de ses clients (messages transactionnels seulement) |
| **Prouver sa valeur** | **Rapport mensuel** à son logo et ses couleurs : chiffres du mois avec effectifs, incidents, ce que l'équipe et Relève ont traité, qualité, et un bloc **« prochaine étape »** (pistes calculées par règles : demandes en dehors des heures de relève, catégorie prête à l'ouverture, absences répétées). États : brouillon, relu, envoyé ; un clic pour envoyer. **Sans la marge ni le prix partenaire** |
| **Savoir qui contacter** | **Tableau d'opportunités** : clients sans relève active, pilotes qui se terminent dans 30 jours, clients ayant connu au moins 3 absences dans le trimestre |
| **Marque blanche** | Logo, couleurs et nom dans l'interface et les rapports, **sans mention « propulsé par Relève »** ; le domaine d'expéditeur personnalisé (SPF, DKIM, DMARC vérifiés) est P1. Relève reste nommé comme sous-traitant dans les contrats (hors interface) |
| **Activer en moins d'une journée** | Parcours de création de client en 4 étapes : client, GLPI, salariés, plannings (§ 4.6) |

**Honnêteté des chiffres.** Toute valeur de « temps gagné » est affichée comme une **estimation avec sa méthode** (nombre de demandes résolues par Relève et confirmées, multiplié par la durée médiane de traitement d'une demande de même catégorie lue dans GLPI) ; sans durée disponible, aucun chiffre n'est affiché. Aucun pourcentage sans son effectif.

## 14. Sécurité : exigences testables

Aucune fonctionnalité n'est « finie » sans ses tests de sécurité. Chaque ligne relie une exigence à une menace de `docs/threat-model.md` et à un jalon où elle est testée. Les lignes marquées **fait** existent déjà (J0).

| Test | Exigence | Menace | Jalons |
|---|---|---|---|
| SEC-01 | Deux clients d'une même ESN ne se voient pas ; l'ESN voit les deux (assignés) | M03 | J2, J6 |
| SEC-02 | Un technicien non assigné, à assignation expirée, ou dont la relation est révoquée, ne voit **rien** | M28, R3, R4 | J2, J6 |
| SEC-03 | Le super administrateur ne voit rien sans accès d'assistance actif ; expiré = rien ; jamais en écriture | M30, R5 | J2, J6 |
| SEC-04 | Changer l'organisation dans le corps, un en-tête ou le jeton ne donne aucun accès | M27, R1 | **fait J3** |
| SEC-05 | Élévation de rôle par invitation : rôle supérieur, réutilisation, expiration, adresse différente | M29, R6 | J2, **fait J3**, J6 |
| SEC-06 | Délégation : auto-délégation, sans MFA récent, plus de 30 jours, hors périmètre, expirée, révoquée entre validation et exécution | M09, I1 à I12 | J2, **fait J3**, J6 |
| SEC-07 | Auto-validation impossible (demandeur ou cible = valideur) | I2 | **fait J3** |
| SEC-08 | Modifier l'action après validation est refusé (empreinte) | M12 | **fait J3** |
| SEC-09 | Double clic, relance, arrêt en cours d'exécution : au plus une exécution, jamais de rejeu automatique | M13 | **fait J3** |
| SEC-10 | Sans valideur dans le délai, rien ne s'exécute et l'utilisateur est prévenu | I8 | J3 **partiel** : rien ne s'exécute (fait) ; la notification de l'utilisateur attend J4/J5 (B14) |
| SEC-11 | Les règles X1 à X5 refusent dans le chat avec une réponse identique que le compte existe ou non | M02 | **fait J3** (réponse strictement identique), J6 |
| SEC-12 | La validation est impossible côté serveur sans vérification d'identité enregistrée | M02 | **fait J3** |
| SEC-13 | 20 tentatives d'injection (message, ticket, fiche, alerte, nom de fichier) échouent toutes | M01 | J6 |
| SEC-14 | Le prompt système n'est pas divulgué | M07 | J6 |
| SEC-15 | Aucun contenu externe dans le prompt système | M01 | **fait** (Semgrep), **fait J3** (test de bout en bout) |
| SEC-16 | Aucun secret dans un journal : règle statique **et** test d'exécution qui injecte un secret et fouille journaux et audit | M04 | **fait** (Semgrep), **fait J3** (test de bout en bout) |
| SEC-17 | Webhook : signature fausse, rejeu, corps trop gros, source inconnue ou désactivée | M16 | **fait J4** |
| SEC-18 | Une alerte contenant une instruction n'a aucun effet | M01, M35 | **fait J4** (moteur, gabarits) ; J6 (jeu d'essai large, quand l'IA lira les alertes) |
| SEC-19 | Mode ombre : aucune réponse de l'IA n'atteint le salarié tant que la catégorie n'est pas `direct` (RLS **et** fonction d'envoi) | M36 | **fait J3**, J6 |
| SEC-20 | Une note « Dangereuse » remet la catégorie en `advice_only` | M36 | **fait J3** |
| SEC-21 | Le prix partenaire et la marge sont invisibles du client (tables, vues, rapports, exports) | M37 | J2, J5 |
| SEC-22 | Marque blanche : logo piégé assaini, expéditeur non vérifié refusé | M38 | J5 |
| SEC-23 | En-têtes, CSP et CORS du widget (audit et test) ; aucun jeton dans `localStorage` | M15 | **en grande partie J5.2** (CORS par liste blanche exacte ; CSP stricte vérifiée dans un vrai navigateur, une seule exception `style-src-elem` pour le dialogue accessible ; jeton d'accès en mémoire, jeton de rafraîchissement dans un cookie `__Host-` HttpOnly ; tests `cors`, `session.test.ts`, `supabase.test.ts`) ; audit final J5.8 |
| SEC-24 | Limitation de débit et file d'attente tiennent sous charge ; repli « je transmets à un technicien » | M10 | **fait J3** |
| SEC-25 | Aucune donnée réelle de pilote dans le dépôt | M34 | **fait** |
| SEC-26 | Tableaux de bord et exports : pas de contenu de conversation hors des clients assignés | M33 | J5, J6 |
| SEC-27 | `audit_logs` : modification et suppression refusées, même pour `service_role` | M18 | J2 |
| SEC-28 | Organisation gelée : aucune action, demandes en attente annulées | § 9.7 | **fait J3** |
| SEC-29 | Création de client par l'ESN : MFA, plafond, notification, rattachement sans accord refusé | M31 | **fait J3**, J2 |
| SEC-30 | Avant activation par l'administrateur du client : aucune action de niveau 1, connexion Microsoft 365 refusée | § 1 | **fait J3 et J4** (connexion Microsoft 365, règles d'autonomie 1) |
| SEC-31 | Niveau 1 refusé sur un connecteur non qualifié `test` ou `production` | M22 | **fait J3** (base, valable pour les connecteurs de J4) |
| SEC-32 | Flux OAuth Microsoft : PKCE, état, portée minimale, consentement vérifié | M05 | **en partie J4** (portée minimale justifiée, aucune écriture par l'application, jeton du technicien vérifié par Microsoft et rattaché au tenant, consentement visible au test de connexion) ; PKCE et état : J5 (console) |
| SEC-33 | Une session sans second facteur (code reçu par e-mail : boîte mail d'un technicien compromise) ne lit ni n'écrit rien directement dans la base, et ne passe aucune opération d'un rôle autre que salarié | M15, M04 | **fait J5** (migration 16 : politique restrictive « second facteur » sur chaque table ; `requireOrgMember` refuse tout rôle autre que salarié en aal1 ; tests 93 et `auth.test.ts`, 4 mutations SQL) |

## 15. Indicateurs de succès

Définitions de `docs/10` § 6, sans sigle à l'écran. **Aucun pourcentage sans son effectif.**

| Indicateur | Définition | Cible de la démo | Type |
|---|---|---|---|
| Délai de première réponse | Entre la demande et la première réponse utile (IA ou humain) | Premier mot de l'IA en moins de 2 s ; à mesurer pour les humains | Avancé |
| Réponses notées | Réponses préparées notées par un technicien ÷ réponses préparées | 90 % ou plus en mode ombre | Avancé |
| Catégories à données suffisantes | Catégories avec au moins 300 notes | À suivre, aucune cible | Avancé |
| Résolution par Relève | Demandes résolues par Relève **et confirmées par l'utilisateur** ÷ demandes | 30 % ou plus sur les catégories ouvertes (fin d'un pilote de 8 semaines) | Retardé |
| Satisfaction | Note donnée à la clôture | 4 sur 5 ou plus | Retardé |
| Escalade justifiée / manquée | Voir § 10.4 | 90 % ou plus / 3 % ou moins | Retardé |
| Actions de niveau 1 | Bonne cible, mauvais compte | 100 % sur 50 actions, zéro mauvais compte | Retardé |
| Activation d'un client | Création du client jusqu'à la première conversation | Moins d'une journée | Avancé |
| Satisfaction des techniciens | Enquête courte après le pilote | À mesurer (`docs/03` § 5) | Retardé |

## 16. Découpage en commits, jalon par jalon

Un jalon est une série de commits suivie d'un arrêt pour votre validation. **Chaque migration est signalée : c'est vous qui l'appliquez.** Les skills de sécurité sont cités dans les messages de commit concernés.

**J2 : base de données (livré)** (skills : `supabase`, `implementing-gdpr-data-protection-controls`, `testing-for-broken-access-control`, `implementing-aes-encryption-for-data-at-rest`, `securing-agentic-ai-tool-invocation`)

Le découpage prévu en 15 migrations a été regroupé en **10 migrations** par domaine, puis une 11e et une 12e sont venues avec J3 (une migration d'une table à la fois n'aurait servi à rien : elles s'appliquent ensemble). **Chacune est appliquée par vous**, dans l'ordre des noms de fichier.

| # | Migration | Contenu |
|---|---|---|
| 1 | `20261106100100_fondations` | Extensions, schéma `private` (non exposé), familles et rangs de rôles, masquage des secrets, horodatage |
| 2 | `20261106100200_acces_et_audit` | Journal d'audit en insertion seule ; organisations typées ; appartenances ; annuaire ; relations ESN-client ; assignations ; accès d'assistance ; invitations ; revues d'accès ; fonctions `is_member_of`, `has_role`, `partner_can_access`, `recent_mfa` |
| 3 | `20261106100300_support_et_connecteurs` | Connecteurs (secrets dans Vault) ; conversations ; messages avec visibilité ; tickets ; incidents |
| 4 | `20261106100400_connaissance` | Fiches, morceaux, index HNSW, `match_kb_chunks` filtrée par organisation, fiches validées par un humain seulement |
| 5 | `20261106100500_releve` | Plannings de relève, rapports de passation |
| 6 | `20261106100600_alertes` | Sources, fenêtres de maintenance, `asset_links`, alertes dédupliquées, événements |
| 7 | `20261106100700_actions` | Niveaux d'autonomie, chaînes de valideurs, délégations, `action_requests` (empreinte calculée par la base), compte Microsoft du valideur, départ d'un technicien |
| 8 | `20261106100800_automatisations_et_qualite` | Règles et exécutions, notes (insertion seule), portes de catégorie, mode ombre imposé par la base, retour arrière automatique, barres de passage |
| 9 | `20261106100900_revendeur_et_usage` | Prix partenaire et marge (invisibles du client), rapports mensuels, usage du modèle |
| 10 | `20261106101000_conservation` | Purge planifiable (conversations, charges d'alerte), expirations |
| 11 | `20261106101100_contexte_de_requete` | **Jalon J3.** `resolve_access` (rôle et voie d'accès d'un utilisateur dans une organisation, règles de la base) ; acteur et identifiant de requête dans le journal d'audit pour les écritures des Edge Functions (en-têtes posés par `serviceClient`, honorés seulement pour le rôle `service_role`) |
| 12 | `20261106101200_droits_explicites_du_service` | **Jalon J3.** Droits du service sur les tables, **explicites** : indispensables sur un projet où l'option « Automatically expose new tables » est désactivée (recommandée par Supabase, futur défaut des nouveaux projets) ; sans effet visible sur le projet actuel. Le journal d'audit reste en insertion seule |
| 13 | `20261106101300_administration_et_debit` | **Jalon J3.** Fonctions SQL d'administration atomiques, appelables par le service seulement et qui re-vérifient elles-mêmes qui agit : création d'un client (organisation, relation active et invitation en une transaction, second facteur récent, plafond de clients), acceptation d'une invitation, arrêt d'urgence (gel et annulation des demandes en attente), départ d'un technicien ; plafond de clients par ESN (`organizations.client_cap`, 10 par défaut, **provisoire**) ; limitation de débit (`rate_limits`, `rate_limit_hit`) |
| 14 | `20261106101400_secrets_et_webhooks` | **Jalon J4.** Accès du **service** aux secrets du coffre (connecteurs, sources d'alertes), par des fonctions publiques minces qui re-vérifient l'organisation et ne sont appelables ni par le navigateur ni par l'anonyme ; source de webhook retrouvée par son identifiant (active, avec secret, organisation non suspendue : sinon résultat vide identique) ; table `webhook_deliveries` et `webhook_first_delivery` contre le rejeu. Le script de vérification attend désormais **38 tables** |
| 15 | `20261106101500_ingestion_des_alertes` | **Jalon J4.** Réception d'une alerte en UNE transaction (`alert_ingest` : rejeu, déduplication, rattachement, maintenance, anti-battement, résolution, silence), confirmation à l'échéance, regroupement en incident (`incident_group`, idempotent) et fin d'incident (`incident_close_out` : gabarit, propositions de clôture à valider), astreinte (`notify_oncall`, tables `notifications` et `incident_conversations` sous RLS), plafonds des règles (`automation_claim`, `automation_note`), règle « fin d'incident » limitée à l'incident résolu. Tout est réservé au service. Le script de vérification attend désormais **40 tables** |
| 16 | `20261106101600_second_facteur_obligatoire` | **Jalon J5 (revue de sécurité).** Supabase envoie un code de connexion à toute adresse déjà connue qui le demande : une boîte mail de technicien compromise donnait une session **sans second facteur** qui pouvait lire les données de support. Chaque table de `public` reçoit une politique **restrictive** qui exige `aal2` ; le salarié (connexion par code) ne lit plus rien directement, la fonction `chat` lit pour lui, bornée à ses demandes. Les opérations « qui restreignent » (geler, révoquer, revenir au niveau 0) n'exigent toujours pas de **nouvelle** vérification (l'urgence prime), mais une session ouverte avec second facteur. Le script de vérification contrôle désormais la présence de cette politique sur chaque table (contrôle 2.7) |
| 17 | `20261106101700_widget_salarie` | **Jalon J5.** Lectures du widget salarié par des fonctions **réservées au service** et bornées au couple (organisation, demandeur) : `widget_context` (nom, couleur, prénom, fin de la relève en cours en enchaînant les créneaux, incidents majeurs ou critiques **sans leur titre**), `widget_requests`, `widget_conversation` (messages **publics** seulement, prénom du technicien, jamais son adresse). Connexion du salarié : `widget_public_org` (nom et couleur avant connexion), `widget_code_allowed` (adresse active de l'annuaire, **vérifiée avant l'envoi du code**, refusée pour une personne du personnel), `widget_employee_link` (rattachement idempotent, adresse lue dans le compte et jamais dans la requête). Un salarié désactivé ou retiré de l'annuaire perd aussitôt l'accès (appartenance suspendue). Le script de vérification contrôle les droits de ces fonctions (9.6, 9.7) |
| 18 | `20261106101800_tableaux_de_bord` | **Jalon J5.** Chiffres des tableaux de bord, **sans aucun contenu** (SEC-26) : `dashboard_org_summary` (état du support sur une fenêtre, médianes de première réponse utile et de résolution avec leur effectif, satisfaction, et pour chaque catégorie la porte, les notes des 90 jours et les barres de passage), lisible par qui lit la configuration du client ; `dashboard_partner_clients` (une ligne par client en relation vivante : incidents, majeurs, actions à valider, attente d'un technicien, SLA en danger, connecteurs en erreur, relève, absences, prix et marge), réservé à l'administrateur et au responsable de compte de l'ESN pour les clients dont la relation approuve leur rôle. Second facteur exigé dans les deux. Script de vérification : contrôle 9.8 |

| # | Commit livré |
|---|---|
| 2.A | Migrations 1 et 2 + banc d'essai local et script d'isolation |
| 2.B | Migrations 3 à 6 |
| 2.C | Migration 7 + 70 vérifications du circuit des actions + test de mutation reproductible |
| 2.D | Migrations 8 à 10 + tests ; test de mutation étendu à **33 défenses** |
| 2.E | Données de démonstration synthétiques (1 ESN, 2 clients, 22 fiches) + leur test d'isolation |
| 2.F | Workflow GitHub « Base de données » (tests à chaque envoi, mutations avant fusion et chaque semaine) |

**Résultat** : 277 vérifications sur un PostgreSQL 16 jetable avec pgvector ; **33 mutations sur 33** détectées par le test prévu pour elles (on casse une défense dans une copie, le bon test doit échouer).

**J3 : orchestrateur** (skills : `defending-llms-with-guardrails`, `securing-agentic-ai-tool-invocation`, `implementing-llm-guardrails-for-security`, `detecting-indirect-prompt-injection`, `testing-for-system-prompt-leakage`, `performing-serverless-function-security-review`, `implementing-api-rate-limiting-and-throttling`)

| # | Commit |
|---|---|
| 3.1 | `_shared` : `auth`, `db`, `log`, `redact`, erreurs (avec tests) |
| 3.2 | Couche LLM : interface, Mistral, file d'attente et reprise, `llm_usage` |
| 3.3 | Prompts statiques, `wrapExternal`, garde-fous d'entrée et de sortie |
| 3.4 | Registre des capacités, `callCapability` |
| 3.5 | Fonction `chat` : streaming, RAG, triage, ticket qualifié, « je ne sais pas » |
| 3.6 | Portes de catégorie, mode ombre, notes, retour arrière |
| 3.7 | Machine à états des actions, empreinte, idempotence |
| 3.8 | Chaîne de valideurs, délégations, `executeApprovedAction`, vérification d'identité, règles X1 à X5 |
| 3.9 | Fonction `admin` : organisations, invitations, relations, assignations, accès d'assistance, MFA récent, arrêt d'urgence |
| 3.10 | Limitation de débit |
| 3.11 | Tests de sécurité (SEC-04, 07 à 12, 15, 16, 19, 20, 24, 28 à 31) et revue de sécurité des fonctions |

**J4 : connecteurs et automatisations, périmètre A** (skills : `performing-oauth-scope-minimization-review`, `implementing-api-key-security-controls`, `configuring-oauth2-authorization-flow`, `testing-oauth2-implementation-flaws`, `detecting-suspicious-oauth-application-consent`, `implementing-just-in-time-access-provisioning`)

| # | Commit |
|---|---|
| 4.1 | `docker/glpi` et connecteur GLPI |
| 4.2 | Connecteur « démo » (sans accès réseau) |
| 4.3 | Microsoft 365 : diagnostic, état des services ; `docs/permissions-graph.md` |
| 4.4 | Microsoft 365 niveau 1 : « Connecter mon compte Microsoft » (T12), quatre actions en flux délégué ; vérification que l'identifiant d'objet du jeton est celui du compte lié |
| 4.5 | `alerts-ingest` : webhook signé, normalisation, mapping |
| 4.6 | Déduplication, regroupement, anti-battement, maintenance, « non rattachée », silence |
| 4.7 | Moteur d'automatisations et règles livrées |
| 4.8 | Tests de sécurité (SEC-17, 18, 30 à 32) |

**J5 : interface** (skills : `ui-ux-pro-max`, `impeccable`, `dataviz`, `design-taste-frontend`, `accessibility-review`, `responsive-mobile-first-react`, `design-critique`, `ux-review`, `performing-security-headers-audit`, `testing-cors-misconfiguration`)

| # | Commit |
|---|---|
| 5.1 | Système de design « Signal », tokens, thèmes, i18n |
| 5.2 | Passerelle de session (fonctions Pages), en-têtes et CSP |
| 5.3 | Widget salarié |
| 5.4 | Console technicien : file, notation, validation, incident, passation, suppléance |
| 5.5 | Écran ESN : clients, zoom, création de client, assignations, revenu, opportunités |
| 5.6 | Écran administrateur client : accès, valideurs, connecteurs, niveau d'autonomie |
| 5.7 | « Qualité de Relève » et rapport mensuel à la marque de l'ESN |
| 5.8 | Accessibilité (RGAA, WCAG 2.2 AA), détecteur `impeccable` jusqu'à zéro alerte, critique de design |
| 5.9 | Audit des en-têtes et du CORS (SEC-21 à 23, 26) |

**J6 : évaluation et sécurité**, **J7 : conformité et exploitation**, **J8 : mise en ligne** : découpés à l'entrée de chaque jalon, selon `docs/backlog.md`.

### Dépendances externes : ce dont j'ai besoin de vous, et quand

| Quand | Quoi |
|---|---|
| Avant J2 | Un **projet Supabase** (plan gratuit, région UE, Paris si possible) ; vous appliquerez les migrations |
| Avant J3 | Un **compte Mistral** (offre Experiment, entraînement désactivé sur vos données), clé fournie par le formulaire sécurisé de l'environnement, jamais dans le chat |
| Avant J4 | Le **tenant Microsoft 365 de test** avec comptes dédiés (dont au moins un compte technicien avec un rôle d'administration limité), puis une **application Entra** (étapes pas à pas fournies) |
| Pendant J4 | Un **GLPI** local (je fournis le `docker-compose`) |
| Avant J5 | Un **service d'envoi d'e-mails** (SMTP) pour les codes de connexion, les invitations et les rapports : le SMTP intégré de Supabase est limité à quelques e-mails par heure et prévu pour des tests (à vérifier dans sa documentation) |
| Dès que possible | L'**envoi du modèle de demande** à 2 ou 3 pilotes : le jeu réel prend des semaines à obtenir |

## 17. Questions ouvertes et hypothèses à valider

**Bloquantes avant le premier pilote réel (pas pour la démo)**

| ID | Question | Qui | Proposition par défaut |
|---|---|---|---|
| Q1 | **Comment l'identité du technicien d'une ESN agit-elle dans le tenant Microsoft 365 d'un client ?** L'exécution « avec l'identité du valideur » suppose qu'il possède des droits dans ce tenant : relation d'administration déléguée (GDAP, Partner Center) ou compte dans le tenant du client. Dans la démo, tout est dans **un seul tenant de test**. **Réponse du fondateur (6 novembre) :** il faut pouvoir connecter le compte d'administration Office pour effectuer les actions → **fait côté base (T12, § 9.6)** : chaque technicien lie son propre compte, sans compte partagé ni jeton stocké. **Reste ouvert, avant le premier pilote réel :** quel type de compte l'ESN utilisera dans le tenant d'un client (GDAP ou compte dans le tenant) | Fondateur, avec l'ESN pilote | Étudier GDAP avant J4 ; `docs/10` § 3.1 exclut les comptes invités créés à la main |
| Q2 | Que signifie **« débloquer » un compte** dans Entra ID ? Le verrouillage intelligent d'Entra expire seul. **Décision du fondateur (6 novembre) : « ok » à la proposition** → `user.unlock` = **réactiver un compte désactivé** ; l'attente d'un verrouillage temporaire n'est pas une action. Se finalise en J4 avec le tenant de test | Technique, J4 | Appliquée ; les permissions exactes sont revues une à une dans `docs/permissions-graph.md` |

**À confirmer pour la démo (non bloquantes, j'avance avec la proposition)**

| ID | Question | Proposition par défaut |
|---|---|---|
| Q3 | Le **canal Teams** (Bot Framework) est hors démo : confirmez-vous ? | Oui : widget web seulement (page hébergée) |
| Q4 | Le **client direct** (DSI sans ESN) est accepté par le schéma mais non détaillé ; son `org_admin` ne valide pas d'actions faute de rôle `org_technician` | Oui, au backlog avec les rôles restants |
| Q5 | **Session du widget** : page hébergée en démo, iframe en P1 (cookies tiers bloqués) | Oui |
| Q6 | Valeurs par défaut : MFA « récent » = 10 min ; invitation = 7 jours ; accès d'assistance = 4 h ; délai par niveau de validation = 15 min ; expiration d'une demande = 24 h ; confirmation d'une alerte = 3 min | Oui, réglables ensuite |
| Q7 | **Catégories** de la démo : les 11 du § 10.2 (alignées sur les 20 fiches) | Oui ; la correspondance avec les catégories GLPI d'un client est au backlog |
| Q8 | **Conservation** : conversations 90 jours, charges d'alerte 30 jours, audit 12 mois | À valider en J7 avec un juriste |
| Q9 | **Version de l'API GLPI** : REST v1 ou API v2 de GLPI 11 | À décider en J4 sur l'image Docker retenue |
| Q10 | Rapport mensuel : HTML imprimable en PDF (P0), PDF généré côté serveur (P1) | Oui |
| Q11 | **Fournisseur d'e-mails** gratuit et situé dans l'UE pour les codes, invitations et rapports | Une offre gratuite d'un fournisseur européen, par exemple français (Brevo) : limites et conditions à vérifier avant de s'engager |
| Q12 | **Hébergement des écrans et de la passerelle de session** : Cloudflare Pages (prévu au J1) ou un hébergeur français (Scaleway, Clever Cloud, OVHcloud). La passerelle voit les adresses, les codes et les jetons : un hébergeur de droit français évite tout transfert hors UE | Un hébergeur français, avec le serveur Node fourni (`app/server/node.ts`) ; Cloudflare reste possible sans changer le code. À décider avant J8 |

## 18. Hors périmètre, rappel

Tout ce qui n'est pas dans ce document est dans `docs/backlog.md` (backlog ordonné, `docs/11` § 1). Y figurent notamment : Jira, iTop, Zabbix, Centreon et leurs `docker-compose` ; les connecteurs RMM, remote et supervision supplémentaires ; les boîtes mail, licences, arrivées et départs ; l'e-mail vers alerte et le relais Relève ; le kit de vente de l'ESN ; les écrans plateforme, direction, auditeur et salarié complet ; la panne localisée et les automatisations de prévention. **Le schéma et le contrat des capacités les accueillent déjà** (§ 7, § 8) : les ajouter ne demande ni refonte ni migration destructive.
