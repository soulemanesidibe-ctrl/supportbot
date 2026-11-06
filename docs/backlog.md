# Backlog

Tout ce qui dépasse le jalon en cours est noté ici au lieu d'être fait (règle du projet). Une ligne = une tâche, avec son origine et le jalon où elle sera reprise.

| ID | Tâche | Origine | Reprise en |
|---|---|---|---|
| B01 | Exporter le modèle de menace au format JSON d'OWASP Threat Dragon (diagramme de flux dessiné dans l'outil) et le versionner à côté de `docs/threat-model.md` | J0 : le modèle v1 est en Markdown avec diagramme Mermaid ; l'export Threat Dragon n'a pas pu être validé dans l'outil depuis cet environnement | Avant J4 (premier connecteur Microsoft 365) |
| B02 | Activer CodeQL (workflow prêt mais désactivé) : exige GitHub Advanced Security si le dépôt reste privé, ou un dépôt public | J0 : le dépôt est privé | À décider avec le fondateur avant J6 |
| B03 | Analyse antivirus des pièces jointes (captures d'écran, fichiers) avant stockage durable | Modèle de menace M20 | J3 ou J7 |
| B04 | Interface : parcours clairs par rôle (ce que je vois, ce que je peux faire, ce que je ne peux pas faire) et indicateurs de valeur de production à définir avec le fondateur | Consigne du fondateur du 5 novembre 2026 | J1 (spec) puis J5 |
| B05 | Rendre vérifiable l'engagement « même l'éditeur ne lit pas vos données sans votre accord » : chiffrement applicatif par organisation du contenu des conversations (clés dans Vault), car la RLS n'empêche pas le propriétaire du projet Supabase de lire la base | Modèle de menace M30 | Avant le premier client payant |
| B06 | Au premier `package-lock.json` : ajouter npm à Dependabot, vérifier sur GitHub les étapes de dépendances (qui n'ont tourné qu'en local), trier les alertes GuardDog puis le rendre bloquant, et revoir la règle `releve-env-bulk-read` pour la configuration Vite si elle gêne | J0 : ces étapes dorment sans fichier de verrouillage | Premier jalon applicatif (J3 ou J5) |

## Compléments de jalons (message du fondateur du 5 novembre 2026)

Rôles, administration multi-clients et tableaux de bord : source de référence `docs/10-roles-administration-cockpits.md`. Ces points s'ajoutent aux jalons du prompt de démarrage.

| Jalon | Ajout |
|---|---|
| J0 | Modèle de menace : abus de rôle (technicien qui change d'organisation dans la requête, ESN sans relation approuvée, élévation de rôle par une invitation) et abus de l'accès d'assistance de la plateforme. **Fait dans `docs/threat-model.md`.** |
| J1 | La spec couvre les parcours des 8 rôles de docs/10 (super administrateur, administrateur et responsable de compte ESN, technicien, administrateur client, direction, auditeur, salarié, valideur suppléant) et les parcours d'administration : nouvelle ESN, nouveau client via ESN, client direct, import des salariés (Entra ID ou CSV), départ d'un technicien, fin de contrat ESN. **Décision fondateur : une ESN peut créer elle-même ses clients** (docs/10 §4). |
| J2 | `organizations.type` (platform / partner / client) et étiquettes ; `partner_relationships` (rôles approuvés, approuvé par, expire le, révocable par le client seul) ; `partner_assignments` (technicien × client × rôle × date de fin) ; `support_access_grants` (motif, approuvé par le client, lecture seule, 4 h par défaut) ; `invitations` (usage unique, expirantes) ; `access_reviews` (trimestrielles). Rôles : super_admin, platform_support, partner_admin, partner_manager, partner_technician, org_admin, org_technician, org_viewer, auditor, end_user. Fonction `partner_can_access()` (relation ET assignation actives). Le super administrateur n'a AUCUNE lecture des données clients hors accès d'assistance actif. Script d'isolation : technicien non assigné ou assignation expirée = rien ; relation révoquée = tout coupé ; super administrateur sans accès d'assistance = rien. |
| J3 | Chaque Edge Function revérifie côté serveur l'organisation active et le rôle à chaque requête, en plus de la RLS. Réauthentification MFA exigée pour : créer une organisation, approuver une relation, déléguer, changer un niveau d'autonomie, ouvrir un accès d'assistance. |
| J5 | Un tableau de bord d'accueil par rôle (docs/10 §5), indicateurs définis par docs/10 §6 sans sigle à l'écran, graphiques avec `/dataviz`. Écrans d'administration : création d'ESN et de clients, invitations, relations ESN-client (demande, approbation, révocation), assignations, accès d'assistance, revues trimestrielles. Skills en plus : `design-critique`, `ux-review`. |
| J6 | Tests d'abus de rôle : changement d'organisation dans la requête, ESN sans relation, assignation expirée, accès d'assistance expiré, élévation de rôle par une invitation. Skills en plus : `testing-api-for-broken-object-level-authorization`, `performing-access-review-and-certification`, `building-identity-governance-lifecycle-process`. |
| J8 | Compte super administrateur dédié, distinct du compte de travail, protégé par passkey (`implementing-passwordless-authentication-with-fido2`). Vue ESN multi-clients ajoutée au scénario de démonstration. |

### Règles de création de client par une ESN (décision du fondateur)

- À la création, la relation ESN-client est créée en même temps, active, pour que l'ESN puisse configurer le client.
- L'ESN invite l'administrateur du client ; à l'activation de son compte, il voit la relation, la confirme ou la réduit, et garde le droit de la révoquer seul.
- Réauthentification MFA de l'administrateur ESN, notification au super administrateur, plafond de clients selon l'offre partenaire.
- Le client est rattaché à l'offre partenaire de l'ESN pour la facturation.
- Un client créé par une ESN ne peut pas être rattaché à une autre ESN sans l'accord de son administrateur.
