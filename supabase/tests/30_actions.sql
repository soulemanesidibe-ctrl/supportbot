-- Circuit des actions de niveau 1 : SEC-06 à SEC-12, SEC-28 à SEC-31, invariants I1 à I12 (docs/spec-mvp.md § 9, § 14).
begin;

create table test.ids (k text primary key, id uuid not null default gen_random_uuid());
insert into test.ids (k) select unnest(array['esn','cli','other','t_oncall','t_sub','t_other','t_notchain','t_self','admin','sal','sal_t','stranger','conv','conv_t']);
create function test.id(p text) returns uuid language sql stable as $$ select id from test.ids where k = p $$;
insert into auth.users (id, email) select id, k || '@exemple.test' from test.ids where k not in ('esn','cli','other','conv','conv_t');

insert into public.organizations (id, type, name, slug, plan, activated_at, created_via_partner_id) values
  (test.id('esn'), 'partner', 'ESN Test', 'esn-test', 'partner', null, null),
  (test.id('cli'), 'client', 'Client Test', 'client-test', 'pilot', now(), test.id('esn')),
  (test.id('other'), 'client', 'Client non activé', 'client-nonactive', 'pilot', null, test.id('esn'));
insert into public.memberships (user_id, org_id, role) values
  (test.id('t_oncall'), test.id('esn'), 'partner_technician'), (test.id('t_sub'), test.id('esn'), 'partner_technician'),
  (test.id('t_other'), test.id('esn'), 'partner_technician'), (test.id('t_notchain'), test.id('esn'), 'partner_technician'),
  (test.id('t_self'), test.id('esn'), 'partner_technician'),
  (test.id('admin'), test.id('cli'), 'org_admin'), (test.id('sal'), test.id('cli'), 'end_user'),
  (test.id('sal_t'), test.id('cli'), 'end_user');
insert into public.partner_relationships (id, partner_org_id, client_org_id, status, approved_roles, expires_at)
  values ('00000000-0000-0000-0000-00000000e001', test.id('esn'), test.id('cli'), 'active', array['partner_admin','partner_technician'], now() + interval '11 months'),
         ('00000000-0000-0000-0000-00000000e002', test.id('esn'), test.id('other'), 'active', array['partner_admin','partner_technician'], now() + interval '11 months');
insert into public.partner_assignments (relationship_id, user_id, ends_at)
  select '00000000-0000-0000-0000-00000000e001', test.id(k), now() + interval '30 days'
  from unnest(array['t_oncall','t_sub','t_other','t_notchain','t_self']) k;

-- Connecteur Microsoft 365 connecté et qualifié ; niveau 1 sur les comptes ; chaîne : astreinte, puis t_other.
insert into public.connectors (id, org_id, type, name, environment, qualified_by, qualified_at, status, tenant_id)
  values ('00000000-0000-0000-0000-0000000000c1', test.id('cli'), 'm365', 'M365 test', 'test', test.id('admin'), now(), 'ok', 'tenant-test');
insert into public.autonomy_settings (org_id, category, level, set_by, mfa_verified_at)
  values (test.id('cli'), 'accounts', 1, test.id('admin'), now());
insert into public.relief_schedules (org_id, kind, technician_user_id, starts_at, ends_at)
  values (test.id('cli'), 'on_call', test.id('t_oncall'), now() - interval '1 hour', now() + interval '8 hours');
insert into public.approval_policies (org_id, category, chain)
  values (test.id('cli'), 'accounts', jsonb_build_array(jsonb_build_object('kind','on_call'), jsonb_build_object('kind','user','user_id', test.id('t_other'))));

insert into public.directory_users (id, org_id, email, display_name, source, linked_user_id) values
  ('00000000-0000-0000-0000-0000000000d1', test.id('cli'), 'sal@exemple.test', 'Salarié Test', 'csv', test.id('sal')),
  ('00000000-0000-0000-0000-0000000000d2', test.id('cli'), 't_self@exemple.test', 'Technicien Salarié', 'csv', test.id('t_self'));
insert into public.conversations (id, org_id, requester_user_id, directory_user_id, category) values
  (test.id('conv'), test.id('cli'), test.id('sal'), '00000000-0000-0000-0000-0000000000d1', 'mfa'),
  (test.id('conv_t'), test.id('cli'), test.id('t_self'), '00000000-0000-0000-0000-0000000000d2', 'mfa');

