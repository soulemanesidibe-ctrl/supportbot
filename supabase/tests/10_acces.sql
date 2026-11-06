-- Isolation et contrôle d'accès : SEC-01, 02, 03, 05, 27 et invariants R1 à R9 (docs/spec-mvp.md § 14).
-- Tout se passe dans une transaction annulée à la fin.
begin;

-- ------------------------------------------------------------------ jeu d'essai
create table test.ids (k text primary key, id uuid not null default gen_random_uuid());
insert into test.ids (k) select unnest(array[
  'esn1','esn2','ca','cb','cc',
  'u_esn1_admin','u_tech1','u_tech2','u_tech3','u_esn2_admin','u_ca_admin','u_ca_viewer','u_ca_user','u_cb_admin','u_cc_admin',
  'u_super','u_support','u_stranger']);
create function test.id(p text) returns uuid language sql stable as $$ select id from test.ids where k = p $$;

insert into auth.users (id, email) select id, k || '@exemple.test' from test.ids where k like 'u\_%';

insert into public.organizations (id, type, name, slug, plan, created_via_partner_id) values
  (test.id('esn1'), 'partner', 'ESN Un', 'esn-un', 'partner', null),
  (test.id('esn2'), 'partner', 'ESN Deux', 'esn-deux', 'partner', null),
  (test.id('ca'), 'client', 'Client A', 'client-a', 'pilot', test.id('esn1')),
  (test.id('cb'), 'client', 'Client B', 'client-b', 'pilot', test.id('esn1')),
  (test.id('cc'), 'client', 'Client C', 'client-c', 'pilot', test.id('esn2'));

insert into public.memberships (user_id, org_id, role) values
  (test.id('u_esn1_admin'), test.id('esn1'), 'partner_admin'),
  (test.id('u_tech1'), test.id('esn1'), 'partner_technician'),
  (test.id('u_tech2'), test.id('esn1'), 'partner_technician'),
  (test.id('u_tech3'), test.id('esn1'), 'partner_technician'),
  (test.id('u_esn2_admin'), test.id('esn2'), 'partner_admin'),
  (test.id('u_ca_admin'), test.id('ca'), 'org_admin'),
  (test.id('u_ca_viewer'), test.id('ca'), 'org_viewer'),
  (test.id('u_ca_user'), test.id('ca'), 'end_user'),
  (test.id('u_cb_admin'), test.id('cb'), 'org_admin'),
  (test.id('u_cc_admin'), test.id('cc'), 'org_admin'),
  (test.id('u_super'), (select id from public.organizations where type = 'platform'), 'super_admin'),
  (test.id('u_support'), (select id from public.organizations where type = 'platform'), 'platform_support');

-- ESN Un : relation active avec A (admin + technicien), avec B (administrateur seulement), ESN Deux avec C.
insert into public.partner_relationships (id, partner_org_id, client_org_id, status, approved_roles, created_by_partner, expires_at)
  select gen_random_uuid(), test.id('esn1'), test.id('ca'), 'active', array['partner_admin','partner_technician'], true, now() + interval '11 months';
insert into public.partner_relationships (partner_org_id, client_org_id, status, approved_roles, expires_at)
  values (test.id('esn1'), test.id('cb'), 'active', array['partner_admin'], now() + interval '11 months'),
         (test.id('esn2'), test.id('cc'), 'active', array['partner_admin','partner_technician'], now() + interval '11 months');

insert into public.partner_assignments (relationship_id, user_id, ends_at)
  select r.id, test.id('u_tech1'), now() + interval '30 days' from public.partner_relationships r where r.client_org_id = test.id('ca');
insert into public.partner_assignments (relationship_id, user_id, starts_at, ends_at)   -- assignation EXPIRÉE
  select r.id, test.id('u_tech2'), now() - interval '2 days', now() - interval '1 day' from public.partner_relationships r where r.client_org_id = test.id('ca');

