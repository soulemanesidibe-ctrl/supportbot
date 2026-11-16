# Revue de sécurité des fonctions (jalon J3)

**Date :** 16 novembre 2026. **Périmètre :** les quatre Edge Functions (`chat`, `actions`, `admin`, `cron`), le code partagé `supabase/functions/_shared/` et la migration 13. **Ce n'est pas** un test d'intrusion externe ni un essai sur un projet déployé : tout a été vérifié sur le code, par les tests (258 tests Deno, 365 vérifications SQL), par les règles Semgrep du projet et par les tests de mutation (112 côté fonctions, 62 côté base).

**Méthode.** La méthode du skill `performing-serverless-function-security-review` (inventaire, rôle d'exécution, secrets, déclencheurs, injection par l'événement, code, dépendances) a été transposée : le skill vise AWS Lambda, nos fonctions sont des Edge Functions Deno sur Supabase. Cadres de référence français déjà adoptés par le projet : [ANSSI, *Les essentiels : Sécuriser un système IA agentique*, V1.0 (10/26)](https://messervices.cyber.gouv.fr/documents-guides/anssi_essentiels_ia_agentique_1.0.pdf) et [ANSSI-PA-102, *Recommandations de sécurité pour un système d'IA générative*](https://messervices.cyber.gouv.fr/guides/recommandations-de-securite-pour-un-systeme-dia-generative) (voir `docs/securite-code-et-ci.md`).

## 1. Inventaire

| Fonction | Déclencheur | Garde d'entrée (première instruction) | Rôles admis | Limiteur | Ce qu'elle écrit |
|---|---|---|---|---|---|
| `chat` | HTTPS, POST | `requireOrgMember` | `end_user` | 12 messages par minute et par salarié, 120 par organisation | conversations, messages, tickets, comptabilité du modèle, audit |
| `actions` | HTTPS, POST | `requireOrgMember` | `partner_technician`, `org_technician` | 30 par personne, 120 par organisation | demandes d'action (approuver, exécuter, refuser), audit |
| `admin` | HTTPS, POST | `requireOrgMember` selon l'opération (19 opérations fermées) ; `requireUserWithEmail` pour l'acceptation d'une invitation | selon l'opération | 30 par personne, 120 par organisation | organisations, relations, invitations, assignations, autonomie, accès d'assistance, délégations |
| `cron` | HTTPS, POST, `?job=` | `requireCronSecret` (secret de 32 caractères au moins, comparé en temps constant) | tâche planifiée | sans objet | index de la base de connaissance |

Les quatre sont déployées avec `verify_jwt = false` : les nouvelles clés de Supabase ne sont pas des JWT, c'est donc **le code** qui vérifie le jeton auprès du serveur d'authentification (session révoquée = refusée). Aucune fonction ne lit un identifiant d'organisation ailleurs que dans le corps, puis le confronte à la base.

## 2. Rôle d'exécution (le risque principal de ce type d'architecture)

Une Edge Function qui écrit utilise la clé de service, qui contourne la sécurité par ligne. Défenses vérifiées :

- **Une seule porte** : `serviceClient(auth)`, qui refuse tout objet qui n'a pas été fabriqué par `auth.ts`, tout utilisateur sans organisation et sans rôle, et pose l'acteur et l'identifiant de requête dans des en-têtes que la base n'honore que pour le rôle service (testé en SQL, M23).
- **Deux portes étroites**, ajoutées en J3 pour des personnes qui n'ont pas d'organisation, et qui ne savent faire **qu'une chose** chacune : `acceptInvitationRpc` (appelle la fonction SQL d'acceptation, l'identifiant de la personne est posé par le code) et `rateLimitRpc` (incrémente un compteur). Aucune n'ouvre un accès général.
- **Droits explicites** (migration 12) : le service n'a de droits que sur les tables prévues ; le journal d'audit reste en insertion seule, même pour lui.
- Règles Semgrep : lecture de la clé de service interdite hors `db.ts`, `serviceClient` sans contexte vérifié interdit, contexte fabriqué hors `auth.ts` interdit, appel d'un connecteur hors des deux fichiers autorisés interdit, prompt système dynamique interdit.

## 3. Secrets et variables d'environnement

Onze variables lues, toutes par leur nom littéral (règle Semgrep : pas de lecture groupée de l'environnement) : `SUPABASE_URL`, `SUPABASE_ANON_KEY` ou `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` ou `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `MISTRAL_API_KEY`, `MISTRAL_BASE_URL`, `MISTRAL_MODEL_TRIAGE`, `MISTRAL_MODEL_ANSWER`, `MISTRAL_MODEL_EMBED`. **Aucun secret dans le code ni dans le dépôt** (gitleaks en pré-commit et en CI). Les secrets des connecteurs iront dans Vault (jamais en configuration). La clé Mistral se dépose dans les secrets des fonctions Supabase, que je ne vois jamais.

Journaux : une seule sortie console, `log.ts`, toujours masquée ; le test SEC-16 injecte un mot de passe, un jeton et une clé dans un message de salarié, puis fouille le stockage, les tickets, l'audit, les prompts envoyés au modèle, la comptabilité et les journaux (y compris sur un chemin d'erreur) : aucun des secrets n'y est.

## 4. Injection par l'événement (corps de requête)

- Corps JSON borné à 20 Ko (même sans `Content-Length`), type vérifié, objet exigé.
- Chaque champ est lu un par un (`input.ts` : longueur, caractères de contrôle, formats identiques à ceux de la base, listes fermées sans doublon, entiers bornés). Jamais le corps entier recopié dans une écriture : le test de « mass assignment » ajoute des champs (`role`, `plan`, `client_cap`, `approved_by`…) et vérifie que le magasin ne reçoit que les champs prévus.
- L'opération se cherche dans une table fermée (`Map`), jamais comme propriété d'un objet : `__proto__`, `constructor` et variantes sont refusés.
- Le texte du salarié, les fiches et l'historique sont des **données** encadrées par une balise à identifiant aléatoire ; le prompt système est statique et enregistré (SEC-15, test de bout en bout et règle Semgrep).

## 5. Dépendances et chaîne de fabrication

Une seule dépendance d'exécution (`@supabase/supabase-js`, version exacte, `deno.lock` gelé en CI), Deno installé par une version et des empreintes verrouillées, Dependabot, SBOM, Semgrep, gitleaks, zizmor et actionlint en CI. Aucune exécution dynamique (`eval`, `new Function`, processus) dans le code des fonctions : vérifié par recherche.

## 6. Constats

| N° | Gravité | Constat | État |
|---|---|---|---|
| R3-01 | **Élevée** | **Oracle sur l'état du compte** : pour une demande suspecte (X2 à X4), le salarié recevait un autre texte et un autre résultat (`suspect`) que pour une demande ordinaire. Une personne qui détient une session volée pouvait en déduire que le compte est surveillé (MFA récente, échecs de connexion, répétition). | **Corrigé** : réponse strictement identique ; le caractère suspect n'existe que dans le ticket de sécurité (priorité haute) vu des techniciens. Test SEC-11 sur 12 cas. *Écart avec la spec § 9.4, qui prévoyait un message distinct : à confirmer par le fondateur.* |
| R3-02 | Moyenne | Une adresse e-mail pouvait contenir un caractère de contrôle (par exemple NUL) : la forme `x@y.z` l'acceptait. | **Corrigé** (`input.ts`), test et mutation. |
| R3-03 | Faible | `approveAction` n'examinait pas l'expiration avant d'approuver : seule la base refusait (verrou de la migration 7), avec un message générique. Le code des fonctions ne doublait pas cette défense. | **Corrigé** : refus explicite avant toute écriture, test SEC-10 et mutation. |
| R3-04 | Faible | Réponses JSON sans `X-Content-Type-Options: nosniff`. | **Corrigé**. |
| R3-05 | Faible | `chat`, `actions` et `admin` lisent le corps (20 Ko au plus) avant d'authentifier, car l'organisation est dans le corps. | **Accepté** : coût borné ; le déluge volumétrique relève de la plateforme (Supabase). |
| R3-06 | À traiter | Aucune gestion de CORS ni de `OPTIONS` : un appel direct depuis un navigateur d'une autre origine échouera. | **Ouvert, J5** : si le front passe par l'adresse de l'application (même origine), rien à faire ; sinon, liste blanche d'origines, jamais `*`. |
| R3-07 | À traiter | La fenêtre de limitation est fixe : à cheval sur deux minutes, jusqu'à deux fois la limite. La file d'attente vers le modèle reste propre à chaque instance. | **Limite assumée** (spec § 5.2) ; à revoir à J6 avec une charge réelle. |
| R3-08 | À vérifier | Trois points ne se vérifient que sur un projet déployé : le rôle `service_role` vu par la base avec les clés `sb_secret_…`, l'en-tête `apikey`, le format réel de `amr`. | **Au premier déploiement, guidé** (premier critère de l'étape). |
| R3-09 | À traiter | Aucune notification : le super administrateur à la création d'un client, l'utilisateur dont la demande n'a pas été validée dans le délai (SEC-10, seconde moitié). La trace d'audit existe. | **Ouvert, J4 et J5** (B14). |
| R3-10 | À traiter | La signature du jeton Microsoft du valideur n'est pas revérifiée côté Relève (le locataire, l'identifiant d'objet et l'expiration le sont ; Microsoft Graph refuse un jeton falsifié). | **Ouvert, J4** (B12). |
| R3-11 | À traiter | Connecteurs (GLPI) : l'adresse d'un serveur fournie par un client est une porte vers des requêtes sortantes (SSRF). | **J4** : hôtes publics seulement, redirections refusées, liste des ports ; même règle que celle déjà appliquée à Mistral. |
| R3-12 | Info | Valeurs de limitation, seuils X1 à X4, plafond de 10 clients : provisoires. | À calibrer avec le pilote. |

## 7. Ce que cette revue ne couvre pas

Un essai sur le projet Supabase réel (premier déploiement), la résistance aux attaques par injection avec un jeu d'essai large (`promptfoo`, J6), la sécurité de l'interface (J5), les connecteurs (J4) et un audit externe, qui reste recommandé avant le premier client payant.
