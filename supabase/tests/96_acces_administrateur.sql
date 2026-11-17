-- Migration 19 : « qui a accès à quoi » pour l'administrateur du client. Graine de démonstration (Alpha : tech1 assigné ; Bêta :
-- tech2 assigné) ; tout est annulé à la fin.
begin;

create function pg_temp.o(p text) returns uuid language sql as $$ select id from public.organizations where slug = p $$;
create function pg_temp.u(p text) returns uuid language sql as $$ select id from auth.users where email = p $$;
create function pg_temp.access(p_user uuid, p_org uuid, p_mfa int default null) returns jsonb language plpgsql as
$$ declare v jsonb;
begin
  perform set_config('request.jwt.claims', test.claims(p_user, p_mfa), true);
  execute 'set local role authenticated';
  v := public.dashboard_org_access(p_org);
  execute 'reset role'; perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); raise;
end $$;
create function pg_temp.code(p_sql text) returns text language plpgsql as
$$ begin execute p_sql; return null; exception when others then execute 'reset role'; perform set_config('request.jwt.claims', '', true); return sqlstate; end $$;

update auth.users set raw_user_meta_data = '{"full_name": "Inès Martin"}' where email = 'tech1@esn-demo.test';
insert into public.memberships (user_id, org_id, role) values (pg_temp.u('salarie2@client-alpha.test'), pg_temp.o('client-beta'), 'end_user');
insert into public.support_access_grants (client_org_id, requested_by, reason) values
  (pg_temp.o('client-alpha'), pg_temp.u('fondateur@releve-demo.test'), 'Analyse d''un échec de synchronisation GLPI');
insert into public.connectors (org_id, type, name, status) values (pg_temp.o('client-alpha'), 'glpi', 'GLPI Alpha', 'ok');
insert into public.relief_schedules (org_id, kind, technician_user_id, starts_at, ends_at) values
  (pg_temp.o('client-alpha'), 'on_call', pg_temp.u('tech1@esn-demo.test'), now() - interval '1 hour', now() + interval '8 hours'),
  (pg_temp.o('client-alpha'), 'leave', null, now() - interval '20 days', now() - interval '10 days');

create temp table res (k text primary key, v jsonb);
insert into res values ('a', pg_temp.access(pg_temp.u('admin@client-alpha.test'), pg_temp.o('client-alpha')));

select test.expect('accès : relation avec l''ESN, rôles approuvés et échéance',
  (select v -> 'relationship' from res) ->> 'partner_name' = 'Nord Numérique (ESN de démonstration)'
  and (select v -> 'relationship' -> 'approved_roles' from res) = '["partner_admin", "partner_technician"]'::jsonb);
select test.expect('accès : techniciens assignés avec leur nom (assignation active seulement)',
  (select jsonb_array_length(v -> 'technicians') from res) = 1
  and (select v -> 'technicians' -> 0 ->> 'name' from res) = 'Inès Martin');
select test.expect('accès : demande d''accès d''assistance EN ATTENTE visible (pour l''approuver ou la refuser)',
  (select v -> 'support_access' -> 0 ->> 'approved' from res) = 'false'
  and (select v -> 'support_access' -> 0 ->> 'requested_by' from res) = 'Fondateur (démo)');
select test.expect('accès : connecteurs (état), astreinte en cours avec le nom ; un congé passé n''apparaît pas',
  (select v -> 'connectors' -> 0 ->> 'status' from res) = 'ok'
  and (select jsonb_array_length(v -> 'relief') from res) = 1
  and (select v -> 'relief' -> 0 ->> 'who' from res) = 'Inès Martin');
select test.expect('accès : aucun secret ni référence du coffre dans la réponse',
  (select v::text not like '%secret%' and v::text not like '%vault%' from res));
select test.expect('accès : réservé à l''administrateur DU client (technicien, ESN, autre client, salarié refusés)',
  pg_temp.code(format('select pg_temp.access(%L, %L)', pg_temp.u('tech1@esn-demo.test'), pg_temp.o('client-alpha'))) = '42501'
  and pg_temp.code(format('select pg_temp.access(%L, %L)', pg_temp.u('admin@esn-demo.test'), pg_temp.o('client-alpha'))) = '42501'
  and pg_temp.code(format('select pg_temp.access(%L, %L)', pg_temp.u('admin@client-beta.test'), pg_temp.o('client-alpha'))) = '42501'
  and pg_temp.code(format('select pg_temp.access(%L, %L)', pg_temp.u('salarie1@client-alpha.test'), pg_temp.o('client-alpha'))) = '42501');
select test.expect('SEC-33 accès : refusé sans second facteur, même à l''administrateur du client',
  pg_temp.code(format('select pg_temp.access(%L, %L, -1)', pg_temp.u('admin@client-alpha.test'), pg_temp.o('client-alpha'))) = '42501');
select test.expect('droits : l''anonyme ne l''appelle pas ; le nom d''une personne ne se lit pas directement',
  test.err(pg_temp.u('admin@client-alpha.test'), format('select public.dashboard_org_access(%L)', pg_temp.o('client-alpha')), 'anon') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select private.person_label(%L)', pg_temp.u('tech1@esn-demo.test'))) = '42501');

rollback;