-- ------------------------------------------------------------------ niveau d'autonomie (jamais 2)
select test.expect('autonomie : le niveau 2 n''existe pas',
  test.err_admin(format('update public.autonomy_settings set level = 2 where org_id = %L', test.id('cli'))) = '23514');
select test.expect('autonomie : niveau 1 refusé sans second facteur vérifié',
  test.err_admin(format('insert into public.autonomy_settings (org_id, category, level, set_by) values (%L, ''tickets'', 1, %L)', test.id('cli'), test.id('admin'))) = '23514');
select test.expect('SEC-30 autonomie : niveau 1 refusé pour un client non activé',
  test.err_admin(format('insert into public.autonomy_settings (org_id, category, level, set_by, mfa_verified_at) values (%L, ''tickets'', 1, %L, now())', test.id('other'), test.id('admin'))) is not null);

-- ------------------------------------------------------------------ création d'une demande
create function test.new_req(p_conv text, p_dir uuid, p_cap text default 'user.mfa_reregister') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.action_requests (org_id, conversation_id, capability, category, target_ref, target_directory_user_id, requested_by_kind)
  values (test.id('cli'), test.id(p_conv), p_cap, 'accounts', 'x', p_dir, 'agent') returning id into v;
  return v;
end $$;

-- SEC-30 : pour atteindre VRAIMENT la défense « client non activé », on force un niveau 1 sur le client non activé
-- (la défense de l'autonomie, elle-même testée plus haut, l'interdirait normalement).
alter table public.autonomy_settings disable trigger autonomy_settings_guard;
insert into public.autonomy_settings (org_id, category, level, set_by, mfa_verified_at)
  values (test.id('other'), 'tickets', 1, test.id('admin'), now());
alter table public.autonomy_settings enable trigger autonomy_settings_guard;
select test.expect('SEC-30 aucune action pour un client non activé (même au niveau 1)',
  test.msg_admin(format('insert into public.action_requests (org_id, capability, category, target_ref, requested_by_kind) values (%L, ''ticket.update_status'', ''tickets'', ''GLPI-1'', ''automation'')', test.id('other'))) like '%SEC-30%');
select test.expect('autonomie 0 : aucune demande d''action n''est préparée (catégorie tickets)',
  test.msg_admin(format('insert into public.action_requests (org_id, capability, category, target_ref, requested_by_kind) values (%L, ''ticket.update_status'', ''tickets'', ''GLPI-1'', ''automation'')', test.id('cli'))) like '%Niveau d''autonomie 0%');
select test.expect('self_only : la cible doit être l''utilisateur de la conversation (X5)',
  test.err_admin(format('select test.new_req(''conv'', %L)', '00000000-0000-0000-0000-0000000000d2'::uuid)) is not null);

create table test.r (k text primary key, id uuid);
insert into test.r values ('a', test.new_req('conv', '00000000-0000-0000-0000-0000000000d1'));
select test.expect('SEC-08 l''empreinte est calculée par la base (64 caractères hexadécimaux)',
  (select params_hash ~ '^[0-9a-f]{64}$' from public.action_requests where id = (select id from test.r where k = 'a')));
select test.expect('SEC-09 la même action exacte ne peut pas être ouverte deux fois (idempotence)',
  test.err_admin(format('select test.new_req(''conv'', %L)', '00000000-0000-0000-0000-0000000000d1'::uuid)) = '23505');
select test.expect('l''état initial est pending_approval, sans valideur',
  (select status = 'pending_approval' and approver_id is null from public.action_requests where id = (select id from test.r where k = 'a')));

-- ------------------------------------------------------------------ SEC-08 : immutabilité
select test.expect('SEC-08 les paramètres ne se modifient pas après coup',
  test.err_admin(format('update public.action_requests set params = ''{"x":1}'' where id = %L', (select id from test.r where k = 'a'))) is not null);
select test.expect('SEC-08 la cible ne se modifie pas',
  test.err_admin(format('update public.action_requests set target_ref = ''autre@exemple.test'' where id = %L', (select id from test.r where k = 'a'))) is not null);
