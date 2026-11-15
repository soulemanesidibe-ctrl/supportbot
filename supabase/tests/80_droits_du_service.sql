-- Droits explicites du service (migration 12) : aucune table sans droits, le journal d'audit reste en insertion seule.
-- Ce test est surtout éloquent sur la variante REVOKED_DEFAULTS=1 (projet sans droits automatiques), jouée aussi en CI.
select test.expect('droits du service : AUCUNE table publique (hors journal d''audit) sans lecture ni écriture pour le service',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'audit_logs'
      and not (has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
               and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete'))) = 0);
select test.expect('droits du service : le journal d''audit reste en INSERTION seule (ni lecture, ni modification, ni suppression)',
  has_table_privilege('service_role', 'public.audit_logs', 'insert')
  and not has_table_privilege('service_role', 'public.audit_logs', 'update')
  and not has_table_privilege('service_role', 'public.audit_logs', 'delete')
  and not has_table_privilege('service_role', 'public.audit_logs', 'truncate'));
select test.expect('droits du service : le navigateur n''a toujours AUCUN droit d''écriture (la migration 12 ne l''élargit pas)',
  (select count(*) from information_schema.role_table_grants
    where grantee in ('authenticated', 'anon') and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) = 0);
select test.expect('droits du service : l''anonyme n''a aucun droit sur les tables publiques',
  (select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public') = 0);