-- ------------------------------------------------------------------ SEC-01 : isolation entre clients et entre ESN
select test.expect('SEC-01 le technicien assigné voit le client A',
  test.b(test.id('u_tech1'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('ca'))));
select test.expect('SEC-01 le technicien assigné ne voit pas le client B (autre client de la même ESN)',
  not test.b(test.id('u_tech1'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('cb'))));
select test.expect('SEC-01 ni le client C (autre ESN)',
  not test.b(test.id('u_tech1'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('cc'))));
select test.expect('SEC-01 l''administrateur du client A ne voit pas le client B',
  test.q(test.id('u_ca_admin'), format('select count(*) from public.organizations where id = %L', test.id('cb'))) = 0);
select test.expect('SEC-01 l''administrateur du client A voit sa propre organisation',
  test.q(test.id('u_ca_admin'), format('select count(*) from public.organizations where id = %L', test.id('ca'))) = 1);
select test.expect('SEC-01 l''administrateur de l''ESN Deux ne voit rien des clients de l''ESN Un',
  test.q(test.id('u_esn2_admin'), format('select count(*) from public.organizations where id in (%L, %L)', test.id('ca'), test.id('cb'))) = 0);
select test.expect('SEC-01 l''administrateur de l''ESN Un voit ses deux clients',
  test.q(test.id('u_esn1_admin'), format('select count(*) from public.organizations where id in (%L, %L)', test.id('ca'), test.id('cb'))) = 2);
select test.expect('SEC-01 l''administrateur du client B ne lit pas les appartenances du client A',
  test.q(test.id('u_cb_admin'), format('select count(*) from public.memberships where org_id = %L', test.id('ca'))) = 0);

-- ------------------------------------------------------------------ SEC-02 : assignation et relation (R3, R4)
select test.expect('SEC-02 un technicien non assigné ne voit rien',
  not test.b(test.id('u_tech3'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('ca'))));
select test.expect('SEC-02 une assignation expirée ne donne rien',
  not test.b(test.id('u_tech2'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('ca'))));
select test.expect('SEC-02 l''administrateur ESN n''a PAS l''accès technicien (contenu) sans assignation',
  not test.b(test.id('u_esn1_admin'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('ca'))));
select test.expect('SEC-02 mais il a l''accès administrateur (configuration, agrégats)',
  test.b(test.id('u_esn1_admin'), format('select private.partner_can_access(%L, ''partner_admin'')', test.id('ca'))));
select test.expect('SEC-02 le contenu d''un client n''est pas lisible par l''administrateur ESN non assigné',
  not test.b(test.id('u_esn1_admin'), format('select private.can_read_support_data(%L)', test.id('ca'))));
select test.expect('SEC-02 le technicien assigné lit le contenu du client A',
  test.b(test.id('u_tech1'), format('select private.can_read_support_data(%L)', test.id('ca'))));
select test.expect('SEC-02 l''administrateur du client lit le contenu de son organisation',
  test.b(test.id('u_ca_admin'), format('select private.can_read_support_data(%L)', test.id('ca'))));
select test.expect('SEC-02 la direction / observateur ne lit pas le contenu',
  not test.b(test.id('u_ca_viewer'), format('select private.can_read_support_data(%L)', test.id('ca'))));
select test.expect('SEC-02 le salarié ne lit pas le contenu des autres',
  not test.b(test.id('u_ca_user'), format('select private.can_read_support_data(%L)', test.id('ca'))));

update public.partner_relationships set status = 'revoked', revoked_at = now(), revoked_by = test.id('u_ca_admin')
  where client_org_id = test.id('ca');
select test.expect('SEC-02 une relation révoquée coupe le technicien',
  not test.b(test.id('u_tech1'), format('select private.partner_can_access(%L, ''partner_technician'')', test.id('ca'))));
select test.expect('SEC-02 une relation révoquée coupe aussi l''administrateur ESN',
  not test.b(test.id('u_esn1_admin'), format('select private.partner_can_access(%L, ''partner_admin'')', test.id('ca'))));
