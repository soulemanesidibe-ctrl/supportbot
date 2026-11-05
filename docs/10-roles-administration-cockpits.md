# 10 · Rôles, administration multi-clients et tableaux de bord par rôle

> Demande du fondateur : un **accès administrateur** pour ajouter les entreprises, donner les accès de gestion **par entreprise et par ESN gérant plusieurs clients**, et le **meilleur tableau de bord (cockpit) pour chaque rôle**. Ce document s'appuie sur ce que font les références du marché (modèle d'accès délégué de Microsoft pour les partenaires, portail multi-clients Microsoft 365 Lighthouse), sur l'OWASP pour l'isolation entre clients et sur l'ANSSI pour les comptes d'administration. Sources en fin de document.

## 1. La hiérarchie

```
Plateforme Relève (vous)
 ├── ESN partenaire A ──┬── Client A1
 │                      ├── Client A2
 │                      └── Client A3
 ├── ESN partenaire B ──── Client B1
 └── Client direct C (une DSI sans ESN)
```

- Une **organisation** a un type : `platform`, `partner` (ESN) ou `client`.
- Un client peut être géré par **une ESN**, **plusieurs** (cas rare, ex. une ESN pour le support, une autre pour la sécurité) ou **aucune** (client direct).
- Une personne peut appartenir à **plusieurs organisations** avec un rôle différent dans chacune (ex. un technicien indépendant qui travaille pour deux ESN). Les droits se calculent **toujours dans le contexte d'une organisation**, jamais globalement (OWASP).

## 2. Les rôles

### 2.1 Plateforme (Relève)

| Rôle | Peut | Ne peut pas |
|---|---|---|
| **Super administrateur** (vous) | Créer et suspendre ESN et clients, choisir l'offre et les fonctionnalités, inviter le premier administrateur de chaque organisation, voir la santé de la plateforme et la facturation | **Lire les conversations, tickets ou données d'un client par défaut.** Voir § 3.4, accès d'assistance |
| **Support plateforme** (vos futurs salariés) | Voir la configuration et l'état des connecteurs pour aider un client | Modifier une offre, lire les données d'un client sans accès d'assistance |

### 2.2 ESN partenaire

| Rôle | Peut | Ne peut pas |
|---|---|---|
| **Administrateur ESN** | Gérer les techniciens de l'ESN, demander une relation avec un client, **créer ses clients** (décision du fondateur, § 4), assigner les techniciens aux clients, configurer marque blanche, connecteurs, règles d'automatisation, plannings de relève | Accéder à un client qui n'a pas approuvé la relation, dépasser les rôles approuvés par le client |
| **Responsable de compte** (chef de service, manager) | Voir tous les clients de l'ESN en lecture, rapports, SLA, charge des techniciens | Exécuter des actions sur le SI d'un client |
| **Technicien ESN** | Traiter les demandes et valider les actions **des seuls clients qui lui sont assignés**, selon les rôles et la durée de l'assignation | Voir les autres clients de l'ESN |

### 2.3 Client (entreprise, collectivité)

| Rôle | Peut | Ne peut pas |
|---|---|---|
| **Administrateur client** (DSI, responsable informatique) | Gérer les utilisateurs, les valideurs et la suppléance, **approuver, limiter et révoquer l'accès de l'ESN**, connecteurs propres, niveau d'autonomie | Toucher aux autres clients de l'ESN |
| **Technicien interne** | Comme un technicien ESN, sur son organisation | Administrer l'organisation |
| **Direction / observateur** | Lire les tableaux de bord et rapports | Voir le contenu des conversations |
| **Auditeur** (RSSI, DPO) | Lire le journal d'audit, les accès, les délégations, les exports | Agir sur quoi que ce soit |
| **Salarié** | Utiliser le widget, voir ses propres demandes | Voir les demandes des autres |

**Valideur** n'est pas un rôle mais une **capacité** attribuée à un technicien (ESN ou interne) par catégorie d'action, via les chaînes de validation et la suppléance (`docs/07` §5).

## 3. Règles d'accès

### 3.1 Relation ESN ↔ client sur le modèle Microsoft GDAP

Microsoft a remplacé l'accès administrateur permanent et global de ses partenaires par des accès **par client, limités en rôles et en durée**, que le client approuve et peut révoquer seul. Relève reprend ce modèle :

