-- Contexte de requête (migration 11) : resolve_access et acteur du journal d'audit pour les écritures « service ».
-- Utilise la graine de démonstration ; tout est annulé à la fin.
begin;

create function pg_temp.u(p text) returns uuid language sql as $$ select id from auth.users where email = p $$;
create function pg_temp.o(p text) returns uuid language sql as $$ select id from public.organizations where slug = p $$;
create function pg_temp.access(p_email text, p_org text) returns text language sql as
$$ select coalesce((select org_role || '/' || via || case when read_only then '/ro' else '' end
                      from public.resolve_access(pg_temp.u(p_email), pg_temp.o(p_org))), 'aucun') $$;

-- ------------------------------------------------------------------ resolve_access
select test.expect('accès : un technicien d''ESN assigné à Alpha y est partner_technician par la voie ESN',
  pg_temp.access('tech1@esn-demo.test', 'client-alpha') = 'partner_technician/partner');
select test.expect('accès : le même technicien n''a RIEN chez Bêta (non assigné)',
  pg_temp.access('tech1@esn-demo.test', 'client-beta') = 'aucun');
select test.expect('accès : l''administrateur de l''ESN est partner_admin chez ses deux clients',
  pg_temp.access('admin@esn-demo.test', 'client-alpha') = 'partner_admin/partner'
  and pg_temp.access('admin@esn-demo.test', 'client-beta') = 'partner_admin/partner');
select test.expect('accès : l''administrateur d''Alpha est org_admin chez lui et n''a rien chez Bêta',
  pg_temp.access('admin@client-alpha.test', 'client-alpha') = 'org_admin/member'
  and pg_temp.access('admin@client-alpha.test', 'client-beta') = 'aucun');
select test.expect('accès : un salarié est end_user chez lui, rien ailleurs',
  pg_temp.access('salarie1@client-alpha.test', 'client-alpha') = 'end_user/member'
  and pg_temp.access('salarie1@client-alpha.test', 'client-beta') = 'aucun');
select test.expect('accès : le fondateur n''a AUCUN accès à un client sans accès d''assistance',
  pg_temp.access('fondateur@releve-demo.test', 'client-alpha') = 'aucun');
select test.expect('accès : un utilisateur inconnu n''a rien',
  (select count(*) from public.resolve_access(gen_random_uuid(), pg_temp.o('client-alpha'))) = 0);
select test.expect('accès : une organisation inconnue ne donne rien',
  (select count(*) from public.resolve_access(pg_temp.u('tech1@esn-demo.test'), gen_random_uuid())) = 0);

-- Accès d'assistance : approuvé par le client, dans sa fenêtre, lecture seule.
insert into public.support_access_grants (client_org_id, requested_by, reason, duration_minutes)
  values (pg_temp.o('client-alpha'), pg_temp.u('fondateur@releve-demo.test'), 'Diagnostic d''un incident signalé', 60);
select test.expect('accès d''assistance : demandé mais NON approuvé = aucun accès',
  pg_temp.access('fondateur@releve-demo.test', 'client-alpha') = 'aucun');
update public.support_access_grants set approved_by = pg_temp.u('admin@client-alpha.test'), approved_at = now(),
  starts_at = now() - interval '1 minute', ends_at = now() + interval '59 minutes'
  where requested_by = pg_temp.u('fondateur@releve-demo.test');
select test.expect('accès d''assistance : approuvé et dans sa fenêtre = lecture seule, rôle super_admin',
  pg_temp.access('fondateur@releve-demo.test', 'client-alpha') = 'super_admin/support_access/ro');
update public.support_access_grants set revoked_at = now(), revoked_by = pg_temp.u('admin@client-alpha.test')
  where requested_by = pg_temp.u('fondateur@releve-demo.test');
select test.expect('accès d''assistance : révoqué = l''accès cesse aussitôt',
  pg_temp.access('fondateur@releve-demo.test', 'client-alpha') = 'aucun');
