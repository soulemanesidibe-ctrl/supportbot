# 07 · Intégrations, automatisations et validation des actions

> Objectif fixé par le fondateur (technicien support) : un agent **le plus complet possible**, branché sur tout l'outillage réel d'une ESN ou d'une DSI, avec un maximum d'outils **dès le pilote**. Ce document décrit comment y arriver sans que la sécurité ni le calendrier n'explosent.

## 1. Principe : des connecteurs par capacité, pas par outil

L'agent ne connaît pas « GLPI » ou « NinjaOne ». Il connaît des **capacités** (créer un ticket, lire l'état d'un compte, trouver le poste d'un utilisateur…). Chaque connecteur déclare celles qu'il sait faire. Ajouter un outil revient à écrire un adaptateur, sans toucher au cerveau de l'agent.

| Famille | Capacités (contrat commun) |
|---|---|
| **Ticketing** | `ticket.create`, `ticket.get`, `ticket.search`, `ticket.comment`, `ticket.update_status`, `ticket.assign`, `ticket.link_parent`, `kb.search` |
| **Identité et messagerie** (Microsoft 365, Entra ID, AD) | `user.diagnose` (compte bloqué, MFA, licences, échecs de connexion), `user.reset_password`, `user.unlock`, `user.revoke_sessions`, `user.mfa_reregister`, `mailbox.diagnose`, `mailbox.grant_shared_access`, `mailbox.set_auto_reply`, `mailbox.set_forwarding`, `license.assign`, `group.add_member`, `user.onboard`, `user.offboard`, `tenant.service_health`, `tenant.license_usage` |
| **RMM et parc** | `device.find_by_user`, `device.health` (disque, RAM, services, dernier redémarrage), `device.patch_status`, `device.backup_status`, `script.run` (liste blanche uniquement) |
| **Prise en main à distance** | `remote.create_session` (lien d'invitation pour l'utilisateur, attribué au technicien), `remote.session_status` |
| **Supervision** | `alert.ingest` (webhook entrant), `alert.list_active`, `alert.acknowledge`, `host.status` |
| **Canaux** | Microsoft Teams, widget web, e-mail ; téléphone plus tard |

## 2. Catalogue et périmètre du pilote

> **Mise à jour du 6 novembre 2026 :** la première version est recentrée sur une démo resserrée (GLPI, Microsoft 365, webhook de supervision, incident regroupé, suppléance, trois écrans). Le périmètre détaillé et l'ordre du backlog sont dans `docs/11-demo-resserree-et-fiabilite.md`, qui **prime** sur les lots A et B ci-dessous. Ces tableaux restent le catalogue complet des connecteurs visés.

Décision du fondateur : **tout ce qui peut entrer dans le pilote y entre**. Pour ne pas retarder la première démonstration, le pilote est découpé en deux lots.