1. L'ESN **demande** une relation à un client : rôles demandés (ex. technicien, responsable de compte), durée (12 mois maximum, renouvelable).
2. L'**administrateur client approuve** tout ou partie des rôles. Sans approbation, aucun accès.
3. L'ESN **assigne** ses techniciens au client, dans la limite des rôles approuvés, avec une date de fin.
4. Le client voit à tout moment **qui, chez l'ESN, a accès à quoi et jusqu'à quand**, et peut **révoquer** sans passer par l'ESN.
5. Les relations qui expirent sont signalées 30 jours avant aux deux parties.
6. **Jamais de comptes invités** créés à la main pour les techniciens d'ESN : tout passe par la relation.

### 3.2 Comptes d'administration (recommandations ANSSI)

- **MFA obligatoire** pour tous les rôles d'administration et de validation ; **clé de sécurité ou passkey** (résistante au hameçonnage) pour le super administrateur et les administrateurs ESN.
- **Compte d'administration plateforme dédié**, distinct de votre compte de travail quotidien.
- **Réauthentification** avant toute opération sensible : créer une organisation, approuver une relation, déléguer, changer un niveau d'autonomie, accès d'assistance.
- **Sessions d'administration courtes.**

### 3.3 Isolation (recommandations OWASP)

- L'organisation active voyage dans le jeton et est **revérifiée côté serveur à chaque requête** (Edge Functions), en plus de la RLS Postgres : la base est une barrière nécessaire mais pas suffisante.
- Les tests automatiques de fuite (`docs/09`) couvrent : client A / client B d'une même ESN, ESN A / ESN B, technicien non assigné, assignation expirée, relation révoquée.

### 3.4 Accès d'assistance (« bris de glace »)

Quand vous, ou votre support, devez regarder les données d'un client pour l'aider :

1. Demande depuis la console plateforme avec un **motif**.
2. **Approbation par l'administrateur client** (ou par l'administrateur ESN pour un client géré).
3. Accès en **lecture seule**, **limité dans le temps** (4 heures par défaut), bandeau visible de votre côté, journal d'audit, notification au client à l'ouverture et à la fermeture.

C'est un argument commercial fort : **même l'éditeur ne lit pas vos données sans votre accord.**

### 3.5 Revue des accès

Chaque trimestre, l'administrateur client et l'administrateur ESN reçoivent la liste des accès actifs (relations, assignations, délégations, valideurs) à confirmer ou à retirer. Sans réponse, rappel, puis alerte.

## 4. Les parcours d'administration

| Parcours | Étapes |
|---|---|
| **Nouvelle ESN** | Vous créez l'ESN, choisissez l'offre partenaire, invitez son administrateur → il active son compte avec MFA → il invite ses techniciens |
| **Nouveau client via une ESN** | L'ESN crée le client (ou l'invite s'il existe) et demande la relation → l'administrateur client active son compte et approuve les rôles → l'ESN assigne ses techniciens → connecteurs et salariés |
| **Client créé par l'ESN** (autorisé, décision du 5 novembre 2026) | L'ESN crée le client : la relation ESN-client est créée en même temps, déjà active pour que l'ESN puisse configurer → l'ESN invite l'administrateur du client → à l'activation de son compte, il **voit la relation, la confirme ou la réduit, et garde le droit de la révoquer seul** → vous êtes notifié de chaque création ; le client est rattaché à l'offre partenaire de l'ESN pour la facturation |
| **Nouveau client direct** | Vous créez le client et invitez son administrateur → il configure lui-même |
| **Import des salariés** | Synchronisation depuis Microsoft Entra ID (lecture des utilisateurs et groupes) ou import CSV ; SCIM plus tard |
| **Départ d'un technicien ESN** | L'administrateur ESN le retire : toutes ses assignations, délégations et sessions sont révoquées d'un coup |
| **Fin de contrat ESN** | Le client révoque la relation : accès coupés immédiatement, historique conservé, export possible |

Garde-fous de la création de clients par une ESN : réauthentification MFA, notification au super administrateur, plafond de clients selon l'offre partenaire, et aucun client créé ne peut être rattaché à une autre ESN sans l'accord de son administrateur.

## 5. Le meilleur tableau de bord pour chaque rôle

Principe tiré de Microsoft 365 Lighthouse et des bonnes pratiques ITSM : **chaque rôle a un écran d'accueil qui répond à sa question principale**, avec une vue d'ensemble et un zoom. Dans les vues multi-clients, sélectionner un client met à jour tous les blocs sur ce client seul.

### 5.1 Super administrateur : « La plateforme va-t-elle bien, et mes clients en tirent-ils de la valeur ? »

