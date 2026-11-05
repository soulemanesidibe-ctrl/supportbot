# 07 · Intégrations : ticketing, Microsoft 365, RMM, prise en main à distance, supervision

> Objectif fixé par le fondateur (technicien support) : un agent **le plus complet possible**, branché sur tout l'outillage réel d'une ESN ou d'une DSI. Ce document décrit comment y arriver sans que la sécurité ni le calendrier n'explosent.

## 1. Principe : des connecteurs par capacité, pas par outil

L'agent ne connaît pas « GLPI » ou « NinjaOne ». Il connaît des **capacités** (créer un ticket, lire l'état d'un compte, trouver le poste d'un utilisateur…). Chaque connecteur déclare celles qu'il sait faire. Ajouter un outil revient à écrire un adaptateur, sans toucher au cerveau de l'agent.

| Famille | Capacités (contrat commun) |
|---|---|
| **Ticketing** | `ticket.create`, `ticket.get`, `ticket.search`, `ticket.comment`, `ticket.update_status`, `ticket.assign`, `kb.search` |
| **Identité et messagerie** (Microsoft 365, Entra ID, AD) | `user.diagnose` (compte bloqué, MFA, licences, dernières connexions en échec), `user.reset_password`, `user.unlock`, `user.revoke_sessions`, `user.mfa_reregister`, `mailbox.diagnose`, `mailbox.grant_shared_access`, `mailbox.set_auto_reply`, `mailbox.set_forwarding`, `license.assign`, `group.add_member`, `user.onboard`, `user.offboard` |
| **RMM et parc** | `device.find_by_user`, `device.health` (disque, RAM, services, dernier redémarrage), `device.patch_status`, `script.run` (liste blanche uniquement) |
| **Prise en main à distance** | `remote.create_session` (lien d'invitation pour l'utilisateur, attribué au technicien), `remote.session_status` |
| **Supervision** | `alert.ingest` (webhook entrant), `alert.list_active`, `alert.acknowledge`, `host.status` |
| **Canaux** | Microsoft Teams, widget web, e-mail ; téléphone plus tard |

## 2. Catalogue des connecteurs et priorités

Priorités établies d'après vos réponses : tous les outils sont utilisés par vos pilotes. L'ordre suit donc **la qualité de l'API, le nombre de clients débloqués et la gratuité des tests**.

### Ticketing

| Outil | API | Priorité | Test gratuit |
|---|---|---|---|
| **GLPI** | REST (v1, et API v2 dans GLPI 11) | **MVP** | Docker local |
| **Jira Service Management** | REST Cloud, bien documentée | **MVP** | Offre gratuite Atlassian (quelques agents) |
| **iTop** (Combodo, français) | REST/JSON | V1 | Docker local (open source) |
| **EasyVista** | REST | V1 | Partenariat éditeur nécessaire |
| **Freshservice** / **Zendesk** | REST, bien documentées | V1 | Essais gratuits |
| **TeamsForWork** | **À identifier** : je n'ai trouvé que « TeamsWork Ticketing As A Service », une application de ticketing dans Teams | À préciser | — |

### Microsoft 365, Entra ID, Active Directory

| Cible | Moyen | Priorité |
|---|---|---|
| **Diagnostic** (lecture seule) | Microsoft Graph | **MVP** |
| **Mot de passe, MFA, déblocage, révocation de sessions** | Microsoft Graph, avec validation d'un technicien | V1 |
| **Boîtes mail** (accès partagé, réponse automatique, transfert) | Graph et Exchange Online | V1 |
| **Comptes, licences, groupes, arrivées et départs** | Graph | V1, avec procédures configurables par client |
| **Active Directory local** | **Relais Relève** installé chez le client (voir § 4) | V2 |

### RMM et prise en main à distance

| Outil | Remarque | Priorité |
|---|---|---|
| **NinjaOne** | API publique complète (appareils, scripts, alertes) | V1 |
| **Atera** | API publique (agents, alertes, tickets) | V1 |
| **RG System** (groupe Septeo, **français**, hébergé en France) | API annoncée par les comparateurs, **documentation non publique trouvée**. Accès probable via partenariat : à demander à l'éditeur. Fort argument pour les MSP français | V1, selon l'accès à l'API |
| **Datto RMM** | API REST | V2 |
| **ScreenConnect** / **Splashtop** | Création de session via API ou extension | V1 |
| **TeamViewer** | API de sessions | V2 |
| **AnyDesk** | API limitée selon la licence | V2, à vérifier |
| **RustDesk** / **MeshCentral** | Open source, auto-hébergeables, argument souveraineté | V2 |

### Supervision

Vous m'avez demandé les 5 outils les plus utilisés par notre cible. **Il n'existe pas d'étude de parts de marché publique et fiable pour la France** : je n'ai trouvé que des comparatifs de blogs. D'après eux, les plus cités pour les PME, ETI et collectivités sont :