select test.expect('SEC-08 on ne supprime pas une demande',
  test.err_admin(format('delete from public.action_requests where id = %L', (select id from test.r where k = 'a'))) is not null);

-- ------------------------------------------------------------------ SEC-12 : validation, identité, éligibilité
create function test.approve(p_req uuid, p_user text, p_method text default 'callback', p_hash text default null, p_deleg uuid default null) returns text language plpgsql as $$
begin
  update public.action_requests set status = 'approved', approver_id = test.id(p_user),
    identity_check = case when p_method is null then null else jsonb_build_object('method', p_method, 'performed_by', test.id(p_user), 'at', now()) end,
    approved_hash = coalesce(p_hash, params_hash), approved_via_delegation_id = p_deleg
  where id = p_req;
  return null;
exception when others then return sqlstate; end $$;

select test.expect('SEC-12 validation impossible sans vérification d''identité hors bande',
  test.approve((select id from test.r where k = 'a'), 't_oncall', null) is not null);
select test.expect('SEC-12 méthode de vérification inconnue refusée',
  test.approve((select id from test.r where k = 'a'), 't_oncall', 'le_salarie_me_l_a_dit') is not null);
select test.expect('SEC-07 empreinte différente refusée (M12)',
  test.approve((select id from test.r where k = 'a'), 't_oncall', 'callback', repeat('0', 64)) is not null);
select test.expect('SEC-10 un technicien hors chaîne ne peut pas valider',
  test.approve((select id from test.r where k = 'a'), 't_notchain') is not null);
select test.expect('un suppléant sans délégation ne peut pas valider',
  test.approve((select id from test.r where k = 'a'), 't_sub') is not null);
select test.expect('un étranger à l''organisation ne peut pas valider',
  test.approve((select id from test.r where k = 'a'), 'stranger') is not null);
select test.expect('l''administrateur du client ne valide pas (ce n''est pas un technicien)',
  test.approve((select id from test.r where k = 'a'), 'admin') is not null);

-- I2 : un valideur ne valide pas une action sur SON PROPRE compte, même s'il est en chaîne.
insert into public.approval_policies (org_id, category, chain)
  values (test.id('cli'), 'accounts', '[]') on conflict (org_id, category) do update set chain = jsonb_build_array(
    jsonb_build_object('kind','on_call'), jsonb_build_object('kind','user','user_id', test.id('t_other')), jsonb_build_object('kind','user','user_id', test.id('t_self')));
insert into test.r values ('self', test.new_req('conv_t', '00000000-0000-0000-0000-0000000000d2'));
select test.expect('I2 un valideur ne valide pas une action sur son propre compte',
  test.approve((select id from test.r where k = 'self'), 't_self') is not null);
select test.expect('I2 …mais un autre valideur de la chaîne le peut',
  test.approve((select id from test.r where k = 'self'), 't_other') is null);
update public.action_requests set status = 'cancelled', reason = 'test' where id = (select id from test.r where k = 'self') and status = 'pending_approval';

-- Validation légitime par le technicien d'astreinte.
select test.expect('le technicien d''astreinte, avec vérification d''identité, valide',
  test.approve((select id from test.r where k = 'a'), 't_oncall') is null);
select test.expect('une demande validée porte le valideur, l''empreinte et l''heure',
  (select approver_id = test.id('t_oncall') and approved_hash = params_hash and approved_at is not null and approved_via_delegation_id is null
   from public.action_requests where id = (select id from test.r where k = 'a')));
select test.expect('I1 on ne valide pas deux fois / on ne revient pas en arrière',
  test.err_admin(format('update public.action_requests set status = ''pending_approval'' where id = %L', (select id from test.r where k = 'a'))) is not null);

-- I5 : le droit est revérifié AU MOMENT D'AGIR. Le technicien perd son assignation entre validation et exécution.
update public.partner_assignments set revoked_at = now() where user_id = test.id('t_oncall');
select test.expect('I5 l''exécution est refusée si le valideur n''est plus éligible',
  test.err_admin(format('update public.action_requests set status = ''executing'' where id = %L', (select id from test.r where k = 'a'))) is not null);