select test.expect('SEC-02 la révocation est immédiate : l''ESN ne voit plus l''organisation',
  test.q(test.id('u_esn1_admin'), format('select count(*) from public.organizations where id = %L', test.id('ca'))) = 0);
select test.expect('SEC-02 une relation révoquée ne peut pas être rétablie',
  test.err_admin(format('update public.partner_relationships set status = ''active'', revoked_at = null where client_org_id = %L', test.id('ca'))) is not null);

-- Relation échue (expires_at dans le passé) : plus d'accès, sans aucune tâche planifiée (I11).
insert into public.partner_relationships (partner_org_id, client_org_id, status, approved_roles, starts_at, expires_at)
  values (test.id('esn2'), test.id('ca'), 'active', array['partner_admin'], now() - interval '400 days', now() - interval '100 days');
select test.expect('SEC-02 une relation échue ne donne plus d''accès (évaluée à la lecture)',
  not test.b(test.id('u_esn2_admin'), format('select private.partner_can_access(%L, ''partner_admin'')', test.id('ca'))));

-- ------------------------------------------------------------------ garde-fous des relations et assignations
select test.expect('relation : plus de 12 mois refusée',
  test.err_admin(format('insert into public.partner_relationships (partner_org_id, client_org_id, status, approved_roles, expires_at) values (%L, %L, ''proposed'', ''{}'', now() + interval ''13 months'')', test.id('esn2'), test.id('cb'))) = '23514');
select test.expect('relation : une ESN ne peut pas élargir ses rôles approuvés après activation',
  test.err_admin(format('update public.partner_relationships set approved_roles = array[''partner_admin'',''partner_technician''] where client_org_id = %L and partner_org_id = %L', test.id('cb'), test.id('esn1'))) is not null);
select test.expect('relation : prolonger sans nouvelle confirmation du client est refusé',
  test.err_admin(format('update public.partner_relationships set expires_at = expires_at + interval ''1 day'' where client_org_id = %L and partner_org_id = %L', test.id('cb'), test.id('esn1'))) is not null);
select test.expect('relation : le client peut réduire les rôles',
  test.err_admin(format('update public.partner_relationships set status = ''reduced'', approved_roles = array[]::text[] where client_org_id = %L and partner_org_id = %L', test.id('cb'), test.id('esn1'))) is not null);   -- 0 rôle : refusé aussi
select test.expect('assignation : refusée si le client n''a pas approuvé le rôle technicien (client B)',
  test.err_admin(format('insert into public.partner_assignments (relationship_id, user_id, ends_at) select r.id, %L, now() + interval ''1 day'' from public.partner_relationships r where r.client_org_id = %L', test.id('u_tech1'), test.id('cb'))) is not null);
select test.expect('assignation : refusée pour quelqu''un qui n''est pas technicien de l''ESN',
  test.err_admin(format('insert into public.partner_assignments (relationship_id, user_id, ends_at) select r.id, %L, now() + interval ''1 day'' from public.partner_relationships r where r.client_org_id = %L and r.status = ''active''', test.id('u_ca_admin'), test.id('cc'))) is not null);

-- ------------------------------------------------------------------ SEC-03 : accès d'assistance (R5)
select test.expect('SEC-03 le super administrateur voit les organisations (configuration)',
  test.q(test.id('u_super'), format('select count(*) from public.organizations where id = %L', test.id('cc'))) = 1);
select test.expect('SEC-03 mais pas le contenu d''un client sans accès d''assistance',
  not test.b(test.id('u_super'), format('select private.can_read_support_data(%L)', test.id('cc'))));
insert into public.support_access_grants (id, client_org_id, requested_by, reason)
  values ('00000000-0000-0000-0000-0000000000a1', test.id('cc'), test.id('u_super'), 'Diagnostic d''un connecteur en erreur');
select test.expect('SEC-03 une demande non approuvée ne donne rien',
  not test.b(test.id('u_super'), format('select private.can_read_support_data(%L)', test.id('cc'))));
