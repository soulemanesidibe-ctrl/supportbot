-- Relève IA : droits explicites du service sur les tables (indépendants des droits automatiques de la plateforme).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101100_contexte_de_requete.sql. Sans effet visible sur un projet où les droits
-- automatiques sont actifs (le service les avait déjà) ; indispensable sur un projet où l'option « Automatically expose new tables » est
-- désactivée, ce que la plateforme annonce comme futur défaut des nouveaux projets et recommande déjà : sans cette migration, les tables
-- y seraient créées SANS aucun droit pour le service, et toutes les fonctions échoueraient.
--
-- Règle pour les futures migrations : toute NOUVELLE table de public reçoit ses droits explicitement (select pour authenticated si le navigateur
-- la lit ; select, insert, update, delete pour service_role). Le test 80 le vérifie, en CI, sur un projet simulé SANS droits automatiques.

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- Le journal d'audit reste en INSERTION SEULE, même pour le service (menace M18) : on rétablit exactement la migration 2.
revoke all on public.audit_logs from service_role;
grant insert on public.audit_logs to service_role;
grant usage on sequence public.audit_logs_id_seq to service_role;