| Bloc | Contenu |
|---|---|
| Organisations | ESN et clients actifs, en pilote, en essai, suspendus ; activations en cours (étape bloquée) |
| Santé technique | Erreurs par connecteur et par client, latence de l'agent, file d'attente Mistral, consommation par rapport aux quotas gratuits |
| Valeur | Conversations traitées, taux de résolution confirmée par l'IA, satisfaction, par ESN et par client |
| Sécurité | Comptes d'administration sans MFA, échecs de connexion, accès d'assistance en cours, alertes de sécurité des automatisations |
| Commercial | Revenu mensuel, pilotes qui arrivent à échéance, relations ESN–client qui expirent |

### 5.2 Administrateur et responsable de compte ESN : « Lequel de mes clients a besoin de moi maintenant ? »

| Bloc | Contenu |
|---|---|
| **Tableau de tous les clients** | Une ligne par client : incidents ouverts, actions à valider, SLA en danger, connecteurs en erreur, relève active ou non. Tri par urgence, filtres par étiquette (secteur, offre, région) |
| Zoom client | Tous les blocs ci-dessous recalculés pour un seul client |
| Performance | Résolution au premier contact, délai moyen de résolution, respect des SLA avec **causes des dépassements**, taux de réouverture, taux d'escalade, satisfaction |
| Équipe | Charge par technicien, astreintes, suppléances actives |
| Accès | Relations et assignations qui expirent, revues trimestrielles à faire |
| **Rapport mensuel par client** | Généré automatiquement, relu puis envoyé : ce que Relève et l'équipe ont traité. C'est la preuve de valeur qui justifie la facture de l'ESN |

### 5.3 Technicien (ESN ou interne) : « Quoi faire maintenant ? »

| Bloc | Contenu |
|---|---|
| **File unifiée** | Toutes les demandes de tous ses clients assignés, priorisées : incidents, actions à valider, SLA proches, escalades de l'IA |
| Boîte de validation | Actions préparées par l'IA avec contexte et diagnostic ; valider ou refuser en un geste, y compris depuis le téléphone |
| Vue incident | Alertes et demandes sur une même ligne de temps |
| Pendant votre absence | Résolu, en attente, escaladé, à surveiller |
| Palette `Ctrl K` | Un utilisateur, un poste, un ticket, un client, une action |

### 5.4 Administrateur client (DSI) : « Mon support tient-il, et qui a accès à quoi ? »

| Bloc | Contenu |
|---|---|
| État du support | Demandes, résolues par l'IA, par l'équipe, en attente ; délai moyen ; satisfaction |
| Prévention | Alertes préventives (licences, certificats, mots de passe qui expirent, disques, sauvegardes) |
| **Accès** | ESN en relation et rôles approuvés, techniciens assignés, valideurs et suppléances, accès d'assistance : tout révocable d'ici |
| Connecteurs | État de chaque connexion et dernière synchronisation |
| Réglages | Niveau d'autonomie par catégorie d'action, chaînes de validation, plannings de relève |

### 5.5 Direction : « Est-ce que ça vaut ce que ça coûte ? »

Cinq chiffres et un rapport mensuel en PDF : demandes traitées, part résolue sans attente, délai moyen de résolution, satisfaction, incidents majeurs du mois. Pas de jargon technique. Toute estimation de « temps gagné » est **affichée comme une estimation**, avec sa méthode de calcul.

### 5.6 Auditeur (RSSI, DPO) : « Puis-je prouver qui a fait quoi ? »

Journal d'audit filtrable (personne, action, client, période), actions privilégiées avec leur valideur et la délégation utilisée, historique des relations ESN et des accès d'assistance, alertes de sécurité, exports pour un contrôle NIS2 ou RGPD.

### 5.7 Salarié : « Où en est ma demande ? »

Ses demandes et leur statut, les incidents en cours qui le concernent (« Panne Outlook en cours, rétablissement estimé… »), le bouton « Parler à un technicien ».

### Maquettes