select test.expect('SEC-03 on ne peut pas s''auto-approuver',
  test.err_admin(format('update public.support_access_grants set approved_by = %L, approved_at = now(), starts_at = now(), ends_at = now() + interval ''4 hours'' where id = ''00000000-0000-0000-0000-0000000000a1''', test.id('u_super'))) is not null);
select test.expect('SEC-03 un technicien ne peut pas approuver',
  test.err_admin(format('update public.support_access_grants set approved_by = %L, approved_at = now(), starts_at = now(), ends_at = now() + interval ''4 hours'' where id = ''00000000-0000-0000-0000-0000000000a1''', test.id('u_tech1'))) is not null);
select test.expect('SEC-03 seul le personnel de la plateforme peut demander',
  test.err_admin(format('insert into public.support_access_grants (client_org_id, requested_by, reason) values (%L, %L, ''Une raison suffisamment longue'')', test.id('cc'), test.id('u_cc_admin'))) is not null);
update public.support_access_grants set approved_by = test.id('u_cc_admin'), approved_at = now(), starts_at = now(), ends_at = now() + interval '4 hours'
  where id = '00000000-0000-0000-0000-0000000000a1';
select test.expect('SEC-03 approuvé par l''administrateur du client : le demandeur lit',
  test.b(test.id('u_super'), format('select private.can_read_support_data(%L)', test.id('cc'))));
select test.expect('SEC-03 …mais pas un autre membre de la plateforme',
  not test.b(test.id('u_support'), format('select private.can_read_support_data(%L)', test.id('cc'))));
select test.expect('SEC-03 …et pas un autre client',
  not test.b(test.id('u_super'), format('select private.can_read_support_data(%L)', test.id('cb'))));
select test.expect('SEC-03 la fenêtre approuvée ne peut pas être prolongée',
  test.err_admin('update public.support_access_grants set ends_at = ends_at + interval ''1 hour'' where id = ''00000000-0000-0000-0000-0000000000a1''') is not null);
update public.support_access_grants set revoked_at = now(), revoked_by = test.id('u_cc_admin') where id = '00000000-0000-0000-0000-0000000000a1';
select test.expect('SEC-03 révoqué : l''accès cesse aussitôt',
  not test.b(test.id('u_super'), format('select private.can_read_support_data(%L)', test.id('cc'))));
insert into public.support_access_grants (client_org_id, requested_by, reason, approved_by, approved_at, starts_at, ends_at)
  values (test.id('cc'), test.id('u_super'), 'Ancienne intervention terminée', test.id('u_cc_admin'), now() - interval '5 hours', now() - interval '5 hours', now() - interval '1 hour');
select test.expect('SEC-03 une fenêtre échue ne donne rien (sans tâche planifiée)',
  not test.b(test.id('u_super'), format('select private.can_read_support_data(%L)', test.id('cc'))));
select test.expect('SEC-03 l''accès d''assistance est limité à 24 heures',
  test.err_admin(format('insert into public.support_access_grants (client_org_id, requested_by, reason, approved_by, approved_at, starts_at, ends_at) values (%L, %L, ''Une durée beaucoup trop longue'', %L, now(), now(), now() + interval ''48 hours'')', test.id('cc'), test.id('u_super'), test.id('u_cc_admin'))) = '23514');

