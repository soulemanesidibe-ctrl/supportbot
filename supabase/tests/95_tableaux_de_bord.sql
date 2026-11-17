-- Migration 18 : chiffres des tableaux de bord, sans contenu (SEC-26). Graine de démonstration (ESN Nord Numérique ; Alpha :
-- tech1 assigné ; Bêta : tech2 assigné) ; tout est annulé à la fin.
begin;

create function pg_temp.o(p text) returns uuid language sql as $$ select id from public.organizations where slug = p $$;
create function pg_temp.u(p text) returns uuid language sql as $$ select id from auth.users where email = p $$;
-- Résultat d'une fonction de tableau de bord pour un utilisateur (second facteur d'ouverture de session par défaut).
create function pg_temp.summary(p_user uuid, p_org uuid, p_mfa int default null) returns jsonb language plpgsql as
$$ declare v jsonb;
begin
  perform set_config('request.jwt.claims', test.claims(p_user, p_mfa), true);
  execute 'set local role authenticated';
  v := public.dashboard_org_summary(p_org, 30);
  execute 'reset role'; perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); raise;
end $$;
create function pg_temp.clients(p_user uuid, p_partner uuid, p_mfa int default null) returns jsonb language plpgsql as
$$ declare v jsonb;
begin
  perform set_config('request.jwt.claims', test.claims(p_user, p_mfa), true);
  execute 'set local role authenticated';
  select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb) into v from public.dashboard_partner_clients(p_partner) r;
  execute 'reset role'; perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); raise;
end $$;
create function pg_temp.code(p_sql text) returns text language plpgsql as
$$ begin execute p_sql; return null; exception when others then execute 'reset role'; perform set_config('request.jwt.claims', '', true); return sqlstate; end $$;

-- Données d'Alpha (30 derniers jours) : 4 conversations, dont une résolue par Relève (note 5), une par l'équipe (note 3), une chez
-- un technicien (escaladée), une en attente du salarié. Messages avec des textes « SECRETS » qui ne doivent jamais ressortir.
insert into public.conversations (id, org_id, requester_user_id, category, state, resolution, satisfaction, escalated_at, resolved_at, created_at, relief_active) values
  ('00000000-0000-4000-8000-0000000095c1', pg_temp.o('client-alpha'), pg_temp.u('salarie1@client-alpha.test'), 'printer', 'resolved', 'ai_confirmed', 5, null, now() - interval '2 days' + interval '20 minutes', now() - interval '2 days', true),
  ('00000000-0000-4000-8000-0000000095c2', pg_temp.o('client-alpha'), pg_temp.u('salarie2@client-alpha.test'), 'vpn', 'closed', 'human', 3, now() - interval '3 days', now() - interval '3 days' + interval '2 hours', now() - interval '3 days', false),
  ('00000000-0000-4000-8000-0000000095c3', pg_temp.o('client-alpha'), pg_temp.u('salarie3@client-alpha.test'), 'vpn', 'waiting_technician', null, null, now() - interval '1 hour', null, now() - interval '1 hour', false),
  ('00000000-0000-4000-8000-0000000095c4', pg_temp.o('client-alpha'), pg_temp.u('salarie1@client-alpha.test'), 'outlook', 'waiting_user', null, null, null, null, now() - interval '10 minutes', false),
  ('00000000-0000-4000-8000-0000000095c5', pg_temp.o('client-alpha'), pg_temp.u('salarie1@client-alpha.test'), 'teams', 'resolved', 'ai_confirmed', 4, null, now() - interval '40 days', now() - interval '41 days', false);
