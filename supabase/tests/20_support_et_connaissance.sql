-- Conversations, mode ombre, base de connaissance, alertes, relève : SEC-01 (vectoriel), SEC-19, SEC-20, M04, M08, M35.
begin;

create table test.ids (k text primary key, id uuid not null default gen_random_uuid());
insert into test.ids (k) select unnest(array['ea','eb','ca','cb','t_a','t_b','admin_a','admin_b','sal_a','sal_a2','sal_b','conv_a','conv_a2','conv_b','src_a','src_b','conv_p','stranger']);
create function test.id(p text) returns uuid language sql stable as $$ select id from test.ids where k = p $$;
insert into auth.users (id, email) select id, k || '@exemple.test' from test.ids where k like 't\_%' or k like 'admin\_%' or k like 'sal%' or k = 'stranger';

insert into public.organizations (id, type, name, slug, plan, activated_at, created_via_partner_id) values
  (test.id('ea'), 'partner', 'ESN A', 'esn-a-t', 'partner', null, null), (test.id('eb'), 'partner', 'ESN B', 'esn-b-t', 'partner', null, null),
  (test.id('ca'), 'client', 'Client A', 'client-a-t', 'pilot', now(), test.id('ea')),
  (test.id('cb'), 'client', 'Client B', 'client-b-t', 'pilot', now(), test.id('eb'));
insert into public.memberships (user_id, org_id, role) values
  (test.id('t_a'), test.id('ea'), 'partner_technician'), (test.id('t_b'), test.id('eb'), 'partner_technician'),
  (test.id('admin_a'), test.id('ca'), 'org_admin'), (test.id('admin_b'), test.id('cb'), 'org_admin'),
  (test.id('sal_a'), test.id('ca'), 'end_user'), (test.id('sal_a2'), test.id('ca'), 'end_user'), (test.id('sal_b'), test.id('cb'), 'end_user');
insert into public.partner_relationships (id, partner_org_id, client_org_id, status, approved_roles, expires_at) values
  ('00000000-0000-0000-0000-00000000f001', test.id('ea'), test.id('ca'), 'active', array['partner_admin','partner_technician'], now() + interval '11 months'),
  ('00000000-0000-0000-0000-00000000f002', test.id('eb'), test.id('cb'), 'active', array['partner_admin','partner_technician'], now() + interval '11 months');
insert into public.partner_assignments (relationship_id, user_id, ends_at) values
  ('00000000-0000-0000-0000-00000000f001', test.id('t_a'), now() + interval '30 days'),
  ('00000000-0000-0000-0000-00000000f002', test.id('t_b'), now() + interval '30 days');

-- ------------------------------------------------------------------ portes de catégorie : fermées par défaut
select test.expect('chaque client reçoit ses 11 portes de catégorie, toutes fermées (shadow)',
  (select count(*) from public.category_gates where org_id = test.id('ca')) = 11
  and (select count(*) from public.category_gates where org_id = test.id('ca') and state <> 'shadow') = 0);
select test.expect('une ESN ou la plateforme n''ont pas de portes',
  (select count(*) from public.category_gates where org_id in (test.id('ea'))) = 0);

-- ------------------------------------------------------------------ SEC-19 : mode ombre
insert into public.conversations (id, org_id, requester_user_id, category) values
  (test.id('conv_a'), test.id('ca'), test.id('sal_a'), 'vpn'),
  (test.id('conv_a2'), test.id('ca'), test.id('sal_a2'), 'vpn'),
  (test.id('conv_b'), test.id('cb'), test.id('sal_b'), 'vpn');
create function test.say(p_conv text, p_org text, p_role text, p_vis text, p_content text default 'texte') returns text language plpgsql as $$
begin
  insert into public.messages (conversation_id, org_id, role, visibility, content, author_id)
  values (test.id(p_conv), test.id(p_org), p_role, p_vis, p_content, case when p_role = 'technician' then test.id('t_a') end);
  return null;
exception when others then return sqlerrm; end $$;

select test.expect('SEC-19 le salarié peut écrire (message public de rôle « user »)',
  test.say('conv_a', 'ca', 'user', 'public', 'Mon VPN ne marche plus') is null);
