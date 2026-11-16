# GLPI de développement (local)

Sert uniquement à essayer le connecteur GLPI de Relève sur un poste de développement. Pour la démonstration, utilisez une instance
**hébergée** (essai GLPI Cloud de 45 jours) : les fonctions tournent chez Supabase et ne joignent pas un poste.

1. `cp .env.example .env`, puis changez le mot de passe de la base.
2. `docker compose up -d`, puis ouvrez <http://localhost:8080> et suivez l'assistant d'installation de GLPI.
3. Dans GLPI : *Configuration > Générale > API* : activez l'API REST et notez si un *App-Token* est exigé ; créez un utilisateur de test
   et son **jeton d'accès distant** (préférences de l'utilisateur, « Remote access key »).
4. Les jetons ne vont **jamais** dans ce dépôt : ils se saisissent par l'opération d'administration `connector.create_glpi`.

Contrôles de contrat à faire à la première connexion (voir `supabase/functions/_shared/connectors/glpi.ts`) : valeurs de statut des
tickets, type de lien « fils de », champs d'un suivi, numéros de colonnes de recherche.
