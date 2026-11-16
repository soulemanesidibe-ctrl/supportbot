# Permissions Microsoft Graph de Relève

**Date :** 16 novembre 2026. **Statut :** vérifié sur la documentation de Microsoft (Microsoft Learn) le même jour ; **à confirmer sur le tenant de test** avant toute démonstration. Revue de minimisation selon le skill `performing-oauth-scope-minimization-review`.

## 1. Deux régimes, jamais mélangés

| Régime | Qui l'utilise | Pour quoi | Ce qu'il ne peut PAS faire |
|---|---|---|---|
| **Application, lecture seule** (jeton « client credentials » de l'application Relève, consentement de l'administrateur du client) | L'agent, pendant le chat, sans technicien présent | Diagnostiquer un compte, lire l'état des services Microsoft 365 | **Rien écrire** : aucune permission d'écriture n'est demandée pour l'application (menace M05). Même si notre code se trompait, Microsoft refuserait. |
| **Délégué** (jeton du technicien qui valide, demandé au moment de valider, utilisé dans la requête, jamais stocké) | Le technicien valideur, et lui seul | Les quatre actions de niveau 1 | Agir au-delà des **rôles Entra du technicien lui-même** : les droits effectifs sont l'intersection des permissions et de ses rôles. Escalade impossible par construction. |

Le code applique cette séparation (`supabase/functions/_shared/connectors/m365.ts`) : une capacité d'écriture refuse tout appel qui n'apporte pas le jeton délégué d'un technicien, et n'utilise jamais le jeton de l'application. L'exécuteur vérifie en plus que ce jeton appartient au compte Microsoft **lié** à ce technicien (histoire T12, `docs/spec-mvp.md` § 9.6).

## 2. Permissions d'APPLICATION (lecture seule)