select test.expect('SEC-28 …et l''administrateur peut annuler la demande validée',
  test.err_admin(format('update public.action_requests set status = ''cancelled'', reason = ''valideur parti'' where id = %L', (select id from test.r where k = 'a'))) is null);

-- ------------------------------------------------------------------ suppléance (I1 à I12)
insert into public.partner_assignments (relationship_id, user_id, ends_at)
  values ('00000000-0000-0000-0000-00000000e001', test.id('t_oncall'), now() + interval '30 days');
create function test.delegate(p_by text, p_from text, p_to text, p_days int default 5, p_mfa_age int default 0, p_cats text[] default array['accounts']) returns text language plpgsql as $$
begin
  insert into public.approval_delegations (org_id, delegator_id, delegate_id, categories, ends_at, created_by, mfa_verified_at)
  values (test.id('cli'), test.id(p_from), test.id(p_to), p_cats, now() + p_days * interval '1 day', test.id(p_by), now() - p_mfa_age * interval '1 second');
  return null;
exception when others then return sqlstate; end $$;

select test.expect('I2 l''auto-délégation est refusée',
  test.delegate('t_oncall', 't_oncall', 't_oncall') is not null);
select test.expect('I4 une délégation de plus de 30 jours est refusée',
  test.delegate('t_oncall', 't_oncall', 't_sub', 31) = '23514');
select test.expect('I3 une délégation sans second facteur récent est refusée',
  test.delegate('t_oncall', 't_oncall', 't_sub', 5, 3600) = '23514');
select test.expect('I6 le suppléant doit déjà être habilité dans l''organisation',
  test.delegate('t_oncall', 't_oncall', 'stranger') is not null);
select test.expect('I6 on ne délègue que ce que l''on détient (t_notchain n''est pas dans la chaîne)',
  test.delegate('t_notchain', 't_notchain', 't_sub') is not null);
select test.expect('I9 un technicien quelconque ne peut pas créer une délégation au nom d''un autre',
  test.delegate('t_notchain', 't_oncall', 't_sub') is not null);
select test.expect('la délégation légitime est acceptée (astreinte vers suppléant, 5 jours, MFA frais)',
  test.delegate('t_oncall', 't_oncall', 't_sub') is null);
select test.expect('I9 l''administrateur du client peut réattribuer au nom d''un valideur absent',
  test.delegate('admin', 't_other', 't_notchain', 3) is null);
select test.expect('I6 une délégation ne se transmet pas : le suppléant ne peut pas redéléguer',
  test.delegate('t_sub', 't_sub', 't_notchain') is not null);

insert into test.r values ('b', null);
update test.r set id = test.new_req('conv', '00000000-0000-0000-0000-0000000000d1', 'user.unlock') where k = 'b';
select test.expect('I7 un suppléant doit déclarer la délégation utilisée',
  test.approve((select id from test.r where k = 'b'), 't_sub') is not null);
select test.expect('I7 …et ce doit être une délégation valide qui lui est destinée (celle de t_other→t_notchain ne convient pas)',
  test.approve((select id from test.r where k = 'b'), 't_sub', 'callback', null,
               (select id from public.approval_delegations where delegate_id = test.id('t_notchain'))) is not null);
select test.expect('SEC-06 le suppléant valide par sa délégation',
  test.approve((select id from test.r where k = 'b'), 't_sub', 'callback', null,
               (select id from public.approval_delegations where delegate_id = test.id('t_sub'))) is null);
select test.expect('SEC-06 la délégation utilisée est tracée sur la demande',
  (select approved_via_delegation_id is not null from public.action_requests where id = (select id from test.r where k = 'b')));

-- Délégation révoquée entre la validation et l'exécution : l'exécution est refusée (S6, I5).
update public.approval_delegations set revoked_at = now(), revoked_by = test.id('admin') where delegate_id = test.id('t_sub');
select test.expect('SEC-06 délégation révoquée avant l''exécution : exécution refusée',
  test.err_admin(format('update public.action_requests set status = ''executing'' where id = %L', (select id from test.r where k = 'b'))) is not null);
select test.expect('une délégation révoquée reste révoquée',
  test.err_admin(format('update public.approval_delegations set revoked_at = null where delegate_id = %L', test.id('t_sub'))) is not null);