select test.expect('SEC-19 catégorie fermée : une réponse PUBLIQUE de l''IA est refusée par la base',
  test.say('conv_a', 'ca', 'assistant', 'public') like '%Mode ombre%');
select test.expect('SEC-19 la réponse de l''IA préparée en mode ombre est acceptée, visible des seuls techniciens',
  test.say('conv_a', 'ca', 'assistant', 'technician', 'Réponse préparée par l''IA') is null);
select test.expect('SEC-19 le message fixe « un technicien va répondre » reste possible (rôle système)',
  test.say('conv_a', 'ca', 'system', 'public', 'Un technicien va vous répondre.') is null);
select test.expect('SEC-19 le salarié lit son message et le message système, PAS la réponse préparée de l''IA',
  test.q(test.id('sal_a'), format('select count(*) from public.messages where conversation_id = %L', test.id('conv_a'))) = 2
  and test.q(test.id('sal_a'), format('select count(*) from public.messages where conversation_id = %L and role = ''assistant''', test.id('conv_a'))) = 0);
select test.expect('SEC-19 le technicien assigné lit tout, y compris la réponse préparée',
  test.q(test.id('t_a'), format('select count(*) from public.messages where conversation_id = %L', test.id('conv_a'))) = 3);
select test.expect('SEC-01 un autre salarié du même client ne lit pas cette conversation',
  test.q(test.id('sal_a2'), format('select count(*) from public.messages where conversation_id = %L', test.id('conv_a'))) = 0);
select test.expect('SEC-01 un salarié d''un autre client ne lit rien',
  test.q(test.id('sal_b'), format('select count(*) from public.messages where org_id = %L', test.id('ca'))) = 0);
select test.expect('SEC-01 le technicien d''un autre client ne lit rien',
  test.q(test.id('t_b'), format('select count(*) from public.messages where org_id = %L', test.id('ca'))) = 0);
select test.expect('un message doit appartenir à l''organisation de sa conversation',
  test.say('conv_a', 'cb', 'user', 'public') like '%organisation de sa conversation%');
select test.expect('un message est immuable',
  test.err_admin('update public.messages set content = ''modifié'' where role = ''user''') is not null);

-- Ouverture de la catégorie : décision humaine, barres non atteintes (aucune note) => refus sans décision motivée.
create function test.open_gate(p_by text, p_override boolean, p_reason text) returns text language plpgsql as $$
begin
  update public.category_gates set state = 'direct', changed_by = test.id(p_by), override_insufficient_data = p_override, reason = p_reason
  where org_id = test.id('ca') and category = 'vpn';
  return null;
exception when others then return sqlerrm; end $$;
select test.expect('portes : un technicien ne peut pas ouvrir une catégorie',
  test.open_gate('t_a', true, 'Je décide seul d''ouvrir cette catégorie') like '%administrateur du client%');
select test.expect('portes : l''administrateur ne peut pas ouvrir sans les barres de passage ni décision motivée',
  test.open_gate('admin_a', false, null) like '%Barres de passage non atteintes%');
select test.expect('portes : un motif trop court ne suffit pas',
  test.open_gate('admin_a', true, 'ok') like '%Barres de passage non atteintes%');
select test.expect('portes : l''administrateur ouvre par une décision assumée et motivée (données insuffisantes)',
  test.open_gate('admin_a', true, 'Pilote de démonstration sur données synthétiques') is null);
select test.expect('SEC-19 catégorie ouverte : la réponse publique de l''IA est acceptée',
  test.say('conv_a', 'ca', 'assistant', 'public', 'Voici la marche à suivre.') is null);
select test.expect('SEC-19 …et le salarié la lit maintenant',
  test.q(test.id('sal_a'), format('select count(*) from public.messages where conversation_id = %L and role = ''assistant'' and visibility = ''public''', test.id('conv_a'))) = 1);
-- La porte d'une autre catégorie reste fermée.
insert into public.conversations (id, org_id, requester_user_id, category) values (test.id('conv_p'), test.id('ca'), test.id('sal_a'), 'printer');
select test.expect('SEC-19 les autres catégories restent fermées (imprimante)',
  test.say('conv_p', 'ca', 'assistant', 'public') like '%Mode ombre%');