| Permission | Utilisée pour | Appel | Alternative plus large refusée |
|---|---|---|---|
| `User.Read.All` | Retrouver le compte, savoir s'il est actif, date du dernier changement de mot de passe ; test de connexion | `GET /users/{upn}`, `GET /users?$top=1` | `Directory.Read.All` |
| `UserAuthenticationMethod.Read.All` | Lister les méthodes de second facteur (règle X2 : méthode ajoutée depuis moins de 24 h) | `GET /users/{id}/authentication/methods` ([doc](https://learn.microsoft.com/en-us/graph/api/authentication-list-methods?view=graph-rest-1.0)) | `UserAuthenticationMethod.ReadWrite.All` |
| `AuditLog.Read.All` | Compter les échecs de connexion des 24 dernières heures (règle X3) et repérer un verrouillage récent (code 50053) | `GET /auditLogs/signIns` ([doc](https://learn.microsoft.com/en-us/graph/api/signin-list?view=graph-rest-1.0)) | aucune |
| `RoleManagement.Read.Directory` | Savoir si le compte a un rôle d'administration (règle X1 : **jamais** d'action préparée) | `GET /roleManagement/directory/roleAssignments` ([doc](https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleassignments?view=graph-rest-1.0)) | `RoleManagement.Read.All`, `Directory.Read.All` |
| `ServiceHealth.Read.All` | État des services Microsoft 365 (ne pas ouvrir dix tickets pendant une panne de Microsoft) | `GET /admin/serviceAnnouncement/healthOverviews` ([doc](https://learn.microsoft.com/en-us/graph/api/serviceannouncement-list-healthoverviews?view=graph-rest-1.0)) | aucune |

**Échec fermé.** Si l'une de ces lectures échoue (permission absente, licence insuffisante, panne), le diagnostic **échoue** : aucune action n'est préparée et un technicien traite à la main. Le connecteur ne répond jamais « aucun signe de risque » par défaut.

## 3. Permissions DÉLÉGUÉES (le technicien qui valide)

| Action | Permission (la moins large documentée) | Appel | Rôle Entra du technicien | Alternative refusée |
|---|---|---|---|---|
| Réinitialiser le mot de passe | `UserAuthenticationMethod.ReadWrite.All` | `POST /users/{id}/authentication/methods/28c10230-6103-485e-b985-444c60001490/resetPassword`, mot de passe **généré par Microsoft** ([doc](https://learn.microsoft.com/en-us/graph/api/authenticationmethod-resetpassword?view=graph-rest-1.0)) | Administrateur de l'authentification ; pour les comptes sans rôle, aussi Administrateur du support technique, Administrateur des mots de passe ou Administrateur des utilisateurs | `User-PasswordProfile.ReadWrite.All` avec mot de passe choisi par nous |
| Réactiver un compte désactivé (« débloquer », décision Q2) | `User.EnableDisableAccount.All` + `User.Read.All` | `PATCH /users/{id}` `{ "accountEnabled": true }` ([doc](https://learn.microsoft.com/en-us/graph/api/user-update?view=graph-rest-1.0)) | À confirmer sur le tenant de test | `User.ReadWrite.All` |
| Révoquer les sessions | `User.RevokeSessions.All` | `POST /users/{id}/revokeSignInSessions` ([doc](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0)) | À confirmer sur le tenant de test | `User.ReadWrite.All`, `Directory.ReadWrite.All` |
| Exiger une nouvelle inscription du second facteur | `UserAuthenticationMethod.ReadWrite.All` | Supprimer chaque méthode **sauf le mot de passe** : c'est la méthode documentée par Microsoft ([vue d'ensemble](https://learn.microsoft.com/en-us/graph/api/resources/authenticationmethods-overview?view=graph-rest-1.0)) | Administrateur de l'authentification | aucune |
| Lier son compte (T12) | `User.Read` | `GET /me` | aucun | aucune |

**Mot de passe temporaire.** Généré par Microsoft, il n'est remis au technicien **qu'après** que Microsoft a confirmé la réinitialisation (opération de longue durée), par un canal à usage unique : présent seulement dans la réponse à CE technicien, jamais stocké, journalisé ni inclus dans le résultat de l'action. Sans ce canal, rien n'est réinitialisé.

**Second facteur du technicien (Microsoft, depuis le 26 janvier 2026).** Les opérations sur les méthodes d'authentification exigent un second facteur de moins de 10 minutes dans la session. La console (J5) demandera donc le jeton délégué avec le paramètre de revendication `{"access_token":{"amr":{"essential":true,"values":["ngcmfa"]}}}` et traitera un refus 403 en redemandant l'authentification (source : vue d'ensemble ci-dessus). Relève exige déjà, de son côté, un second facteur de moins de 10 minutes pour valider.

## 4. Limites connues, à confirmer sur le tenant de test

1. **Historique des connexions** : en édition gratuite d'Entra ID, il est conservé 7 jours ([conservation](https://learn.microsoft.com/fr-fr/entra/identity/monitoring-health/reference-reports-data-retention)) ; l'accès par l'API peut exiger une licence Premium P1. Sans lui, le diagnostic échoue (fermé). Prévoir l'essai P1 de 30 jours **au moment** de le tester.
2. **Règle X2 incomplète** : Microsoft ne donne pas de date de création pour les méthodes « téléphone », « e-mail » et « code logiciel ». Un téléphone ajouté hier n'est donc pas détecté par X2 aujourd'hui (le changement de mot de passe, lui, l'est). Piste : les journaux d'audit « User registered security info » (backlog B23).
3. **Règle X1** : seules les attributions de rôle **directes** sont vues ; les rôles reçus par un groupe ou éligibles (PIM) ne le sont pas (backlog B24).
4. **Codes d'échec comptés** (X3) : 50126 (identifiants invalides), 50053 (compte verrouillé), 50057 (compte désactivé), 50055 (mot de passe expiré). Les demandes de second facteur ne comptent pas. À calibrer.
5. Le nom d'utilisateur (UPN) doit être l'adresse e-mail du salarié dans l'annuaire ; sinon le diagnostic échoue (backlog B21).

## 5. Mise en place sur le tenant de test (à faire au moment des essais, guidée)

1. Créer **l'inscription d'application** Relève (multitenant), y ajouter les permissions de la section 2 (type « Application ») et de la section 3 (type « Déléguée »). **Aucune** permission d'application en écriture.
2. Créer un secret client à courte durée ; le déposer dans les **secrets des fonctions Supabase** (`MS_APP_CLIENT_ID`, `MS_APP_CLIENT_SECRET`), **jamais** dans le chat ni le dépôt.
3. Donner le **consentement administrateur** dans le tenant de test.
4. Créer des **comptes de test dédiés** : un salarié ordinaire, un compte « à privilèges » (pour vérifier X1), un technicien avec le rôle Administrateur de l'authentification **seulement**.
5. Connecter le tenant (`connector.create_m365`), puis chaque technicien lie son compte (`microsoft.link`).