| Rang (d'après les citations) | Outil | Profil | Intégration | Priorité |
|---|---|---|---|---|
| 1 | **Zabbix** | Open source, le plus déployé | API JSON-RPC, webhooks d'alerte | V1 |
| 2 | **Centreon** | **Éditeur français**, grandes institutions, collectivités | API REST, notifications | V1 |
| 3 | **PRTG** (Paessler) | PME, gratuit jusqu'à 100 capteurs | API HTTP, notifications | V1 |
| 4 | **Checkmk** | Successeur moderne de Nagios | API REST | V2 |
| 5 | **Nagios** | Historique, encore très présent | Notifications par script | V2 |

**Point important** : beaucoup de MSP supervisent directement via leur RMM (RG System, NinjaOne, Atera). Les alertes RMM passeront par le même contrat `alert.ingest`.

**Le plan pour aller vite** : un **webhook générique** dès le MVP (n'importe quel outil sait appeler une URL avec une alerte), puis des adaptateurs dédiés pour enrichir les données.

## 3. Ce qui rendra l'agent vraiment utile : la corrélation

C'est là qu'on dépasse un simple chatbot, parce que l'agent voit à la fois **les alertes** et **les demandes des utilisateurs** :

1. Centreon signale le serveur Exchange en panne à 8 h 02.
2. Entre 8 h 05 et 8 h 10, sept utilisateurs écrivent « Outlook ne marche plus ».
3. Relève **reconnaît l'incident**, répond aux sept qu'un incident est en cours, ouvre **un seul** ticket parent dans GLPI avec les sept demandes rattachées, et prévient le technicien d'astreinte avec un résumé.
4. Au retour du technicien, la passation de garde contient la chronologie complète.

Autre exemple : « mon PC est lent ». Relève trouve le poste via le RMM, constate un disque plein à 98 %, propose le script de nettoyage de la liste blanche (niveau 1 : validé par un technicien), puis rédige le ticket avec le diagnostic déjà fait.

## 4. Sécurité des actions privilégiées

C'est le point qui fera accepter (ou refuser) Relève par une DSI.

1. **Diagnostic d'abord.** Le MVP ne fait que lire (Graph, RMM, supervision).
2. **L'IA ne détient jamais de droits d'administration.** Pour une action Microsoft 365, l'agent **prépare** la demande ; le technicien la valide depuis Teams ou son téléphone ; **l'action s'exécute avec l'identité et les droits du technicien** (flux délégué OAuth « on-behalf-of »). Le journal indique qui a validé quoi. Les permissions minimales côté Graph (par exemple `UserAuthenticationMethod.ReadWrite.All`, avec le rôle Authentication Administrator ou Helpdesk Administrator) sont à confirmer action par action dans la documentation Microsoft.
3. **Vérification d'identité de l'utilisateur** avant toute action sur son compte. Une réinitialisation de mot de passe demandée dans un chat est un vecteur classique d'ingénierie sociale. Prévoir une confirmation hors bande : notification sur l'appli d'authentification, code au manager, ou rappel du technicien.
4. **Scripts RMM** : uniquement ceux d'une liste blanche signée par le client, jamais un script généré par l'IA.
5. **Relais Relève** (V2) : petit service installé chez le client pour joindre l'AD local, un GLPI interne ou un Centreon sur le réseau local. Connexion **sortante uniquement**, aucun port ouvert, liste blanche d'actions locale.
6. **Identifiants des connecteurs** chiffrés dans Supabase Vault, jamais visibles dans l'interface ni dans les journaux.

Skills à utiliser : `securing-agentic-ai-tool-invocation`, `implementing-just-in-time-access-provisioning`, `performing-oauth-scope-minimization-review`, `auditing-mcp-servers-for-tool-poisoning`.

## 5. Ce que ça change à la feuille de route

| Version | Contenu intégrations |
|---|---|
| **MVP (pilotes)** | Teams + widget web ; GLPI + Jira SM ; Microsoft 365 en **diagnostic seul** ; webhook de supervision générique ; corrélation alertes et demandes |
| **V1** | Actions Microsoft 365 avec validation ; NinjaOne, Atera, RG System ; ScreenConnect ; Zabbix, Centreon, PRTG ; iTop, EasyVista, Freshservice, Zendesk |
| **V2** | Relais Relève (AD local), Datto, TeamViewer, AnyDesk, RustDesk, MeshCentral, Checkmk, Nagios ; arrivées et départs automatisés |

Pour tenir le budget de 0 € en test : GLPI, iTop et Zabbix tournent en local avec Docker ; Jira a une offre gratuite ; pour Microsoft 365, il faut un tenant de test (programme développeur Microsoft 365, dont l'accès a été restreint : à vérifier) ou un tenant d'un pilote volontaire. Les RMM ne proposent que des essais limités dans le temps, il faudra donc les brancher pendant les pilotes.