update public.organizations set frozen_at = now(), frozen_by = test.id('admin_a') where id = test.id('ca');
select test.expect('SEC-28 organisation gelée : réponse publique de l''IA refusée même catégorie ouverte',
  test.say('conv_a', 'ca', 'assistant', 'public') like '%gelée%');
update public.organizations set frozen_at = null, frozen_by = null where id = test.id('ca');

-- SEC-20 : une note « Dangereuse » referme la catégorie tout de suite.
insert into public.messages (id, conversation_id, org_id, role, visibility, content)
  values ('00000000-0000-0000-0000-0000000000b1', test.id('conv_a'), test.id('ca'), 'assistant', 'public', 'Désactivez le pare-feu.');
select test.expect('SEC-20 un technicien note la réponse « dangereuse »',
  test.err(test.id('t_a'), format('insert into public.response_ratings (org_id, message_id, rating, rated_by) values (%L, ''00000000-0000-0000-0000-0000000000b1'', ''dangerous'', %L)', test.id('ca'), test.id('t_a'))) is null);
select test.expect('SEC-20 la catégorie repasse aussitôt en conseil seul (advice_only), automatiquement',
  (select state = 'advice_only' and changed_by is null and reason like 'Retour arrière automatique%' from public.category_gates where org_id = test.id('ca') and category = 'vpn'));
select test.expect('SEC-20 …et la réponse publique de l''IA est de nouveau refusée par la base',
  test.say('conv_a', 'ca', 'assistant', 'public') like '%Mode ombre%');
select test.expect('SEC-20 le retour arrière est audité',
  (select count(*) from public.audit_logs where event = 'category_gates.update' and org_id = test.id('ca')) >= 2);
select test.expect('notation : la catégorie vient de la conversation, pas du notateur',
  (select category = 'vpn' from public.response_ratings where message_id = '00000000-0000-0000-0000-0000000000b1'));
select test.expect('notation : un salarié ne peut pas noter',
  test.err(test.id('sal_a'), format('insert into public.response_ratings (org_id, message_id, rating, rated_by) values (%L, ''00000000-0000-0000-0000-0000000000b1'', ''correct'', %L)', test.id('ca'), test.id('sal_a'))) is not null);
select test.expect('notation : un technicien d''un autre client ne peut pas noter',
  test.err(test.id('t_b'), format('insert into public.response_ratings (org_id, message_id, rating, rated_by) values (%L, ''00000000-0000-0000-0000-0000000000b1'', ''correct'', %L)', test.id('ca'), test.id('t_b'))) is not null);
select test.expect('notation : on ne note pas au nom d''un autre',
  test.err(test.id('t_a'), format('insert into public.response_ratings (org_id, message_id, rating, rated_by) values (%L, ''00000000-0000-0000-0000-0000000000b1'', ''correct'', %L)', test.id('ca'), test.id('admin_a'))) is not null);
select test.expect('M36 une note ne se modifie pas',
  test.err_admin('update public.response_ratings set rating = ''correct''') = '42501');
select test.expect('M36 une note ne se supprime pas',
  test.err_admin('delete from public.response_ratings') = '42501');

-- ------------------------------------------------------------------ base de connaissance (SEC-01 vectoriel, M08)
create function test.vec(p_x real) returns extensions.vector language sql immutable as
$$ select array_fill(p_x, array[1024])::extensions.vector(1024) $$;
insert into public.kb_documents (id, org_id, title, status, source, validated_by, validated_at) values
  ('00000000-0000-0000-0000-0000000000e1', test.id('ca'), 'Fiche A validée', 'validated', 'manual', test.id('admin_a'), now()),
  ('00000000-0000-0000-0000-0000000000e2', test.id('ca'), 'Fiche A brouillon', 'draft', 'ticket', null, null),
  ('00000000-0000-0000-0000-0000000000e3', test.id('cb'), 'Fiche B validée', 'validated', 'manual', test.id('admin_b'), now());
insert into public.kb_chunks (org_id, document_id, chunk_index, content, embedding) values
  (test.id('ca'), '00000000-0000-0000-0000-0000000000e1', 0, 'Contenu A', test.vec(0.5)),
  (test.id('ca'), '00000000-0000-0000-0000-0000000000e2', 0, 'Brouillon piégé A', test.vec(0.5)),
  (test.id('cb'), '00000000-0000-0000-0000-0000000000e3', 0, 'Contenu B confidentiel', test.vec(0.5));