select test.expect('une délégation ne se modifie pas',
  test.err_admin(format('update public.approval_delegations set ends_at = ends_at + interval ''20 days'' where delegate_id = %L', test.id('t_notchain'))) is not null);

-- ------------------------------------------------------------------ I8 : chaîne vide ; expiration ; arrêt d'urgence
update public.action_requests set status = 'cancelled', reason = 'nettoyage' where id = (select id from test.r where k = 'b');
update public.approval_policies set chain = '[]' where org_id = test.id('cli') and category = 'accounts';
insert into test.r values ('c', test.new_req('conv', '00000000-0000-0000-0000-0000000000d1', 'user.revoke_sessions'));
select test.expect('SEC-10 chaîne vide : personne n''est éligible, rien ne s''exécute',
  test.approve((select id from test.r where k = 'c'), 't_other') is not null
  and test.approve((select id from test.r where k = 'c'), 't_oncall') is not null);
select test.expect('I8 une demande n''expire pas avant son échéance',
  test.err_admin(format('update public.action_requests set status = ''expired'' where id = %L', (select id from test.r where k = 'c'))) is not null);
update public.approval_policies set chain = jsonb_build_array(jsonb_build_object('kind','user','user_id', test.id('t_other')))
  where org_id = test.id('cli') and category = 'accounts';
update public.organizations set frozen_at = now(), frozen_by = test.id('admin') where id = test.id('cli');
select test.expect('SEC-28 organisation gelée : aucune validation',
  test.approve((select id from test.r where k = 'c'), 't_other') is not null);
select test.expect('SEC-28 organisation gelée : aucune nouvelle demande',
  test.err_admin(format('select test.new_req(''conv'', %L, ''user.unlock'')', '00000000-0000-0000-0000-0000000000d1'::uuid)) is not null);
update public.organizations set frozen_at = null, frozen_by = null where id = test.id('cli');
select test.expect('SEC-28 une fois dégelée, la validation redevient possible',
  test.approve((select id from test.r where k = 'c'), 't_other') is null);

-- Exécution, issue, états finaux (M13)
select test.expect('l''exécution démarre une seule fois (approved vers executing)',
  test.err_admin(format('update public.action_requests set status = ''executing'' where id = %L', (select id from test.r where k = 'c'))) is null);
select test.expect('M13 une exécution en cours ne repart pas',
  test.err_admin(format('update public.action_requests set status = ''executing'' where id = %L', (select id from test.r where k = 'c'))) is null);  -- même état : sans effet