-- ------------------------------------------------------------------ SEC-05 : invitations (M29)
select test.expect('SEC-05 un administrateur client ne peut pas inviter un rôle d''une autre famille',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''x@exemple.test'', ''super_admin'', repeat(''a'',64), %L, now() + interval ''1 day'')', test.id('ca'), test.id('u_ca_admin'))) is not null);
select test.expect('SEC-05 un observateur ne peut pas inviter un administrateur (élévation)',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''x@exemple.test'', ''org_admin'', repeat(''b'',64), %L, now() + interval ''1 day'')', test.id('ca'), test.id('u_ca_viewer'))) is not null);
select test.expect('SEC-05 un inconnu ne peut inviter personne',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''x@exemple.test'', ''org_viewer'', repeat(''c'',64), %L, now() + interval ''1 day'')', test.id('ca'), test.id('u_stranger'))) is not null);
select test.expect('SEC-05 l''ESN Deux ne peut pas inviter un administrateur chez le client A (géré par l''ESN Un)',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''x@exemple.test'', ''org_admin'', repeat(''d'',64), %L, now() + interval ''1 day'')', test.id('ca'), test.id('u_esn2_admin'))) is not null);
select test.expect('SEC-05 une invitation de plus de 7 jours est refusée',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''x@exemple.test'', ''org_viewer'', repeat(''e'',64), %L, now() + interval ''8 days'')', test.id('ca'), test.id('u_ca_admin'))) = '23514');
select test.expect('SEC-05 un administrateur client peut inviter un observateur',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''obs@exemple.test'', ''org_viewer'', repeat(''f'',64), %L, now() + interval ''1 day'')', test.id('ca'), test.id('u_ca_admin'))) is null);
-- L'ESN créatrice invite le premier administrateur de son client, tant qu'il n'a pas activé son compte.
select test.expect('SEC-05 l''ESN créatrice invite le premier administrateur de son client (client B, non activé)',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''admin-b2@exemple.test'', ''org_admin'', repeat(''1'',64), %L, now() + interval ''1 day'')', test.id('cb'), test.id('u_esn1_admin'))) is null);
update public.organizations set activated_at = now() where id = test.id('cb');
select test.expect('SEC-05 …plus après l''activation par le client',
  test.err_admin(format('insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at) values (%L, ''admin-b3@exemple.test'', ''org_admin'', repeat(''2'',64), %L, now() + interval ''1 day'')', test.id('cb'), test.id('u_esn1_admin'))) is not null);
select test.expect('SEC-05 une invitation ne sert qu''une fois',
  test.err_admin(format('update public.invitations set used_at = now(), used_by = %L where token_hash = repeat(''f'',64)', test.id('u_stranger'))) is null
  and test.err_admin(format('update public.invitations set used_at = now(), used_by = %L where token_hash = repeat(''f'',64)', test.id('u_stranger'))) is not null);
select test.expect('SEC-05 un jeton d''invitation n''est lisible par personne via l''API',
  test.err(test.id('u_ca_admin'), 'select token_hash from public.invitations') = '42501');
select test.expect('SEC-05 les autres colonnes d''invitation restent lisibles par l''administrateur du client',
  test.q(test.id('u_ca_admin'), 'select count(email) from public.invitations') >= 1);

-- ------------------------------------------------------------------ R9 : dernier administrateur ; appartenances
select test.expect('R9 on ne retire pas le dernier administrateur d''un client',
  test.err_admin(format('delete from public.memberships where user_id = %L and org_id = %L', test.id('u_ca_admin'), test.id('ca'))) is not null);
select test.expect('R9 …ni ne le suspend',
  test.err_admin(format('update public.memberships set status = ''suspended'' where user_id = %L and org_id = %L', test.id('u_ca_admin'), test.id('ca'))) is not null);
select test.expect('un rôle de client est refusé dans une ESN (cohérence rôle / type)',
  test.err_admin(format('insert into public.memberships (user_id, org_id, role) values (%L, %L, ''org_admin'')', test.id('u_stranger'), test.id('esn1'))) is not null);
select test.expect('super_admin est refusé hors plateforme',
  test.err_admin(format('insert into public.memberships (user_id, org_id, role) values (%L, %L, ''super_admin'')', test.id('u_stranger'), test.id('ca'))) is not null);

-- ------------------------------------------------------------------ l'API n'écrit rien
select test.expect('SEC-API un utilisateur authentifié ne peut rien insérer dans organizations',
  test.err(test.id('u_ca_admin'), format('insert into public.organizations (type, name, slug) values (''client'', ''Pirate'', ''pirate'')')) = '42501');
