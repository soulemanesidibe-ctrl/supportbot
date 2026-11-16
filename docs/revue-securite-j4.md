# Revue de sécurité des connecteurs, des alertes et des automatisations (jalon J4)

**Date :** 16 novembre 2026. **Périmètre :** le socle des connecteurs (`_shared/connectors/`), les connecteurs GLPI, démo et Microsoft 365, le lien du compte Microsoft du technicien (T12), la fonction `alerts-ingest`, le moteur d'automatisations et la tâche `alerts-tick`, les migrations 14 et 15. **Ce n'est pas** un test d'intrusion externe ni un essai sur un projet déployé : tout a été vérifié sur le code, par les tests (409 tests Deno, 436 vérifications SQL), par les règles Semgrep du projet et par les tests de mutation, **suites complètes** rejouées avant ce rapport : 255 défenses cassées exprès côté fonctions et 108 côté base, **toutes** détectées par le test prévu pour elles. Les contrats réels de GLPI et de Microsoft Graph restent à vérifier sur les instances d'essai (B19, et `docs/permissions-graph.md` § 4).

**Méthode.** Skills : `exploiting-server-side-request-forgery` (modèle d'attaque du client sortant), `implementing-api-key-security-controls` (secrets des connecteurs et des sources), `performing-oauth-scope-minimization-review` et `testing-oauth2-implementation-flaws` (Microsoft Graph), `securing-agentic-ai-tool-invocation` (porte des automatisations), `detecting-indirect-prompt-injection` (alertes comme données), `performing-serverless-function-security-review` (transposé aux Edge Functions, comme en J3). Cadres français de référence déjà adoptés : [ANSSI, *Les essentiels : Sécuriser un système IA agentique*, V1.0](https://messervices.cyber.gouv.fr/documents-guides/anssi_essentiels_ia_agentique_1.0.pdf) et [ANSSI-PA-102, *Recommandations de sécurité pour un système d'IA générative*](https://messervices.cyber.gouv.fr/guides/recommandations-de-securite-pour-un-systeme-dia-generative).

## 1. Inventaire (ajouts du jalon)

| Porte | Déclencheur | Garde d'entrée | Limiteur | Ce qu'elle écrit |
|---|---|---|---|---|
| `alerts-ingest` | HTTPS, POST, `/alerts-ingest/<source>` | `requireWebhookSource` : HMAC-SHA-256 sur les octets reçus, horodatage à 5 minutes, même réponse pour tout refus | 120 par minute et par source, 600 par organisation, APRÈS la signature | alertes et leurs événements (une transaction), dernier signe de vie de la source |
| `cron?job=alerts-tick` | HTTPS, POST, chaque minute (à planifier, B27) | `requireCronSecret`, puis `scopeCronToOrg` par organisation | sans objet (budget de 50 secondes) | incidents, tickets, messages FIXES aux salariés, notifications, propositions de clôture, registre des règles |
| `admin` (ajouts) | HTTPS, POST | inchangée | inchangé | connecteurs GLPI et Microsoft 365, lien du compte Microsoft d'un technicien, état d'une règle d'automatisation (`automation.set_state` : l'organisation choisit l'état, jamais la définition ; second facteur pour activer) |

## 2. Ce qui a été vérifié, menace par menace

- **SSRF par l'adresse d'un connecteur (M16, M26).** Un seul client sortant (`connectors/http.ts`) : https, port 443, nom public, aucune adresse IP sous aucune forme, aucun suffixe interne, pas d'identifiants dans l'adresse, aucune redirection suivie, délai et taille bornés. Règle Semgrep `releve-direct-fetch` contre tout autre appel. **Reste** : un nom public qui se résout vers une adresse privée n'est arrêté que par la liste blanche `CONNECTOR_ALLOWED_HOST_SUFFIXES`, à renseigner pour le pilote (R4-05).
- **Écriture par l'IA dans l'annuaire (M05).** L'application Relève n'a **aucune** permission Graph d'écriture ; les quatre actions utilisent seulement le jeton délégué du technicien qui valide, vérifié par Microsoft (`/me`) au moment du lien, et le lien est revérifié à l'exécution. Permissions minimales justifiées une à une (`docs/permissions-graph.md`).
- **Webhook (SEC-17).** Signature fausse, corps modifié, autre secret, horodatage hors des 5 minutes (passé ou futur), source inconnue, désactivée ou d'une organisation suspendue : même 401, sans enregistrement ni consommation du débit. Rejeu : refusé par la base dans la même transaction que l'enregistrement (une livraison refusée n'est jamais marquée reçue, donc jamais perdue). Corps de plus de 64 Ko : refusé avant toute lecture de la base. Organisation prise dans la source, jamais dans la charge.
- **Alerte piégée (SEC-18, M01, M35).** Le moteur ne voit que des champs typés et bornés (`typedContext`) ; les conditions ne portent que sur une liste fermée de champs ; les actions sont une liste fermée ; les messages aux salariés sont des gabarits FIXES dont la seule variable est un libellé de catégorie tiré d'une liste fermée ; le ticket parent ne contient ni le résumé ni le texte de l'alerte. Testé de bout en bout : une alerte qui ordonne de réinitialiser un mot de passe ne produit ni action, ni texte, ni appel autre que « créer un ticket » et « lier deux tickets ».
- **Tempête d'automatisations (M21).** Plafonds appliqués par la base, atomiquement, AVANT tout effet : une exécution par déclencheur, nombre par heure, délai par périmètre, simulation. Une règle illisible est inerte. Arrêt d'urgence : aucune automatisation, seulement l'inscription de la raison.
- **Isolation entre organisations.** Chaque fonction SQL reçoit l'organisation du contexte et la revérifie ; les motifs d'actifs, les demandes comptées et les règles d'une autre organisation ne sont jamais pris (testé, et cassé volontairement par des mutations). Notifications : chacun ne lit que les siennes, et seulement tant qu'il a accès au client.

## 3. Constats

| N° | Gravité | Constat | État |
|---|---|---|---|
| R4-01 | **Moyenne** | **Défaut de J3** : l'exécuteur des actions transmettait au connecteur les paramètres libres de l'action, sans sa cible. | **Corrigé** : la cible vient toujours de l'action approuvée (couverte par l'empreinte validée). Tests et mutations. |
| R4-02 | Moyenne | Clé de déduplication d'une alerte tronquée à 300 caractères AVANT d'être remplacée par son empreinte : deux alertes différentes pouvaient se confondre (l'une masquant l'autre). Trouvé par les tests. | **Corrigé** : bornée à 2 000 caractères, puis empreinte au-delà de 300. Test et mutation. |
| R4-03 | Faible | Le secret de remplacement (calcul identique pour une source inconnue) était une constante du dépôt public. | **Corrigé** : tiré au hasard à chaque démarrage. Trouvé par un test de mutation non détecté. |
| R4-04 | Faible | Un test SQL de validation utilisait `bool_and`, qui ignore les valeurs nulles : une alerte acceptée à tort passait ce test. Trouvé par 3 mutations détectées par le mauvais test. | **Corrigé**. |
| R4-05 | À traiter | Résolution DNS vers une adresse privée (suite de R3-11). | **Ouvert, pilote** : renseigner `CONNECTOR_ALLOWED_HOST_SUFFIXES` avec le domaine GLPI du client. |
| R4-06 | À traiter | Un seul secret client d'application lit l'annuaire de tous les clients consentants. | **Ouvert** (B20) : certificat et rotation avant le premier client payant. |
| R4-07 | Limite | Règles de risque X1 (rôles par groupe, PIM) et X2 (téléphone, e-mail, code logiciel ajoutés récemment) incomplètes. | Documenté (B23, B24) ; à traiter avant le niveau 1 chez un pilote. |
| R4-08 | À vérifier | Contrats réels de GLPI (statuts, lien « fils de », champs) et de Microsoft Graph (licence pour l'historique des connexions). | **Au démarrage des essais**, guidé (B19). |
| R4-09 | À traiter | Sans la planification de `alerts-tick`, aucune confirmation à l'échéance, aucun regroupement, aucun silence détecté. | **Premier déploiement**, guidé (B27). |
| R4-10 | Info | Chaque requête non signée coûte une lecture de la base et un calcul HMAC avant d'être refusée. | **Accepté** (comme R3-05) : coût borné, protection volumétrique par la plateforme. |
| R4-11 | Info | Cinq tests de mutation anciens ne correspondaient plus au code (le banc les signalait « motif introuvable »). | **Corrigé** ; vérification de toutes les mutations avant chaque rapport de jalon. |
| R4-12 | À traiter | SEC-32 : le flux OAuth du technicien (PKCE, état) se fait dans la console. Côté serveur, le jeton est vérifié par Microsoft et rattaché au bon tenant. | **J5**, avec la bibliothèque officielle de Microsoft dans la console. |
| R3-10 | Mis à jour | Signature du jeton Microsoft du valideur. | **Traité autrement** : le jeton est vérifié par Microsoft (`/me`) au moment du lien ; à l'exécution, Microsoft Graph refuse un jeton falsifié et le lien est revérifié. |

## 4. Ce que cette revue ne couvre pas

Les essais sur les instances réelles (GLPI Cloud, tenant Microsoft de test), un essai sur le projet Supabase déployé, la lecture des alertes par l'IA (J6, avec un jeu d'essai d'injections), l'interface (J5) et un audit externe, toujours recommandé avant le premier client payant.