insert into public.support_access_grants (client_org_id, requested_by, reason, duration_minutes, approved_by, approved_at, starts_at, ends_at)
  values (pg_temp.o('client-alpha'), pg_temp.u('fondateur@releve-demo.test'), 'Ancien diagnostic terminé', 60,
          pg_temp.u('admin@client-alpha.test'), now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour');
select test.expect('accès d''assistance : fenêtre échue = plus rien (sans tâche planifiée)',
  pg_temp.access('fondateur@releve-demo.test', 'client-alpha') = 'aucun');

-- Assignation expirée, relation révoquée, organisation suspendue : tout se coupe à la requête suivante.
update public.partner_assignments set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
  where user_id = pg_temp.u('tech1@esn-demo.test');
select test.expect('accès : assignation expirée = plus rien pour le technicien (SEC-02)',
  pg_temp.access('tech1@esn-demo.test', 'client-alpha') = 'aucun'
  and pg_temp.access('admin@esn-demo.test', 'client-alpha') = 'partner_admin/partner');
update public.partner_relationships set status = 'revoked', revoked_at = now() where client_org_id = pg_temp.o('client-alpha');
select test.expect('accès : relation révoquée = l''ESN perd TOUT, administrateur compris (R3)',
  pg_temp.access('admin@esn-demo.test', 'client-alpha') = 'aucun'
  and pg_temp.access('admin@client-alpha.test', 'client-alpha') = 'org_admin/member');
update public.organizations set state = 'suspended' where slug = 'client-beta';
select test.expect('accès : organisation suspendue = personne n''y entre',
  pg_temp.access('admin@client-beta.test', 'client-beta') = 'aucun');
update public.organizations set state = 'pilot', frozen_at = now() where slug = 'client-alpha';
select test.expect('accès : une organisation gelée reste lisible, mais le drapeau is_frozen est vrai',
  (select is_frozen from public.resolve_access(pg_temp.u('admin@client-alpha.test'), pg_temp.o('client-alpha'))) is true);

select test.expect('accès : resolve_access est INTERDITE au navigateur et à l''anonyme',
  test.err(pg_temp.u('admin@client-alpha.test'), format('select * from public.resolve_access(%L, %L)', pg_temp.u('tech1@esn-demo.test'), pg_temp.o('client-alpha'))) = '42501'
  and test.err(null, format('select * from public.resolve_access(%L, %L)', pg_temp.u('tech1@esn-demo.test'), pg_temp.o('client-alpha')), 'anon') = '42501');
select test.expect('accès : le service peut l''appeler',
  test.q_role('service_role', format('select count(*) from public.resolve_access(%L, %L)', pg_temp.u('admin@client-beta.test'), pg_temp.o('client-alpha'))) = 0);

-- ------------------------------------------------------------------ acteur du journal d'audit
update public.organizations set state = 'pilot' where slug = 'client-beta';      -- on rétablit Bêta (suspendu pour le test précédent)
select set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.headers', format('{"x-releve-actor":"%s","x-releve-request-id":"req-test-1"}', pg_temp.u('tech2@esn-demo.test')), true);
update public.kb_documents set title = 'Fiche renommée par le service' where title like 'Badge d''accès%';
select test.expect('audit : une écriture « service » porte l''acteur désigné par l''en-tête et l''identifiant de requête',
  (select actor_id = pg_temp.u('tech2@esn-demo.test') and actor_kind = 'user' and request_id = 'req-test-1'
          and details ->> 'via' = 'edge_function'
     from public.audit_logs where event = 'kb_documents.update' order by id desc limit 1));

-- Un navigateur (rôle authenticated) ne peut pas se faire passer pour un autre avec l'en-tête.
select set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', pg_temp.u('admin@client-beta.test')), true),
       set_config('request.headers', format('{"x-releve-actor":"%s"}', pg_temp.u('fondateur@releve-demo.test')), true);
update public.kb_documents set title = 'Deuxième renommage' where title = 'Fiche renommée par le service';
select test.expect('audit : un utilisateur ne peut PAS usurper un acteur par en-tête (M23) : c''est son propre identifiant qui est journalisé',
  (select actor_id = pg_temp.u('admin@client-beta.test') and (details ->> 'via') is null
     from public.audit_logs where event = 'kb_documents.update' order by id desc limit 1));

-- Un rôle anonyme (aucun sub) avec un en-tête forgé : l'acteur n'est PAS honoré (seule la clé service_role le peut).
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.headers', format('{"x-releve-actor":"%s"}', pg_temp.u('fondateur@releve-demo.test')), true);
update public.kb_documents set title = 'Renommage anonyme' where title = 'Deuxième renommage';
select test.expect('audit : un rôle anonyme ne peut PAS désigner un acteur par en-tête (M23)',
  (select actor_id is null from public.audit_logs where event = 'kb_documents.update' order by id desc limit 1));
update public.kb_documents set title = 'Deuxième renommage' where title = 'Renommage anonyme';

-- Service sans en-tête : acteur « service », aucune invention.
select set_config('request.jwt.claims', '{"role":"service_role"}', true), set_config('request.headers', '{}', true);
update public.kb_documents set title = 'Troisième renommage' where title = 'Deuxième renommage';
select test.expect('audit : écriture « service » sans en-tête = acteur « service » et aucun identifiant inventé',
  (select actor_kind = 'service' and actor_id is null and request_id is null
     from public.audit_logs where event = 'kb_documents.update' order by id desc limit 1));

-- En-têtes malformés : jamais d'erreur dans le déclencheur.
select set_config('request.headers', 'pas du json', true);
select test.expect('audit : des en-têtes malformés ne cassent pas l''écriture (aucun acteur)',
  test.err_admin('update public.kb_documents set title = ''Quatrième renommage'' where title = ''Troisième renommage''') is null);

rollback;