select test.expect('SEC-API …ne peut pas se donner un rôle',
  test.err(test.id('u_ca_viewer'), format('update public.memberships set role = ''org_admin'' where user_id = %L', test.id('u_ca_viewer'))) = '42501');
select test.expect('SEC-API …ne peut pas approuver sa propre relation',
  test.err(test.id('u_tech1'), 'update public.partner_relationships set status = ''active''') = '42501');
select test.expect('SEC-API le rôle anonyme ne lit rien',
  test.err(test.id('u_stranger'), 'select count(*) from public.organizations', 'anon') = '42501');

-- ------------------------------------------------------------------ SEC-27 : journal d'audit en insertion seule
select test.expect('SEC-27 les changements sensibles sont audités automatiquement',
  (select count(*) from public.audit_logs where event = 'partner_relationships.insert') >= 3);
select test.expect('SEC-27 la révocation d''une relation est auditée',
  (select count(*) from public.audit_logs where event = 'partner_relationships.update') >= 1);
select test.expect('SEC-27 le condensé du jeton d''invitation n''apparaît jamais dans le journal',
  (select count(*) from public.audit_logs where details::text like '%token_hash%') = 0);
select test.expect('SEC-27 UPDATE refusé au rôle service_role',
  test.err(test.id('u_super'), 'update public.audit_logs set event = ''x''', 'service_role') = '42501');
select test.expect('SEC-27 DELETE refusé au rôle service_role',
  test.err(test.id('u_super'), 'delete from public.audit_logs', 'service_role') = '42501');
select test.expect('SEC-27 UPDATE refusé même au propriétaire (trigger)',
  test.err_admin('update public.audit_logs set event = ''x''') = '42501');
select test.expect('SEC-27 DELETE refusé même au propriétaire (trigger)',
  test.err_admin('delete from public.audit_logs') = '42501');
select test.expect('SEC-27 TRUNCATE refusé même au propriétaire (trigger)',
  test.err_admin('truncate public.audit_logs') = '42501');
select test.expect('SEC-27 le service peut insérer dans le journal',
  test.err(test.id('u_super'), 'insert into public.audit_logs (actor_kind, event) values (''system'', ''test'')', 'service_role') is null);
select test.expect('SEC-27 l''administrateur d''un client lit le journal de SON organisation',
  test.q(test.id('u_cb_admin'), format('select count(*) from public.audit_logs where org_id = %L', test.id('cb'))) >= 1);
select test.expect('SEC-27 …mais pas celui d''un autre client',
  test.q(test.id('u_cb_admin'), format('select count(*) from public.audit_logs where org_id = %L', test.id('cc'))) = 0);

-- ------------------------------------------------------------------ second facteur récent, fonctionnalités, suspension
select test.expect('MFA récent : second facteur il y a 100 s accepté (limite 600 s)',
  test.b(test.id('u_ca_admin'), 'select private.recent_mfa(600)', 100));
select test.expect('MFA récent : second facteur il y a 700 s refusé',
  not test.b(test.id('u_ca_admin'), 'select private.recent_mfa(600)', 700));
select test.expect('MFA récent : connexion sans second facteur refusée',
  not test.b(test.id('u_ca_admin'), 'select private.recent_mfa(600)', null));
select test.expect('fonctionnalités : une ESN a la marque blanche, un client pilote non',
  test.b(test.id('u_esn1_admin'), format('select private.org_has_feature(%L, ''white_label'')', test.id('esn1')))
  and not test.b(test.id('u_ca_admin'), format('select private.org_has_feature(%L, ''white_label'')', test.id('ca'))));
update public.organizations set state = 'suspended' where id = test.id('cc');
select test.expect('suspension : l''administrateur d''un client suspendu perd l''accès',
  test.q(test.id('u_cc_admin'), format('select count(*) from public.organizations where id = %L', test.id('cc'))) = 0);
select test.expect('suspension : l''ESN perd aussi l''accès au client suspendu',
  not test.b(test.id('u_esn2_admin'), format('select private.partner_can_access(%L, ''partner_admin'')', test.id('cc'))));

rollback;
