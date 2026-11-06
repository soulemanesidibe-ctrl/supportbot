# Sécurité du code et de la CI

Ce document dit **ce qui protège le code de Relève avant même qu'il tourne**, comment l'utiliser au quotidien, et surtout **ce que ces protections ne couvrent pas**. Il complète le [modèle de menace](threat-model.md) (le « pourquoi ») par le « comment ». Mis en place au jalon J0.

## 1. Vue d'ensemble

| Menace du modèle | Défense | Outil | Se déclenche | Bloque ? |
|---|---|---|---|---|
| M04 secret dans le dépôt | Détection de secrets, règles propres à Supabase, Postgres, Mistral, connecteurs | gitleaks | À chaque commit (local) et à chaque push (CI, historique complet) | Oui |
| M03, M23 contournement de la RLS | `service_role` lu et utilisé en un seul endroit, après vérification d'identité | Semgrep (règles du projet) | Avant chaque push (local) et en CI | Oui |
| M34 données réelles de pilote dans le dépôt public | Chemins et formats d'export refusés hors des zones synthétiques ; e-mails, IP et téléphones réels refusés dans ces zones ; la valeur trouvée n'est jamais affichée | `scripts/check-no-real-data.sh` | Avant chaque commit (local) et à chaque push (CI) | Oui |
| M04 secret dans un journal | Pas de secret écrit dans un journal ou un message d'erreur, y compris après transformation | Semgrep (analyse de flux) | Idem | Oui |
| M01, M07 injection dans le prompt système | Prompt système statique, données externes dans un message `user` | Semgrep | Idem | Oui |
| M01, M05, M12 action sans validation | Une capacité de connecteur ne s'appelle que par deux portes, qui vérifient avant d'agir | Semgrep | Idem | Oui |
| M06 chaîne d'approvisionnement | Dépendances sans scripts d'installation, failles connues, signatures du registre, paquets malveillants, inventaire | npm audit, OSV-Scanner, GuardDog, Snyk, Syft, Grype | À chaque push, et chaque lundi | Oui (GuardDog : informatif) |
| M06 pipeline de livraison | Permissions minimales, actions épinglées par SHA, binaires vérifiés par empreinte | actionlint, zizmor, Dependabot | À chaque push | Oui |

## 2. Les conventions de code que les règles imposent

Ces noms sont **provisoires** : le jalon J1 les fige dans la spec, et les règles se mettent à jour avec elle.