- **Lot A, démonstrable en 6 à 8 semaines** : ce qui se teste gratuitement et sans dépendre d'un tiers.
- **Lot B, branché pendant le pilote** : ce qui dépend d'un accès fourni par un client pilote ou d'un essai gratuit limité dans le temps (à déclencher au bon moment pour ne pas qu'il expire avant la démo).

### Ticketing

| Outil | API | Pilote | Comment on le teste |
|---|---|---|---|
| **GLPI** | REST (v1, et API v2 dans GLPI 11) | **Lot A** | Docker local |
| **Jira Service Management** | REST Cloud, bien documentée | **Lot A** | Offre gratuite Atlassian |
| **iTop** (Combodo, français) | REST/JSON | **Lot A** | Docker local (open source) |
| **TeamsWork Ticketing As A Service** (utilisé par un pilote) | « Ticketing API » annoncée par l'éditeur, non documentée publiquement ; édition UE disponible | **Lot B** | Demander la documentation à l'éditeur via le pilote ; en attendant, passerelle Power Automate (webhook HTTP) |
| **Freshservice** / **Zendesk** | REST, bien documentées | **Lot B** | Essais gratuits (2 à 3 semaines) à ouvrir juste avant les démos |
| **EasyVista** | REST | Après le pilote | Nécessite un partenariat éditeur |

### Microsoft 365, Entra ID, Active Directory

**Tenant de test : celui de la société du fondateur.** Créer des comptes de test dédiés, jamais agir sur de vrais comptes de collaborateurs pendant le développement.

| Cible | Moyen | Pilote |
|---|---|---|
| **Diagnostic** (compte, MFA, licences, connexions, boîte mail) | Microsoft Graph, lecture | **Lot A** |
| **État des services Microsoft 365** | Graph `ServiceHealth.Read.All` (permission minimale confirmée par Microsoft) | **Lot A** |
| **Mot de passe, MFA, déblocage, révocation de sessions** | Graph, **niveau 1 : validation d'un technicien**, sur le tenant de test puis chez un pilote volontaire | **Lot A** |
| **Boîtes mail** (accès partagé, réponse automatique, transfert) | Graph et Exchange Online, niveau 1 | **Lot B** |
| **Comptes, licences, groupes, arrivées et départs** | Graph, niveau 1, procédures configurables par client | **Lot B** |
| **Active Directory local** | Relais Relève installé chez le client (§ 5) | Après le pilote |

Les permissions Graph exactes sont à confirmer action par action dans la documentation Microsoft (skill `performing-oauth-scope-minimization-review`).

### RMM et prise en main à distance

| Outil | Remarque | Pilote |
|---|---|---|
| **RG System** (groupe Septeo, **français**, hébergé en France) | Un client du fondateur l'utilise : lui demander l'accès à l'API et à sa documentation (ou passer par Septeo en tant que partenaire) | **Lot B** |
| **NinjaOne** | API publique complète (appareils, scripts, alertes) | **Lot B** si un pilote l'utilise, sinon essai gratuit |
| **Atera** | API publique (agents, alertes, tickets) | **Lot B** si un pilote l'utilise, sinon essai gratuit |
| **ScreenConnect** | Création de session via API ou extension | **Lot B** si un pilote l'utilise |
| **Splashtop**, **TeamViewer**, **AnyDesk**, **Datto RMM** | API selon licence | Après le pilote |
| **RustDesk**, **MeshCentral** | Open source, auto-hébergeables | Après le pilote (testables gratuitement si un client le demande) |

### Supervision

Il n'existe pas d'étude de parts de marché fiable pour la France ; les comparatifs citent le plus souvent Zabbix, Centreon, PRTG, Checkmk et Nagios.

| Outil | Intégration | Pilote |
|---|---|---|
| **Webhook générique** | Toute alerte envoyée sur une URL, quel que soit l'outil (Checkmk et Nagios inclus) | **Lot A** |
| **Zabbix** | API JSON-RPC, médias webhook | **Lot A** (Docker) |
| **Centreon** (français) | API REST, notifications | **Lot A** (édition open source en Docker) |
| **PRTG** | API HTTP, notifications | **Lot B** (version gratuite limitée à 100 capteurs, Windows uniquement) |
| **Alertes des RMM** (RG System, NinjaOne, Atera) | Même contrat `alert.ingest` | **Lot B** |

## 3. Automatisations : ce qui fait de Relève plus qu'un chatbot

Relève voit en même temps les **demandes des utilisateurs**, les **alertes de supervision**, l'**état du parc** (RMM) et l'**état des comptes** (Microsoft 365). En croisant ces sources, il traite des situations qu'aucun outil seul ne voit. Chaque automatisation a un niveau d'autonomie (0 : il informe et prépare ; 1 : il agit après validation humaine).

### 3.1 Incidents et pannes

| Automatisation | Déclencheur croisé | Ce que fait Relève | Pilote |
|---|---|---|---|
| **Incident majeur regroupé** | Alerte supervision + plusieurs demandes similaires en quelques minutes | Un seul ticket parent, demandes rattachées, réponse aux utilisateurs, alerte à l'astreinte | Lot A |
| **Panne Microsoft 365 côté Microsoft** | État des services Graph dégradé + demandes « Teams / Outlook ne marche pas » | Répond que la panne vient de Microsoft, lien vers l'incident, aucun ticket inutile, suivi jusqu'au rétablissement | Lot A |
| **Panne localisée** | Plusieurs demandes d'un même site ou d'un même étage (imprimante, Wi-Fi, VPN) | Regroupe par lieu, propose un incident de site | Lot A |
| **Fin d'incident annoncée** | Alerte de supervision résolue | Prévient tous les utilisateurs rattachés et clôt les tickets enfants après confirmation | Lot A |

### 3.2 Prévention (avant que l'utilisateur appelle)

| Automatisation | Déclencheur | Ce que fait Relève | Pilote |
|---|---|---|---|
| **Disque presque plein** | RMM : disque au-delà de 90 % | Ticket préventif, propose le script de nettoyage de la liste blanche (niveau 1) | Lot B |
| **Sauvegarde en échec** | RMM ou outil de sauvegarde : échec répété | Ticket prioritaire au technicien, jamais d'action automatique | Lot B |
| **Certificat ou domaine bientôt expiré** | Supervision : expiration sous 30 jours | Ticket préventif avec la date et le service concerné | Lot A |
| **Licences presque épuisées** | Graph : licences disponibles sous un seuil | Alerte au responsable avant l'arrivée d'un nouveau salarié | Lot A |
| **Mots de passe qui vont expirer** | Graph ou AD : expiration sous 7 jours | Message préventif aux utilisateurs concernés avec la marche à suivre | Lot A |
| **Mises à jour en échec** | RMM : patchs non installés sur plusieurs postes | Regroupe les postes, prépare le ticket pour le technicien | Lot B |
| **Consommables** | Supervision SNMP : toner bas | Ticket ou demande d'achat préparée | Lot B |

### 3.3 Sécurité (détection, jamais de remédiation automatique)

| Automatisation | Signal croisé | Ce que fait Relève | Pilote |
|---|---|---|---|
| **Vague de comptes verrouillés** | Plusieurs comptes bloqués en peu de temps | Soupçon d'attaque par pulvérisation de mots de passe : alerte sécurité à l'astreinte, **suspend les déblocages automatiques** | Lot A |
| **Demande de réinitialisation suspecte** | Demande de reset MFA ou mot de passe + connexion récente depuis un pays ou un appareil inhabituel | Refuse de traiter dans le chat, escalade à un humain avec le contexte (protection contre l'ingénierie sociale) | Lot A |
| **Règle de transfert de mail suspecte** | Graph : nouvelle règle qui transfère vers l'extérieur | Alerte de compromission possible au technicien | Lot B |
| **Utilisateur qui signale un hameçonnage** | Message « j'ai cliqué sur un lien bizarre » | Procédure guidée, ticket sécurité prioritaire, prévient l'astreinte immédiatement | Lot A |

### 3.4 Organisation du support

| Automatisation | Déclencheur | Ce que fait Relève | Pilote |
|---|---|---|---|
| **Problème récurrent** | Même cause sur plusieurs tickets en quelques semaines | Propose de créer un « problème » au sens ITIL et une fiche de connaissance | Lot A |
| **Ticket bientôt hors délai** | Délai contractuel (SLA) proche | Relance le technicien, puis son suppléant | Lot A |
| **Technicien absent avec tickets ouverts** | Planning de relève ou réponse automatique d'absence | Réattribue à la personne qui le remplace, résumé inclus | Lot A |
| **Arrivée ou départ d'un salarié** | Ticket RH ou formulaire | Déroule la procédure du client (compte, licence, groupes, matériel), chaque étape validée | Lot B |
| **Fiche de connaissance à jour** | Ticket résolu par un humain avec une solution nouvelle | Propose une fiche, publiée seulement après validation | Lot A |

## 3 bis. Brancher l'IA sur tous les systèmes d'alerte

**Peut-on connecter l'IA à tous les systèmes d'alerte des outils ? Oui en principe, avec une réserve honnête** : « tous » veut dire toute source capable d'émettre une alerte par l'une des quatre voies ci-dessous. Chaque outil a ses formats, certains ne savent qu'envoyer un e-mail, d'autres vivent sur un réseau local sans accès sortant. La cible est une couverture universelle par configuration, pas un adaptateur écrit pour chaque outil.

### Les quatre voies d'entrée

| Voie | Sources couvertes | Sécurité | Quand |
|---|---|---|---|
| **Webhook entrant** (JSON ou texte), un secret signé par source | Supervision (Zabbix, Centreon, PRTG, Checkmk, Nagios via un script), alertes des RMM, Azure Monitor, outils de sauvegarde et autres outils qui savent appeler une URL | URL unique par source, signature HMAC, limitation de débit | **Démo** |
| **Interrogation d'API** | État des services Microsoft 365 (`ServiceHealth.Read.All`) ; alertes de sécurité Microsoft et alertes des RMM (permissions à confirmer une à une) | Lecture seule, permissions minimales | État des services dans la démo, le reste après |
| **E-mail vers alerte** | Outils qui ne savent qu'envoyer un mail : sauvegardes, onduleurs, imprimantes, anciens outils | Adresse dédiée par organisation, SPF et DKIM vérifiés, **contenu traité comme une donnée** (surface d'injection de prompt) | Première étape après la démo |
| **Relais Relève** (syslog, traps SNMP, réseau local) | Équipements réseau, onduleurs, serveurs sans accès sortant | Connexion sortante uniquement, aucun port ouvert | Après le premier client payant |

La compatibilité de chaque outil avec ces voies (webhook natif, notification personnalisable, API) est **à vérifier outil par outil** à l'ajout du connecteur.

### Format normalisé

Toute alerte, quelle que soit la source, est convertie en un format commun : source, organisation, actif (hôte ou service), site, gravité normalisée (information, avertissement, majeur, critique), état (ouverte, acquittée, résolue), horodatages, clé de déduplication, lien vers l'alerte d'origine. La charge brute est conservée pour l'audit, **jamais exécutée ni interprétée comme une instruction**.

### Ce que l'IA fait des alertes

- Elle les **lit** (`alert.list_active`, `host.status`) et les croise avec les demandes, l'état du parc et les comptes.
- Elle **n'agit jamais sur la foi du contenu d'une alerte** : une alerte qui contiendrait du texte du type « réinitialise le compte de l'administrateur » est de la donnée.
- L'accusé de réception vers la source (`alert.acknowledge`) est une action de niveau 1.

### Garde-fous de qualité

| Problème | Parade |
|---|---|
| Une alerte = un ticket serait ingérable | Regroupement, un ticket parent par incident |
| Alertes en rafale lors d'une panne | Limitation et regroupement par actif et par fenêtre de temps |
| Alertes qui s'allument et s'éteignent (battement) | Délai de confirmation avant ouverture d'un incident |
| Maintenance planifiée | Fenêtres de maintenance déclarées : pas de dérangement ni de ticket |
| Alerte sans rattachement | Correspondance actif, site, client ; sinon « non rattachée » visible, jamais jetée |
| Gravités différentes selon les outils | Table de correspondance par source, modifiable |
| Source qui ne répond plus | Alerte « silence anormal » : une supervision muette est un incident |

### Limites honnêtes

La qualité de la corrélation dépend de la qualité de l'inventaire (RMM ou CMDB) : sans lien entre l'alerte et le poste, le site ou le service, l'IA ne peut pas la rapprocher des demandes. Chaque nouvelle source passe par un test d'envoi et une revue de mapping.

### Données

Tables `alert_sources` (organisation, type, secret, mapping des gravités), `alerts` (format normalisé), `alert_events` (historique des changements d'état).

## 4. Sécurité des actions privilégiées

C'est le point qui fera accepter (ou refuser) Relève par une DSI.

1. **L'IA ne détient jamais de droits d'administration.** L'agent **prépare** l'action ; un technicien la valide depuis Teams, la console ou son téléphone ; **l'action s'exécute avec l'identité et les droits de ce technicien** (flux délégué OAuth « on-behalf-of »). Le journal indique qui a validé quoi.
2. **Vérification d'identité de l'utilisateur** avant toute action sur son compte : notification sur l'application d'authentification, code au manager, ou rappel du technicien.
3. **Scripts RMM** : uniquement ceux d'une liste blanche signée par le client, jamais un script généré par l'IA.
4. **Identifiants des connecteurs** chiffrés dans Supabase Vault, jamais visibles dans l'interface ni dans les journaux.

Skills : `securing-agentic-ai-tool-invocation`, `implementing-just-in-time-access-provisioning`, `performing-oauth-scope-minimization-review`, `auditing-mcp-servers-for-tool-poisoning`.

## 5. Mode suppléance : qui valide quand le valideur est absent

Demande du fondateur : pouvoir **changer la personne qui valide** en cas d'absence. Le principe ne change pas (une action s'exécute toujours avec l'identité d'un humain qui l'a validée), mais **cet humain peut changer**.

### Chaîne de validation

Chaque client définit, par catégorie d'action (comptes, boîtes mail, licences, scripts…), une **chaîne ordonnée de valideurs** :

1. le technicien d'astreinte selon le planning ;
2. ses suppléants, dans l'ordre ;
3. en dernier recours, l'**ESN partenaire** (si le contrat le prévoit) pour un client dont la DSI est absente.

Si personne ne valide dans le délai fixé, la demande **reste en attente** : l'utilisateur est prévenu du délai, le ticket est escaladé, **rien ne s'exécute automatiquement**.

### Délégation temporaire

Un valideur peut déléguer son rôle à un collègue nommé :

| Règle | Pourquoi |
|---|---|
| Délégation **nominative**, avec une date de début et de fin (30 jours maximum) | Pas de délégation permanente oubliée |
| Périmètre limité aux catégories choisies | On peut déléguer les mots de passe sans déléguer les licences |
| Le suppléant doit être un technicien avec ses **propres** droits Microsoft 365 suffisants | L'action reste exécutée avec une vraie identité humaine, jamais un compte partagé |
| Création ou modification avec **réauthentification MFA** | Empêche un attaquant qui a volé une session de se désigner suppléant |
| **Notification** à l'administrateur du client et au valideur remplacé | Personne n'est dessaisi sans le savoir |
| Révocable à tout moment, tout est tracé dans le journal d'audit | Traçabilité NIS2 |
| L'administrateur du client peut **réattribuer** les validations d'un absent qui n'a rien délégué (arrêt imprévu) | Couvre le cas où l'absence n'était pas prévue |

### Données

Tables `approval_policies` (chaînes par catégorie), `approval_delegations` (qui, à qui, périmètre, période, révocation), et pour chaque `action_request` : le valideur effectif et, s'il agit par délégation, la délégation utilisée.

## 6. Relais Relève (après le pilote)

Petit service installé chez le client pour joindre l'AD local, un GLPI interne ou une supervision sur le réseau local. Connexion **sortante uniquement**, aucun port ouvert, liste blanche d'actions locale.

## 7. Ce qu'il faut obtenir pour le pilote

| Quoi | Auprès de qui |
|---|---|
| Accès API et documentation RG System | Le client du fondateur qui l'utilise (ou Septeo) |
| Documentation de la « Ticketing API » TeamsWork | L'éditeur, via le pilote qui l'utilise |
| Comptes de test dans le tenant Microsoft 365 du fondateur | Le fondateur (comptes dédiés, licences de test) |
| Accès NinjaOne, Atera, ScreenConnect, PRTG | Les pilotes qui les utilisent, sinon essais gratuits |