insert into public.messages (conversation_id, org_id, role, visibility, content, author_id, created_at) values
  ('00000000-0000-4000-8000-0000000095c1', pg_temp.o('client-alpha'), 'user', 'public', 'TEXTE SECRET du salarié', null, now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000095c1', pg_temp.o('client-alpha'), 'assistant', 'technician', 'BROUILLON SECRET', null, now() - interval '2 days' + interval '30 seconds'),
  ('00000000-0000-4000-8000-0000000095c1', pg_temp.o('client-alpha'), 'technician', 'public', 'RÉPONSE SECRÈTE', pg_temp.u('tech1@esn-demo.test'), now() - interval '2 days' + interval '120 seconds'),
  ('00000000-0000-4000-8000-0000000095c2', pg_temp.o('client-alpha'), 'technician', 'public', 'RÉPONSE SECRÈTE 2', pg_temp.u('tech1@esn-demo.test'), now() - interval '3 days' + interval '600 seconds');
insert into public.incidents (org_id, title, category, severity, state) values
  (pg_temp.o('client-alpha'), 'ALERTE SECRÈTE vpn-gw01', 'vpn', 'major', 'open'),
  (pg_temp.o('client-alpha'), 'Disque presque plein', 'other', 'warning', 'open');
insert into public.connectors (org_id, type, name, status) values (pg_temp.o('client-alpha'), 'glpi', 'GLPI Alpha', 'error');
insert into public.relief_schedules (org_id, kind, starts_at, ends_at) values
  (pg_temp.o('client-alpha'), 'night', now() - interval '1 hour', now() + interval '8 hours'),
  (pg_temp.o('client-alpha'), 'leave', now() - interval '20 days', now() - interval '18 days');
insert into public.partner_pricing (partner_org_id, client_org_id, discount_percent, public_price_cents, partner_price_cents, client_price_cents) values
  (pg_temp.o('esn-demo'), pg_temp.o('client-alpha'), 30, 10000, 7000, 12000);

-- ---------------------------------------------------------------------------------------------------------------
-- Synthèse d'un client
-- ---------------------------------------------------------------------------------------------------------------
create temp table res (k text primary key, v jsonb);
insert into res values ('admin', pg_temp.summary(pg_temp.u('admin@client-alpha.test'), pg_temp.o('client-alpha')));
select test.expect('synthèse : comptes de la fenêtre (30 jours), résolutions par Relève et par l''équipe, attente, escalades, pendant la relève',
  (select v -> 'support' from res where k = 'admin') @> '{"conversations": 4, "resolved_by_releve": 1, "resolved_by_team": 1, "waiting_technician": 1, "waiting_user": 1, "escalated": 2, "during_relief": 1}'::jsonb);
select test.expect('synthèse : médianes avec leur effectif (première réponse utile = IA ou technicien, jamais un message automatique)',
  (select v -> 'support' from res where k = 'admin') @> '{"first_answer_n": 2, "resolution_n": 2, "satisfaction_n": 2}'::jsonb
  and (select (v -> 'support' ->> 'first_answer_median_seconds')::numeric from res where k = 'admin') = 360
  and (select (v -> 'support' ->> 'satisfaction_avg')::numeric from res where k = 'admin') = 4.00);
select test.expect('synthèse : les 11 catégories, avec porte, notes, barres et demandes',
  (select jsonb_array_length(v -> 'categories') from res where k = 'admin') = 11
  and (select bool_and(e ?& array['category', 'gate', 'stats', 'bars_met', 'conversations']) from res, jsonb_array_elements(v -> 'categories') e where k = 'admin')
  and (select e ->> 'conversations' from res, jsonb_array_elements(v -> 'categories') e where k = 'admin' and e ->> 'category' = 'vpn') = '2');
select test.expect('SEC-26 synthèse : AUCUN texte de demande, de réponse, de brouillon ni d''alerte',
  (select v::text not like '%SECRET%' and v::text not like '%SECRÈTE%' and v::text not like '%@%' from res where k = 'admin'));
select test.expect('synthèse : lisible par le technicien assigné et par l''administrateur de l''ESN en relation',
  pg_temp.summary(pg_temp.u('tech1@esn-demo.test'), pg_temp.o('client-alpha')) -> 'support' ->> 'conversations' = '4'
  and pg_temp.summary(pg_temp.u('admin@esn-demo.test'), pg_temp.o('client-alpha')) -> 'support' ->> 'conversations' = '4');
select test.expect('synthèse : refusée à un salarié, au technicien d''un AUTRE client, à l''administrateur d''un autre client',
  pg_temp.code(format('select pg_temp.summary(%L, %L)', pg_temp.u('salarie1@client-alpha.test'), pg_temp.o('client-alpha'))) = '42501'
  and pg_temp.code(format('select pg_temp.summary(%L, %L)', pg_temp.u('tech2@esn-demo.test'), pg_temp.o('client-alpha'))) = '42501'
  and pg_temp.code(format('select pg_temp.summary(%L, %L)', pg_temp.u('admin@client-beta.test'), pg_temp.o('client-alpha'))) = '42501');
select test.expect('SEC-33 synthèse : refusée sans second facteur, même à l''administrateur du client',
  pg_temp.code(format('select pg_temp.summary(%L, %L, -1)', pg_temp.u('admin@client-alpha.test'), pg_temp.o('client-alpha'))) = '42501');
select test.expect('synthèse : le super administrateur sans accès d''assistance ne voit rien',
  pg_temp.code(format('select pg_temp.summary(%L, %L)', pg_temp.u('fondateur@releve-demo.test'), pg_temp.o('client-alpha'))) = '42501');

-- ---------------------------------------------------------------------------------------------------------------
-- Clients d'une ESN
-- ---------------------------------------------------------------------------------------------------------------
insert into res values ('esn', pg_temp.clients(pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo')));
select test.expect('ESN : une ligne par client en relation vivante',
  (select jsonb_array_length(v) from res where k = 'esn') = 2);
select test.expect('ESN : compteurs du client (incidents, majeurs, attente technicien, connecteur en erreur, relève, absences, prix)',
  (select e from res, jsonb_array_elements(v) e where k = 'esn' and e ->> 'slug' = 'client-alpha')
    @> '{"open_incidents": 2, "major_incidents": 1, "waiting_technician": 1, "connectors_in_error": 1, "relief_active": true, "absences_90d": 1, "conversations_30d": 4, "resolved_by_releve_30d": 1, "satisfaction_n_30d": 2, "assigned_technicians": 1, "client_price_cents": 12000, "partner_price_cents": 7000}'::jsonb);
select test.expect('SEC-26 ESN : aucun texte de conversation ni d''alerte',
  (select v::text not like '%SECRET%' and v::text not like '%SECRÈTE%' from res where k = 'esn'));
update public.partner_relationships set status = 'reduced', approved_roles = array['partner_technician'] where client_org_id = pg_temp.o('client-beta');
select test.expect('ESN : un client dont la relation n''approuve plus le rôle d''administrateur ESN disparaît du tableau',
  jsonb_array_length(pg_temp.clients(pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo'))) = 1);
update public.partner_relationships set status = 'revoked', revoked_at = now() where client_org_id = pg_temp.o('client-alpha');
select test.expect('ESN : relation révoquée = plus aucune ligne',
  jsonb_array_length(pg_temp.clients(pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo'))) = 0);
select test.expect('ESN : refusé au technicien de l''ESN, à l''administrateur d''un client, sans second facteur',
  pg_temp.code(format('select pg_temp.clients(%L, %L)', pg_temp.u('tech1@esn-demo.test'), pg_temp.o('esn-demo'))) = '42501'
  and pg_temp.code(format('select pg_temp.clients(%L, %L)', pg_temp.u('admin@client-alpha.test'), pg_temp.o('esn-demo'))) = '42501'
  and pg_temp.code(format('select pg_temp.clients(%L, %L, -1)', pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo'))) = '42501');
select test.expect('droits : l''anonyme n''appelle aucune des deux fonctions',
  test.err(pg_temp.u('admin@esn-demo.test'), format('select public.dashboard_org_summary(%L)', pg_temp.o('client-alpha')), 'anon') = '42501'
  and test.err(pg_temp.u('admin@esn-demo.test'), format('select count(*) from public.dashboard_partner_clients(%L)', pg_temp.o('esn-demo')), 'anon') = '42501');

rollback;