Les sept écrans sont maquettés en direction B sur la planche [Relève IA · Identité visuelle](https://claude.ai/artifact/R9f1Z9Bnw4mZ4p2HymWNmT) (deuxième et troisième rangées), sources dans `docs/identite-visuelle/cockpits/`. Données fictives.

## 6. Définition des indicateurs

Le sigle MTTR désigne selon les sources le délai de **réponse** ou de **résolution**. Pour éviter l'ambiguïté, Relève n'utilise pas de sigle à l'écran :

| Indicateur | Définition |
|---|---|
| Délai de première réponse | Entre la demande et la première réponse utile (IA ou humain) |
| Délai de résolution | Entre la demande et la résolution confirmée |
| Résolution au premier contact | Demandes résolues sans relance ni transfert ÷ demandes |
| Résolution par l'IA | Demandes résolues par Relève **et confirmées par l'utilisateur** ÷ demandes |
| Escalade justifiée | Escalades de l'IA qu'un technicien juge pertinentes ÷ escalades |
| Respect des SLA | Demandes traitées dans le délai contractuel ÷ demandes, avec la cause de chaque dépassement |
| Taux de réouverture | Tickets rouverts ÷ tickets résolus |
| Satisfaction | Note donnée à la clôture par l'utilisateur |

## 7. Données

| Table | Rôle |
|---|---|
| `organizations` | `type` (`platform`, `partner`, `client`), offre, état, étiquettes |
| `memberships` | Personne × organisation × rôle |
| `partner_relationships` | ESN × client : rôles approuvés, état, approuvé par, expire le |
| `partner_assignments` | Technicien ESN × client × rôle × date de fin |
| `support_access_grants` | Accès d'assistance : demandeur, motif, approuvé par, début, fin |
| `invitations` | Invitations à usage unique, expirantes |
| `access_reviews` | Revues trimestrielles et décisions |

Fonctions RLS : `is_member_of(org)`, `has_role(org, role)`, `partner_can_access(client, role)` (relation active **et** assignation active), `org_has_feature(org, feature)`.

## 8. Skills à utiliser

| Sujet | Skills |
|---|---|
| Modèle de rôles et cycle de vie des accès | `building-identity-governance-lifecycle-process`, `building-role-mining-for-rbac-optimization` |
| Accès temporaires, assistance, suppléance | `implementing-just-in-time-access-provisioning`, `implementing-zero-standing-privilege-with-cyberark` (principes) |
| Revues d'accès | `performing-access-review-and-certification`, `performing-privileged-account-access-review` |
| Isolation et contrôle d'accès | `testing-for-broken-access-control`, `testing-api-for-broken-object-level-authorization`, `exploiting-broken-function-level-authorization` (en test, sur données de démo) |
| MFA et clés de sécurité | `implementing-passwordless-authentication-with-fido2`, `implementing-hardware-security-key-authentication` |
| Écrans | `ui-ux-pro-max`, `design-critique`, `ux-review`, `accessibility-review`, `dataviz` |

## Sources

| Fiabilité | Source | Utilisée pour |
|---|---|---|
| ★★★ | [ANSSI, recommandations relatives à l'administration sécurisée des SI](https://messervices.cyber.gouv.fr/guides/en-recommendations-secure-administration-it-systems) | Comptes d'administration dédiés, MFA, réauthentification |
| ★★★ | [OWASP, Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) | Isolation entre clients, contrôle côté serveur |
| ★★ | [Microsoft Learn, API Microsoft 365 Lighthouse (gestion multi-clients)](https://learn.microsoft.com/en-us/graph/managedtenants-concept-overview) | Vue multi-clients pour les ESN |
| ★★ | [Microsoft Tech Community, Lighthouse](https://techcommunity.microsoft.com/blog/microsoft_365blog/microsoft-365-lighthouse-is-making-it-even-easier-to-manage-your-customers/3984072) | Zoom par client, accès aux portails sans ressaisie |
| ★ | [ManageEngine, GDAP pour les ESN](https://www.manageengine.com/eu/microsoft-365-management-reporting/blogs/gdap-for-m365-msps.html) | Accès délégués limités en rôles et en durée, révocables par le client *(à recouper avec la documentation Microsoft Partner Center)* |
| ★ | [Ingram Micro, GDAP](https://www.ingrammicrocloud.com/blog/transition-to-granular-delegated-admin-privileges) | Durée en jours, rôles par groupe |
| ★ | [OpenClassrooms, SLA et délais dans GLPI](https://openclassrooms.com/fr/courses/1730486-gerez-vos-incidents-avec-le-referentiel-itil-sur-glpi/6544676-suivez-les-delais-de-resolution-d-incident-et-respectez-les-sla) | Indicateurs SLA, satisfaction à la clôture |
| ★ | [NinjaOne, indicateurs ITIL](https://www.ninjaone.com/fr/blog/indicateurs-itil-mesurer-la-performance-de-la-gestion-des-incidents/) | Équilibre rapidité et qualité, ambiguïté du MTTR |
