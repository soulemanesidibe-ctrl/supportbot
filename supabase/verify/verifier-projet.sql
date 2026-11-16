-- VÉRIFICATION EN LECTURE SEULE d'un projet Supabase, après application des 17 migrations.
-- Ne modifie rien. À coller en entier dans « SQL Editor » (une seule requête) puis Run.
-- Lecture : la colonne « ok » doit valoir true sur toutes les lignes automatiques ; une ligne false se copie-colle telle quelle à Claude.
-- Les lignes « à regarder » n'ont pas de verdict automatique (ok est vide) : comparez avec la colonne « attendu ».
with
tables_public as (
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
checks(ordre, controle, attendu, trouve, ok) as (
  select 1, 'Tables du schéma public', '40',
         (select count(*)::text from tables_public),
         (select count(*) = 40 from tables_public)
  union all
  select 2, 'Tables SANS sécurité par ligne (RLS)', '0',
         (select count(*)::text from tables_public where not relrowsecurity),
         (select count(*) = 0 from tables_public where not relrowsecurity)
  union all
  select 2.5, 'Tables publiques (hors journal d''audit) SANS droits complets pour le service', '0',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'audit_logs'
             and not (has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
                      and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete'))),
         (select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'audit_logs'
             and not (has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
                      and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete')))
  union all
  select 2.7, 'Tables sous RLS SANS la politique « second facteur obligatoire » (migration 16)', '0',
         (select count(*)::text from tables_public t where t.relrowsecurity
            and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                              and p.policyname = t.relname || '_second_facteur' and p.permissive = 'RESTRICTIVE')),
         (select count(*) = 0 from tables_public t where t.relrowsecurity
            and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                              and p.policyname = t.relname || '_second_facteur' and p.permissive = 'RESTRICTIVE'))
  union all
  select 3, 'Droits du rôle anonyme sur les tables publiques', '0',
         (select count(*)::text from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
         (select count(*) = 0 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public')
  union all
  select 4, 'Droits d''ÉCRITURE du navigateur (rôle authenticated) sur les tables publiques', '0',
         (select count(*)::text from information_schema.role_table_grants
           where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
         (select count(*) = 0 from information_schema.role_table_grants
           where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
  union all
  select 5, 'Droits de modification ou de suppression du service sur le journal d''audit', '0',
         (select count(*)::text from information_schema.role_table_grants
           where grantee = 'service_role' and table_name = 'audit_logs' and table_schema = 'public'
             and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')),
         (select count(*) = 0 from information_schema.role_table_grants
           where grantee = 'service_role' and table_name = 'audit_logs' and table_schema = 'public'
             and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE'))
  union all
  select 6, 'Verrous du journal d''audit (insertion seule)', '2',
         (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where c.relname = 'audit_logs' and not t.tgisinternal and t.tgname in ('audit_logs_no_update_delete', 'audit_logs_no_truncate')),
         (select count(*) = 2 from pg_trigger t join pg_class c on c.oid = t.tgrelid
           where c.relname = 'audit_logs' and not t.tgisinternal and t.tgname in ('audit_logs_no_update_delete', 'audit_logs_no_truncate'))
  union all
  select 7, 'Le rôle anonyme peut appeler les fonctions internes (purge)', 'false',
         has_function_privilege('anon', 'private.purge_expired()', 'execute')::text,
         not has_function_privilege('anon', 'private.purge_expired()', 'execute')
  union all
  select 8, 'Le navigateur (authenticated) peut lancer la purge', 'false',
         has_function_privilege('authenticated', 'private.purge_expired()', 'execute')::text,
         not has_function_privilege('authenticated', 'private.purge_expired()', 'execute')
  union all
  select 9, 'Le service peut lancer la purge', 'true',
         has_function_privilege('service_role', 'private.purge_expired()', 'execute')::text,
         has_function_privilege('service_role', 'private.purge_expired()', 'execute')
  union all
  select 9.5, 'Le navigateur ou l''anonyme peuvent appeler resolve_access (droits des autres)', 'false',
         (has_function_privilege('authenticated', 'public.resolve_access(uuid, uuid)', 'execute')
          or has_function_privilege('anon', 'public.resolve_access(uuid, uuid)', 'execute'))::text,
         not (has_function_privilege('authenticated', 'public.resolve_access(uuid, uuid)', 'execute')
              or has_function_privilege('anon', 'public.resolve_access(uuid, uuid)', 'execute'))
  union all
  select 9.6, 'Fonctions du widget salarié appelables par le navigateur ou l''anonyme (migration 17)', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'widget\_%'
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'widget\_%'
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))
  union all
  select 9.7, 'Fonctions du widget salarié présentes (migration 17)', '6',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'widget\_%'),
         (select count(*) = 6 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'widget\_%')
  union all
  select 10, 'Index vectoriel HNSW de la base de connaissance', '1',
         (select count(*)::text from pg_indexes where indexname = 'kb_chunks_embedding_hnsw'),
         (select count(*) = 1 from pg_indexes where indexname = 'kb_chunks_embedding_hnsw')
  union all
  select 11, 'Une seule organisation (la plateforme) : la graine de démonstration n''a PAS été appliquée', '1',
         (select count(*)::text from public.organizations),
         (select count(*) = 1 from public.organizations where type = 'platform')
  union all
  select 12, 'Schéma « private » exposé par l''API', 'non',
         case when coalesce((select substring(c from 'pgrst.db_schemas=(.*)') from pg_roles r, unnest(r.rolconfig) c
                              where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%'), '') like '%private%' then 'oui' else 'non' end,
         coalesce((select substring(c from 'pgrst.db_schemas=(.*)') from pg_roles r, unnest(r.rolconfig) c
                    where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%'), '') not like '%private%'
  union all
  -- à regarder : pas de verdict automatique
  select 13, 'à regarder : schémas exposés par l''API (réglage API du projet)', 'public (graphql_public toléré)',
         coalesce((select substring(c from 'pgrst.db_schemas=(.*)') from pg_roles r, unnest(r.rolconfig) c
                    where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%'), 'non lisible ici : voir Settings, API'),
         null
  union all
  select 14, 'à regarder : extensions installées (vector, pgcrypto, supabase_vault ; pg_cron si activée)',
         'vector, pgcrypto, supabase_vault',
         (select string_agg(extname, ', ' order by extname) from pg_extension where extname in ('vector', 'pgcrypto', 'supabase_vault', 'pg_cron')),
         null
)
select ordre, controle, attendu, trouve, ok from checks order by ordre;