| Nom | Rôle | Où | Imposé par |
|---|---|---|---|
| `requireUser(req)`, `requireOrgMember(req, org)` | Vérifient le JWT, l'organisation active et le rôle, **à chaque requête** | `supabase/functions/_shared/auth.ts` | `releve-service-client-without-auth` |
| `verifyWebhookSignature(req)`, `requireCronSecret(req)` | Authentification des appels qui n'ont pas de JWT (supervision, tâches planifiées) | idem | idem |
| `AuthContext` | Preuve (par le type) qu'une authentification a eu lieu | idem | idem |
| `serviceClient(auth)` | **Seul** moyen d'obtenir un client `service_role`. Exige un `AuthContext` | `supabase/functions/_shared/db.ts` | `releve-service-role-key-direct-use`, `releve-service-role-env-property`, `releve-env-dynamic-key`, `releve-env-bulk-read` |
| `log.info(événement, champs)` et `redact()` | Journalisation avec masquage ; ne reçoit jamais de secret | `supabase/functions/_shared/log.ts` | `releve-secret-in-console-log`, `releve-secret-in-logger`, `releve-secret-flows-to-log`, `releve-log-whole-request-or-env` |
| `SYSTEM_PROMPT` (constante) | Prompt système **statique** ; aucune donnée dedans | `supabase/functions/_shared/llm/` | `releve-dynamic-system-prompt`, `releve-system-prompt-not-constant`, `releve-system-prompt-variable-mutated` |
| `wrapExternal(étiquette, donnée)` | Encadre tout contenu externe comme **donnée**, dans un message `user` | idem | convention (non vérifiable par une règle statique, voir § 3) |
| `callCapability(...)` | Seule porte pour les capacités de lecture ; applique `assertCapabilityAllowed` (classe d'action, refus par défaut) | `supabase/functions/_shared/capabilities/call.ts` | `releve-capability-invoked-outside-gate`, `releve-call-capability-without-class-filter` |
| `executeApprovedAction(...)` | Seule porte pour les actions privilégiées ; appelle `assertApprovedActionRequest` (empreinte exacte approuvée) avant d'exécuter | `supabase/functions/_shared/actions/execute.ts` | `releve-capability-invoked-outside-gate`, `releve-execute-without-approved-action-request` |
| `connector.invokeCapability(...)` | Appel brut d'un connecteur : réservé aux deux portes ci-dessus | `supabase/functions/_shared/connectors/` | `releve-capability-invoked-outside-gate` |

Les trois fichiers « portes » (`db.ts`, `call.ts`, `execute.ts`) sont les **seuls** autorisés à porter une exception `nosemgrep`, avec un motif :

```ts
// nosemgrep: releve-capability-invoked-outside-gate -- porte unique, filtre de classe appliqué juste avant
```

`scripts/check-nosemgrep.sh` refuse toute autre exception, tout `nosemgrep` sans règle nommée, et tout motif absent.

## 3. Ce que les règles ne rattrapent pas

Une règle statique est un **garde-fou contre l'erreur et la précipitation, pas une preuve**. Un test d'évasion, écrit pour les contourner, a donné ceci :

| Contournement tenté | Détecté ? |
|---|---|
| Lire tout l'environnement et déstructurer la clé | Oui |
| Nom de la variable d'environnement calculé ou stocké dans une constante | Oui |
| Secret écrit via `JSON.stringify`, un gabarit, une concaténation ou un message d'erreur | Oui (analyse de flux) |
| Prompt système produit par une fonction avec arguments, ou par une variable ordinaire | Oui |
| Alias ou accès indirect à `invokeCapability` | Oui |
| Copier `req.headers` dans une variable puis la journaliser | **Non** |
| Alias de `serviceClient` dans une variable | **Non** |
| Secret au nom inhabituel (`maClef`, `x`) | **Non** (la détection repose sur le nom) |
| Contenu externe placé dans un message `user` **sans** `wrapExternal` | **Non** (aucune règle ne sait qu'une donnée est externe) |
| Logique métier (valider sa propre demande, délégation hors périmètre) | **Non** : ce sont les tests de J2 et J6 |

Ce qui couvre le reste : le typage TypeScript (`serviceClient` exige un `AuthContext`), la revue du code à chaque jalon, la revue de sécurité des Edge Functions (J3, skill `performing-serverless-function-security-review`) et les tests d'abus de J6.

Une première version des règles ne détectait que l'écriture la plus directe ; c'est le test d'évasion qui l'a montré. Les tests de règles (`security/semgrep/*.ts`) sont maintenant lancés en CI, et le scan utilise `--strict` : une règle qui échoue à s'exécuter fait échouer la CI au lieu de se taire (cela s'est produit pendant la mise au point).

## 4. La CI en détail

Trois workflows, déclenchés à chaque push, sur les pull requests vers `main`, à la demande, et chaque lundi. Le workflow « Base de données » ne se déclenche que si `supabase/` change.

| Workflow | Job | Ce qu'il fait |
|---|---|---|
| Sécurité | Secrets (gitleaks) | Teste la configuration gitleaks, puis scanne **tout l'historique** |
| | Analyse statique (Semgrep) | Tests des règles, contrôle des exceptions, scan avec les règles du projet et les jeux `p/typescript` et `p/owasp-top-ten` du registre Semgrep |
| | Workflows GitHub | actionlint (syntaxe) et zizmor (sécurité des workflows) |
| | CodeQL (optionnel) | Désactivé par défaut (voir § 6) |
| Base de données | Migrations et tests d'isolation | Applique les migrations sur un **PostgreSQL 16 jetable** du runner (avec pgvector), charge la graine de démonstration, lance les 277 vérifications d'isolation, de circuit des actions, de mode ombre et de conservation. **Jamais sur un projet Supabase** |
| | Test de mutation | À chaque pull request vers `main`, chaque lundi et à la demande : casse volontairement chacune des 33 défenses dans une copie des migrations et exige que **le test prévu pour elle** échoue (un test qui n'a jamais échoué ne prouve rien) |
| Chaîne d'approvisionnement | Dépendances | **Dort tant qu'il n'y a pas de `package-lock.json`.** Ensuite : `npm ci` sans scripts, `npm audit`, signatures du registre, OSV-Scanner, GuardDog (informatif), Snyk si un jeton est configuré |
| | SBOM | Inventaire CycloneDX (Syft) conservé 90 jours, analysé par Grype (échoue sur une faille grave **corrigeable**) |

Choix de durcissement : permissions nulles au niveau du workflow puis `contents: read` par job ; `persist-credentials: false` ; aucune donnée d'événement (titre de PR, nom de branche) interpolée dans un script ; **actions épinglées par SHA** dont l'existence a été vérifiée contre les dépôts amont ; binaires installés par `scripts/ci/install-release.sh`, qui compare le SHA-256 écrit dans le workflow (une archive modifiée fait échouer l'étape) ; outils Python installés avec `--require-hashes` depuis `security/requirements/` ; Dependabot avec un délai de 7 jours avant d'adopter une version toute fraîche.

## 5. En local

```bash
scripts/dev-setup.sh          # installe les hooks (une fois ; demande pre-commit et Go)
pre-commit run --all-files    # tout vérifier à la demande
```

Les hooks : gitleaks et contrôles de base à chaque commit, interdiction de commiter sur `main`, contrôle des exceptions Semgrep ; Semgrep avant chaque push.

Pour les outils qui ne sont pas des hooks :

```bash
semgrep --test --metrics=off security/semgrep   # tests des règles du projet
scripts/test-gitleaks-config.sh                 # tests de la configuration gitleaks (variable GITLEAKS si besoin)
scripts/test-check-no-real-data.sh              # tests du garde-fou contre les données réelles de pilote
```

## 6. Réglages GitHub à faire de votre côté

Le dépôt est **public** : les fonctions de sécurité de GitHub ci-dessous sont gratuites. Je n'ai pas accès aux réglages du dépôt depuis cette session (l'accès aux réglages Actions est refusé), donc rien de ceci n'est fait :

- [ ] **Actions, Général, permissions des workflows** : « Read repository contents », et décocher « Allow GitHub Actions to create and approve pull requests ».
- [ ] **Actions, Général, pull requests de forks** : exiger l'approbation pour **tous** les contributeurs extérieurs (un dépôt public reçoit des forks).
- [ ] **Actions, Général** : si l'option « Require actions to be pinned to a full-length commit SHA » est proposée, l'activer.
- [ ] **Sécurité du code** : activer les alertes Dependabot et les mises à jour de sécurité, **l'analyse des secrets avec la protection au push** (elle refuse le push d'un secret connu avant qu'il n'arrive), et le **signalement privé des vulnérabilités**.
- [ ] **CodeQL** : ajouter la variable de dépôt `ENABLE_CODEQL=true` (Paramètres, Secrets et variables, Actions, Variables). Le job est prêt et sauté tant que la variable est absente.
- [ ] **Protection de `main`** (jeu de règles) : pull request obligatoire, contrôles requis `Secrets (gitleaks)`, `Analyse statique (Semgrep)`, `Workflows GitHub (actionlint, zizmor)`, `Dépendances (npm audit, OSV, GuardDog, Snyk)`, `Inventaire des composants (SBOM)`, interdiction du force-push et de la suppression. N'exiger la revue des propriétaires de code (`CODEOWNERS`) qu'à l'arrivée d'une deuxième personne : on ne peut pas approuver sa propre pull request.
- [ ] **Optionnel, Snyk** : compte gratuit puis secret de dépôt `SNYK_TOKEN`. Sans lui, les autres contrôles de dépendances fonctionnent.

## 7. Si un secret fuite

1. **Révoquer ou faire tourner le secret tout de suite**, avant toute autre action. Réécrire l'historique Git ne suffit jamais : le secret doit être considéré comme connu.
2. Vérifier les journaux d'accès du service concerné (Supabase, Mistral, Microsoft Entra, connecteur) pour la période d'exposition.
3. Corriger la cause (la règle gitleaks, ou le fichier ajouté à `.gitignore`).
4. Le noter dans le journal d'incident (modèle prévu en J7).

## 8. Risques acceptés et points à surveiller

- **Jeton Snyk hors « environnement » GitHub** (relevé par zizmor en mode auditeur) : le jeton ne sert qu'à lancer des scans et est optionnel ; un environnement dédié n'est pas garanti sur une offre gratuite.
- **GuardDog est informatif** tant que le premier lot de dépendances n'a pas été trié (il signale aussi des comportements légitimes). À rendre bloquant avec une liste d'exceptions justifiées.
- **Les jeux de règles du registre Semgrep ne sont pas épinglés** : ils évoluent sans que nous le décidions. Nos propres règles, elles, sont versionnées et testées.
- **Le dépôt est public** (menaces M34 et M40) :
  - les **journaux de CI sont lisibles de tous** : aucun script n'y affiche de valeur sensible, et le garde-fou contre les données de pilote n'affiche que le fichier, la ligne et le type de donnée ;
  - les pull requests de forks s'exécutent sans accès aux secrets (`pull_request`, jamais `pull_request_target`, ce que zizmor surveille) ;
  - **l'historique est définitif** : tout commit publié peut déjà avoir été copié. L'historique ne contient aucun secret (gitleaks), mais il contient l'adresse e-mail professionnelle de l'auteur du premier commit et des documents commerciaux (marché, modèle économique, go-to-market, synergies, conditions envisagées pour les revendeurs). Ce qui doit rester public est une **décision du fondateur** ;
  - le modèle de menace est public : il ne doit jamais être la seule défense (la sécurité ne repose pas sur le secret de l'architecture).
- **Dependabot npm** sera ajouté avec le premier `package-lock.json`.
- **Pas de test de la CI par un commit volontairement fautif sur GitHub** : les preuves de blocage sont les tests exécutés localement et les auto-tests exécutés en CI (§ 9).

## 8 bis. Ce que les tests de base de données ne prouvent pas

- Ils tournent sur PostgreSQL 16 avec des **imitations** des rôles, de `auth` et de Vault (`supabase/tests/harness/`) : ils prouvent nos migrations et nos politiques, pas la configuration d'un projet Supabase hébergé. À vérifier une fois sur le vrai projet : `recent_mfa` lit le champ `amr` du jeton, dont le format réel est à confirmer ; les schémas exposés doivent se limiter à `public` ; les inscriptions libres doivent être désactivées.
- Le test de mutation prouve que les 33 défenses listées sont vues, pas que la liste est complète : chaque nouvelle règle de sécurité ajoute sa mutation à `supabase/tests/mutations.json`.
- Le journal d'audit est en insertion seule pour tous les rôles de la base, mais **le propriétaire du projet Supabase peut toujours le modifier** en désactivant le déclencheur : seule une chaîne de hachage conservée hors de la base (backlog B08) le rendrait vérifiable.

## 9. État des lieux à la fin de J0

**Vérifié sur GitHub** (exécution réelle des deux workflows sur la branche de travail, toutes les étapes vertes, y compris à la dernière exécution, garde-fou contre les données de pilote compris) : gitleaks sur les 17 commits, avec le test de configuration ; 15 tests de règles Semgrep, contrôle des exceptions, scan de 21 fichiers avec 578 règles chargées, 0 résultat ; actionlint et zizmor ; SBOM CycloneDX produit et analysé par Grype (0 composant, 0 faille, puisqu'il n'y a pas encore de dépendances).

**Vérifié en local, avec preuve de blocage** : le hook gitleaks refuse un commit contenant une fausse clé Supabase ; le hook Semgrep refuse un fichier qui lit la clé `service_role` ; le contrôle des exceptions refuse trois cas (exception sans justification, sans règle nommée, ou dans un fichier non prévu) ; l'installateur refuse une archive dont l'empreinte diffère et un hôte inattendu ; l'installation avec `--require-hashes` refuse un fichier de verrouillage altéré ; sur un projet jetable, `npm audit` et OSV-Scanner réussissent sur une dépendance saine et **échouent** sur `lodash@4.17.20`.

**Non vérifié** : les étapes de dépendances n'ont pas tourné **sur GitHub** (pas de `package-lock.json`) ; Dependabot n'a pas encore ouvert de pull request ; Snyk et CodeQL ne sont pas activés (CodeQL : une variable à ajouter par vous) ; les réglages GitHub du § 6 ne sont pas faits ; le garde-fou contre les données de pilote n'a jamais vu de vraie donnée de pilote, seulement des cas fabriqués (et ne peut pas reconnaître un nom de personne ou un nom de machine) ; les règles Semgrep n'ont jamais été exécutées sur du vrai code applicatif (il n'y en a pas encore), seulement sur leurs fixtures.

## Sources

| Fiabilité | Source | Utilisée pour |
|---|---|---|
| ★★★ | [ANSSI, *Les essentiels : Sécuriser un système IA agentique*, V1.0 (10/26)](https://messervices.cyber.gouv.fr/documents-guides/anssi_essentiels_ia_agentique_1.0.pdf), principes 5 à 7 | Contrôle déterministe hors modèle, secrets hors contexte et journaux, inventaire des composants et vérification de leur provenance |
| ★★★ | [ANSSI et BSI, *AI Coding Assistants*](https://cyber.gouv.fr/nous-connaitre/publications/publications-internationales/ai-coding-assistants/) (document en anglais) | Relire et vérifier le code produit par un assistant IA, vérifier l'existence des bibliothèques (paquets inventés par le modèle), ne pas transmettre de secrets |
| ★★★ | [ANSSI-PA-102, *Recommandations de sécurité pour un système d'IA générative*](https://messervices.cyber.gouv.fr/guides/recommandations-de-securite-pour-un-systeme-dia-generative) (29 avril 2024) | Ne pas exécuter ni commiter automatiquement du code généré ; vérifier les bibliothèques référencées |
| ★★★ | [CERT-FR, CERTFR-2026-CTI-001 (4 février 2026)](https://cert.cyber.gouv.fr/uploads/CERTFR-2026-CTI-001.pdf), § 2.2 | *Slopsquatting* : paquets malveillants portant des noms imaginés par une IA |
| ★★★ | [ANSSI et partenaires, *A Shared Vision of Software Bill of Materials (SBOM) for Cybersecurity*](https://cyber.gouv.fr/nous-connaitre/publications/publications-internationales/a-shared-vision-of-software-bill-of-materials-sbom-for-cybersecurity/) (document en anglais, 2025) | Pratique du SBOM |
| ★★★ | [ENISA, *Threat Landscape 2025*](https://www.enisa.europa.eu/sites/default/files/2026-01/ENISA%20Threat%20Landscape%202025_v1.2.pdf) | Ciblage de la chaîne d'approvisionnement numérique |
| ★★★ | [Règlement (UE) 2024/2847, *Cyber Resilience Act*](https://eur-lex.europa.eu/eli/reg/2024/2847/oj/eng) | Gestion des vulnérabilités et des composants ; **applicabilité à un service en ligne à confirmer par un juriste** |
| ★★ | Documentation des outils (gitleaks, Semgrep, zizmor, actionlint, OSV-Scanner, Syft, Grype, GuardDog) | Syntaxe et options, vérifiées en exécutant les commandes |