select test.expect('SEC-01 recherche vectorielle : l''organisation A ne reçoit aucune fiche de B, et reçoit la sienne',
  (select count(*) from public.match_kb_chunks(test.id('ca'), test.vec(0.5), 10) where content like '%confidentiel%') = 0
  and (select count(*) from public.match_kb_chunks(test.id('ca'), test.vec(0.5), 10) where content = 'Contenu A') = 1);
select test.expect('SEC-01 …même avec la clé service_role (qui contourne la RLS), interroger l''organisation B ne renvoie JAMAIS une fiche de A',
  test.q_role('service_role', format('select count(*) from public.match_kb_chunks(%L, array_fill(0.5::real, array[1024])::extensions.vector(1024), 10) where content = ''Contenu A''', test.id('cb'))) = 0
  and test.q_role('service_role', format('select count(*) from public.match_kb_chunks(%L, array_fill(0.5::real, array[1024])::extensions.vector(1024), 10)', test.id('cb'))) = 1);
select test.expect('M08 une fiche en brouillon (issue d''un ticket) n''est jamais renvoyée à l''agent',
  (select count(*) from public.match_kb_chunks(test.id('ca'), test.vec(0.5), 10) where content like 'Brouillon%') = 0);
select test.expect('SEC-01 un technicien de l''autre client ne voit pas les morceaux de A',
  test.q(test.id('t_b'), format('select count(*) from public.kb_chunks where org_id = %L', test.id('ca'))) = 0);
select test.expect('SEC-01 un salarié ne lit pas la base de connaissance brute',
  test.q(test.id('sal_a'), 'select count(*) from public.kb_chunks') = 0);
select test.expect('SEC-01 un morceau ne peut pas être rattaché à la fiche d''une autre organisation',
  test.err_admin(format('insert into public.kb_chunks (org_id, document_id, chunk_index, content) values (%L, ''00000000-0000-0000-0000-0000000000e3'', 5, ''x'')', test.id('ca'))) is not null);
select test.expect('M08 une fiche ne peut pas être validée par un salarié ni par un étranger',
  test.err_admin(format('update public.kb_documents set status = ''validated'', validated_by = %L, validated_at = now() where id = ''00000000-0000-0000-0000-0000000000e2''', test.id('sal_a'))) is not null);
select test.expect('M08 une fiche « validée » exige un validateur nommé',
  test.msg_admin('update public.kb_documents set status = ''validated'' where id = ''00000000-0000-0000-0000-0000000000e2''') like '%ne peut être validée que par%');
select test.expect('M08 un technicien assigné peut valider une fiche',
  test.err_admin(format('update public.kb_documents set status = ''validated'', validated_by = %L, validated_at = now() where id = ''00000000-0000-0000-0000-0000000000e2''', test.id('t_a'))) is null);

-- ------------------------------------------------------------------ alertes (M35)
insert into public.alert_sources (id, org_id, name, type, expected_interval_seconds, last_seen_at) values
  (test.id('src_a'), test.id('ca'), 'Supervision A', 'webhook', 300, now() - interval '1 hour'),
  (test.id('src_b'), test.id('cb'), 'Supervision B', 'webhook', 300, now());
create function test.alert(p_src text, p_org text, p_key text, p_summary text default 'Pare-feu injoignable', p_raw jsonb default '{}') returns text language plpgsql as $$
begin
  insert into public.alerts (org_id, source_id, dedup_key, asset_name, severity, summary, occurred_at, raw)
  values (test.id(p_org), test.id(p_src), p_key, 'fw-siege', 'critical', p_summary, now(), p_raw);
  return null;
exception when others then return sqlstate; end $$;
select test.expect('alerte : une première alerte est acceptée',
  test.alert('src_a', 'ca', 'fw-siege/ping') is null);
select test.expect('alerte : elle est « non rattachée » par défaut (visible, jamais jetée)',
  (select attachment_status = 'unattached' from public.alerts where dedup_key = 'fw-siege/ping'));
select test.expect('M35 déduplication portée par la base : la même alerte ouverte ne se duplique pas',
  test.alert('src_a', 'ca', 'fw-siege/ping') = '23505');
