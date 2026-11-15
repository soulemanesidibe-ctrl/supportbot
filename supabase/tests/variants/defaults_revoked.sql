-- Variante du banc d'essai : imite un projet Supabase où l'option « Automatically expose new tables » est DÉSACTIVÉE
-- (la plateforme annonce que ce sera le défaut des nouveaux projets) : plus aucun droit automatique sur les nouveaux objets.
-- Usage : REVOKED_DEFAULTS=1 supabase/tests/run.sh
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
