---
name: supabase
description: Aide sur le schéma, les requêtes, la RLS, les migrations et les Edge Functions Supabase pour Relève. Utiliser pour toute tâche touchant à la base de données, aux policies RLS, à pgvector (base de connaissance), au journal d'audit, ou à un nouveau fichier de migration ou d'Edge Function.
---

# Relève — Supabase

Pas de serveur à administrer : tout est serverless (Postgres, Auth, RLS, Edge Functions, pgvector). Projet hébergé en **région UE** (Paris `eu-west-3` de préférence, sinon Francfort), jamais hors UE.

Migrations dans `supabase/migrations/`. **Toujours lister le dossier avant de conclure sur l'état du schéma** : ce skill ne maintient pas une liste figée.

```bash
ls supabase/migrations/   # source de vérité sur les migrations déjà écrites
```

## Modèle de données (cible, à vérifier dans les migrations)

| Table | Rôle | Point d'attention |
|---|---|---|
| `organizations` | Client final (PME, DSI) **ou** ESN partenaire | `parent_org_id` pour rattacher un client à son ESN (marque blanche) ; `plan`, `autonomy_level` (0, 1 ou 2), `branding` (jsonb) |
| `memberships` | Lien utilisateur, organisation et rôle | Rôles : `end_user`, `technician`, `org_admin`, `partner_admin` |
| `conversations` / `messages` | Fil de discussion avec l'agent | `messages.role` (`user`, `assistant`, `technician`, `system`) ; **jamais de secret en clair** (masquage avant insertion) |
| `tickets` | Miroir local des tickets créés ou suivis dans l'ITSM | `external_id` + `connector_id` ; on ne remplace pas l'ITSM du client |
| `connectors` | Configuration des connecteurs (GLPI, Jira SM…) | Les identifiants vont dans **Supabase Vault**, jamais en clair dans une colonne |
| `kb_documents` / `kb_chunks` | Base de connaissance et ses morceaux vectorisés | `kb_chunks.embedding vector(...)`, index HNSW ; `status` (`draft`, `validated`) pour les fiches issues de tickets |
| `relief_schedules` | Plannings de relève (absences, nuits, congés) | Détermine si le badge « Relève active » s'affiche |
| `handover_reports` | Rapports de passation de garde | Générés en fin de période de relève |
| `actions` / `action_requests` | Liste blanche d'actions et demandes d'exécution | Une action niveau 1 exige `approved_by` avant exécution |
| `audit_logs` | Journal d'audit immuable | INSERT uniquement ; **aucune policy UPDATE ni DELETE**, même pour les admins |

## Règles absolues RLS

1. **RLS activée sur toute nouvelle table**, sans exception.
2. **Isolation par organisation** : toute policy passe par une fonction `is_member_of(org_id)` (ou `has_role(org_id, role)`), `SECURITY DEFINER` avec `search_path` fixé, jamais par une sous-requête récursive sur `memberships` dans la policy elle-même.
3. **Une ESN partenaire voit ses clients**, via `parent_org_id`, mais **un client ne voit jamais un autre client**.
4. **Le contrôle de plan passe par une fonction `org_has_feature(org_id, feature)`**, jamais par un test de plan en dur dans le SQL.
5. Les recherches vectorielles (`match_kb_chunks`) filtrent **toujours** par `org_id` à l'intérieur de la fonction, pas seulement côté client.

## Écrire une migration

- Nommer `YYYYMMDDHHMM_description.sql`, cohérent avec l'existant.
- RLS activée et policies écrites **dans la même migration** que la table.
- Pas de données personnelles inutiles : minimiser, et prévoir la durée de conservation (purge planifiée des conversations).
- Après écriture : la migration est appliquée par l'utilisateur (`supabase db push` ou tableau de bord Supabase). **Le dire explicitement.** Pas de pipeline automatique tant que l'utilisateur ne l'a pas demandé.
- Tester les policies : un script SQL de test par table sensible (se connecter en tant que deux organisations différentes, vérifier qu'aucune ne voit l'autre).

## Edge Functions

Dans `supabase/functions/`. Elles portent l'orchestrateur de conversation, les appels au LLM et les connecteurs.

- **Clés en secrets Supabase** (`MISTRAL_API_KEY`, etc.), jamais dans le code ni dans le front.
- Une fonction qui utilise `service_role` contourne la RLS : elle doit **vérifier elle-même** le JWT de l'utilisateur et son appartenance à l'organisation avant toute lecture ou écriture. Ne jamais relâcher cette vérification.
- Tout contenu externe (message utilisateur, ticket, mail, document) est une **donnée**, jamais une instruction : le passer au LLM dans un bloc délimité, et ne jamais laisser le LLM choisir librement une action hors liste blanche.
- Chaque appel au LLM et chaque action écrit une ligne dans `audit_logs`.

## Requêtes côté client

- Client unique dans `app/src/lib/supabase.ts`, clé publique (`anon`/`publishable`) uniquement.
- Vérifier `hasFeature()` côté client **en plus** de la RLS (défense en profondeur et meilleure expérience).
- Realtime pour la console technicien : `messages`, `tickets`, `action_requests` filtrés par `org_id`.