select test.expect('alerte : on peut résoudre une alerte',
  test.err_admin('update public.alerts set state = ''resolved'', resolved_at = now() where dedup_key = ''fw-siege/ping''') is null);
select test.expect('alerte : une alerte résolue libère la clé de déduplication',
  test.alert('src_a', 'ca', 'fw-siege/ping') is null);
select test.expect('M01 le résumé d''une alerte est tronqué à 500 caractères (surface d''injection limitée)',
  test.alert('src_a', 'ca', 'long', repeat('x', 501)) = '23514');
select test.expect('M35 la charge brute est plafonnée à 64 Ko',
  test.alert('src_a', 'ca', 'gros', 'ok', jsonb_build_object('x', repeat('y', 70000))) = '23514');
select test.expect('SEC-01 une alerte ne peut pas se rattacher à la source d''une autre organisation',
  test.alert('src_b', 'ca', 'cross') is not null);
select test.expect('M35 une source muette est détectée (aucun signe depuis plus de 3 intervalles)',
  (select count(*) from private.silent_sources() where source_id = test.id('src_a')) = 1
  and (select count(*) from private.silent_sources() where source_id = test.id('src_b')) = 0);
insert into public.maintenance_windows (org_id, asset_pattern, starts_at, ends_at, reason)
  values (test.id('ca'), 'fw-*', now() - interval '1 hour', now() + interval '1 hour', 'Mise à jour du pare-feu');
select test.expect('M35 une fenêtre de maintenance est reconnue pour le bon actif',
  private.in_maintenance(test.id('ca'), test.id('src_a'), 'fw-siege') and not private.in_maintenance(test.id('ca'), test.id('src_a'), 'switch-1')
  and not private.in_maintenance(test.id('cb'), test.id('src_b'), 'fw-siege'));
select test.expect('SEC-01 le technicien du client A lit les alertes de A, pas celles de B',
  test.q(test.id('t_a'), 'select count(*) from public.alerts') >= 1
  and test.q(test.id('t_b'), format('select count(*) from public.alerts where org_id = %L', test.id('ca'))) = 0);
select test.expect('M04 le secret d''une source d''alertes exige 32 caractères',
  test.err_admin(format('select private.store_alert_source_secret(%L, ''trop court'')', test.id('src_a'))) is not null);
select test.expect('M04 le secret d''une source se range dans Vault',
  (select private.store_alert_source_secret(test.id('src_a'), repeat('s', 40)) is not null));
select test.expect('M04 la référence du secret est illisible via l''API',
  test.err(test.id('t_a'), 'select vault_secret_id from public.alert_sources') = '42501');

-- ------------------------------------------------------------------ relève
insert into public.relief_schedules (org_id, kind, starts_at, ends_at) values (test.id('ca'), 'night', now() - interval '1 hour', now() + interval '6 hours');
select test.expect('relève : la relève est active pendant une plage de nuit, pas pour un autre client',
  private.relief_active(test.id('ca')) and not private.relief_active(test.id('cb')) and not private.relief_active(test.id('ca'), now() + interval '8 hours'));
select test.expect('relève : le planning n''est pas lisible par un salarié',
  test.q(test.id('sal_a'), 'select count(*) from public.relief_schedules') = 0);

-- ------------------------------------------------------------------ tickets
insert into public.connectors (id, org_id, type, name) values ('00000000-0000-0000-0000-0000000000f1', test.id('ca'), 'glpi', 'GLPI A');
insert into public.tickets (org_id, connector_id, external_ref, title) values (test.id('ca'), '00000000-0000-0000-0000-0000000000f1', 'GLPI-100', 'Panne VPN');
select test.expect('ticket : une référence externe est unique par connecteur',
  test.err_admin(format('insert into public.tickets (org_id, connector_id, external_ref, title) values (%L, ''00000000-0000-0000-0000-0000000000f1'', ''GLPI-100'', ''Doublon'')', test.id('ca'))) = '23505');
select test.expect('SEC-01 un ticket n''est lisible que des techniciens assignés au bon client',
  test.q(test.id('t_a'), 'select count(*) from public.tickets') = 1 and test.q(test.id('t_b'), 'select count(*) from public.tickets') = 0
  and test.q(test.id('sal_a'), 'select count(*) from public.tickets') = 0);

rollback;