select test.expect('M13 issue incertaine : état « unknown », jamais rejoué',
  test.err_admin(format('update public.action_requests set status = ''unknown'', result = ''{"detail":"arrêt en cours d''''exécution"}'' where id = %L', (select id from test.r where k = 'c'))) is null);
select test.expect('M13 un état final ne change plus',
  test.err_admin(format('update public.action_requests set status = ''executing'' where id = %L', (select id from test.r where k = 'c'))) is not null);

-- SEC-31 : connecteur non qualifié
update public.connectors set environment = null, qualified_at = null, qualified_by = null where id = '00000000-0000-0000-0000-0000000000c1';
select test.expect('SEC-31 connecteur Microsoft 365 non qualifié : aucune demande d''action sur un compte',
  test.err_admin(format('select test.new_req(''conv'', %L, ''user.unlock'')', '00000000-0000-0000-0000-0000000000d1'::uuid)) is not null);
update public.connectors set environment = 'test', qualified_at = now(), qualified_by = test.id('admin') where id = '00000000-0000-0000-0000-0000000000c1';

-- ------------------------------------------------------------------ SEC-30 : Microsoft 365 avant activation
select test.expect('SEC-30 un connecteur Microsoft 365 ne peut pas être connecté avant l''activation du client',
  test.err_admin(format('insert into public.connectors (org_id, type, name, status) values (%L, ''m365'', ''M365'', ''ok'')', test.id('other'))) is not null);
select test.expect('SEC-30 …mais l''ESN peut le préparer à l''état brouillon',
  test.err_admin(format('insert into public.connectors (org_id, type, name, status) values (%L, ''m365'', ''M365 brouillon'', ''draft'')', test.id('other'))) is null);
select test.expect('M04 une configuration de connecteur ne peut pas contenir de secret',
  test.err_admin(format('insert into public.connectors (org_id, type, name, config) values (%L, ''glpi'', ''GLPI'', ''{"api_key":"abc"}'')', test.id('cli'))) = '23514');
select test.expect('M04 le secret d''un connecteur se range dans Vault',
  (select private.store_connector_secret((select id from public.connectors where name = 'M365 test'), 'un-secret-de-test-32-caracteres!!') is not null));
select test.expect('M04 la référence Vault est illisible via l''API (privilège de colonne)',
  test.err(test.id('admin'), 'select vault_secret_id from public.connectors') = '42501');
select test.expect('M04 la lecture du secret est interdite à l''API',
  test.err(test.id('admin'), 'select private.read_connector_secret(id) from public.connectors') = '42501');
select test.expect('M04 le service relit le secret',
  (select private.read_connector_secret((select id from public.connectors where name = 'M365 test'))) = 'un-secret-de-test-32-caracteres!!');

-- ------------------------------------------------------------------ compte Microsoft du valideur
select test.expect('compte Microsoft : un technicien habilité lie SON compte',
  test.err_admin(format('insert into public.microsoft_identities (org_id, user_id, connector_id, tenant_id, object_id, upn) values (%L, %L, ''00000000-0000-0000-0000-0000000000c1'', ''tenant-test'', ''oid-1'', ''t_oncall@exemple.test'')', test.id('cli'), test.id('t_other'))) is null);
select test.expect('compte Microsoft : refusé pour quelqu''un qui n''est pas technicien habilité',
  test.err_admin(format('insert into public.microsoft_identities (org_id, user_id, connector_id, tenant_id, object_id, upn) values (%L, %L, ''00000000-0000-0000-0000-0000000000c1'', ''tenant-test'', ''oid-2'', ''x@exemple.test'')', test.id('cli'), test.id('sal'))) is not null);
select test.expect('compte Microsoft : refusé si le tenant n''est pas celui du connecteur',
  test.err_admin(format('insert into public.microsoft_identities (org_id, user_id, connector_id, tenant_id, object_id, upn) values (%L, %L, ''00000000-0000-0000-0000-0000000000c1'', ''AUTRE-TENANT'', ''oid-3'', ''y@exemple.test'')', test.id('cli'), test.id('t_sub'))) is not null);
select test.expect('compte Microsoft : le technicien ne voit que le sien',
  test.q(test.id('t_other'), 'select count(*) from public.microsoft_identities') = 1
  and test.q(test.id('t_notchain'), 'select count(*) from public.microsoft_identities') = 0);
select test.expect('compte Microsoft : aucun jeton n''est stocké (pas de colonne de jeton)',
  (select count(*) from information_schema.columns where table_name = 'microsoft_identities' and column_name ~ 'token|secret|password') = 0);

-- ------------------------------------------------------------------ R7 : départ d'un technicien, tout est révoqué ensemble
select test.expect('R7 le départ d''un technicien révoque assignations, délégations, chaîne, compte Microsoft et appartenance',
  (select (private.offboard_technician(test.id('esn'), test.id('t_other')) ->> 'assignments')::int >= 1));
select test.expect('R7 …le technicien n''a plus aucun accès',
  not test.b(test.id('t_other'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('cli')))
  and (select revoked_at is not null from public.microsoft_identities where user_id = test.id('t_other'))
  and (select status = 'removed' from public.memberships where user_id = test.id('t_other')));
select test.expect('R7 …et il disparaît des chaînes de valideurs',
  (select count(*) from public.approval_policies p, jsonb_array_elements(p.chain) s where s ->> 'user_id' = test.id('t_other')::text) = 0);

-- ------------------------------------------------------------------ lecture
select test.expect('un technicien assigné lit les demandes d''action de son client',
  test.q(test.id('t_notchain'), 'select count(*) from public.action_requests') >= 1);
select test.expect('le salarié ne lit pas les demandes d''action (paramètres)',
  test.q(test.id('sal'), 'select count(*) from public.action_requests') = 0);
select test.expect('un étranger ne lit rien',
  test.q(test.id('stranger'), 'select count(*) from public.action_requests') = 0);

rollback;
