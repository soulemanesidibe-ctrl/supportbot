-- Migration 13 : fonctions d'administration atomiques et limitation de débit. Graine de démonstration ; tout est annulé à la fin.
-- Les fonctions sont exécutées ici en superutilisateur (le corps de la fonction doit se défendre seul) ; les droits d'exécution
-- sont testés à part. Chaque refus est vérifié par son MESSAGE : on vérifie que la bonne défense a joué.
begin;

create function pg_temp.u(p text) returns uuid language sql as $$ select id from auth.users where email = p $$;
create function pg_temp.o(p text) returns uuid language sql as $$ select id from public.organizations where slug = p $$;
create function pg_temp.fn(p_sql text) returns text language sql as $$ select test.msg_admin(p_sql) $$;
create function pg_temp.create_client(p_actor text, p_partner text, p_slug text, p_email text, p_hash text, p_mfa text default 'now')
returns text language sql as
$$ select test.msg_admin(format('select public.admin_create_client(%L, %L, %L, %L, %L, %L, %L::timestamptz)',
     pg_temp.u(p_actor), pg_temp.o(p_partner), 'Client ' || p_slug, p_slug, p_email, p_hash, p_mfa)) $$;

-- ------------------------------------------------------------------ création d'un client (E3, SEC-29)
select test.expect('SEC-29 création : sans second facteur, refusée',
  test.msg_admin(format('select public.admin_create_client(%L, %L, ''Client G'', ''client-g'', ''g@g.test'', %L, null)',
    pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo'), repeat('1', 64))) like '%second facteur%');
select test.expect('SEC-29 création : second facteur vieux de 30 minutes, refusée',
  pg_temp.create_client('admin@esn-demo.test', 'esn-demo', 'client-g', 'g@g.test', repeat('1', 64), (now() - interval '30 minutes')::text) like '%second facteur%');
select test.expect('SEC-29 création : un technicien de l''ESN ne peut pas créer de client',
  pg_temp.create_client('tech1@esn-demo.test', 'esn-demo', 'client-g', 'g@g.test', repeat('1', 64)) like '%administrateur de l''ESN%');
select test.expect('SEC-29 création : l''administrateur d''un CLIENT ne peut pas créer de client',
  pg_temp.create_client('admin@client-alpha.test', 'esn-demo', 'client-g', 'g@g.test', repeat('1', 64)) like '%administrateur de l''ESN%');
select test.expect('SEC-29 création : une organisation qui n''est pas une ESN est refusée',
  pg_temp.create_client('admin@client-alpha.test', 'client-alpha', 'client-g', 'g@g.test', repeat('1', 64)) like '%ESN introuvable%');
select test.expect('SEC-29 création : aucun client n''a été créé par les refus',
  (select count(*) from public.organizations where slug = 'client-g') = 0);

create temp table r (k text primary key, v jsonb);
create temp table res (k text primary key, msg text);   -- résultat d'un appel, lu par l'instruction SUIVANTE
insert into r select 'g', public.admin_create_client(pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo'), 'Client Gamma', 'client-gamma',
  'Admin@Gamma.test', repeat('1', 64), now());
select test.expect('création : le client est créé, rattaché à l''ESN, NON activé',
  (select o.type = 'client' and o.created_via_partner_id = pg_temp.o('esn-demo') and o.activated_at is null and o.plan = 'pilot' and o.state = 'pilot'
     from public.organizations o where o.slug = 'client-gamma'));
select test.expect('création : la relation est créée ACTIVE en même temps, pour 12 mois au plus, rôles limités',
  (select r.status = 'active' and r.created_by_partner and r.expires_at <= r.starts_at + interval '12 months'
          and r.approved_roles = array['partner_admin', 'partner_technician']
     from public.partner_relationships r where r.client_org_id = pg_temp.o('client-gamma')));
select test.expect('création : l''invitation du premier administrateur est à usage unique, en minuscules, 7 jours au plus, rôle org_admin',
  (select i.role = 'org_admin' and i.email = 'admin@gamma.test' and i.used_at is null and i.token_hash = repeat('1', 64)
          and i.expires_at <= now() + interval '7 days' and i.invited_by = pg_temp.u('admin@esn-demo.test')
     from public.invitations i where i.org_id = pg_temp.o('client-gamma')));
select test.expect('création : les 11 portes de catégorie sont créées FERMÉES (mode ombre)',
  (select count(*) = 11 and bool_and(state = 'shadow') from public.category_gates where org_id = pg_temp.o('client-gamma')));
select test.expect('création : le client n''a AUCUN niveau d''autonomie (tout est au niveau 0)',
  (select count(*) from public.autonomy_settings where org_id = pg_temp.o('client-gamma') and level > 0) = 0);
select test.expect('création : l''audit garde la trace (organisation, relation, invitation)',
  (select count(distinct event) from public.audit_logs where org_id = pg_temp.o('client-gamma')
     and event in ('organizations.insert', 'partner_relationships.insert', 'invitations.insert')) = 3);
select test.expect('création : le jeton d''invitation n''est pas non plus dans le journal d''audit',
  (select count(*) from public.audit_logs where details::text like '%' || repeat('1', 64) || '%') = 0);
select test.expect('création : le technicien n''obtient rien de ce client (aucune assignation)',
  (select count(*) from public.resolve_access(pg_temp.u('tech1@esn-demo.test'), pg_temp.o('client-gamma'))) = 0);
select test.expect('création : l''administrateur de l''ESN y a bien accès par la voie ESN (relation active)',
  (select org_role || '/' || via from public.resolve_access(pg_temp.u('admin@esn-demo.test'), pg_temp.o('client-gamma'))) = 'partner_admin/partner');
select test.expect('création : un identifiant (slug) déjà pris est refusé',
  pg_temp.create_client('admin@esn-demo.test', 'esn-demo', 'client-gamma', 'x@x.test', repeat('2', 64)) like '%organizations_slug_key%');

-- Plafond : fixé à 3 (les 3 clients de l'ESN : alpha, bêta, gamma) → le 4e est refusé, le plafond relevé le permet.
update public.organizations set client_cap = 3 where slug = 'esn-demo';
select test.expect('SEC-29 création : au plafond de clients, refusée (message avec le plafond)',
  pg_temp.create_client('admin@esn-demo.test', 'esn-demo', 'client-delta', 'd@d.test', repeat('3', 64)) like '%Plafond de clients atteint (3)%');
update public.organizations set client_cap = 4 where slug = 'esn-demo';
select test.expect('création : plafond relevé par le service, la création passe',
  pg_temp.create_client('admin@esn-demo.test', 'esn-demo', 'client-delta', 'd@d.test', repeat('3', 64)) is null);
update public.organizations set client_cap = null where slug = 'esn-demo';
select test.expect('plafond : seule une ESN en porte un (un client ne peut pas en recevoir)',
  test.msg_admin('update public.organizations set client_cap = 5 where slug = ''client-alpha''') like '%organizations_client_cap_only_partner%');
select test.expect('plafond : par défaut, 10 clients',
  private.default_client_cap() = 10);

-- ESN gelée : plus de création.
update public.organizations set frozen_at = now() where slug = 'esn-demo';
select test.expect('création : une ESN gelée ne crée plus de client',
  pg_temp.create_client('admin@esn-demo.test', 'esn-demo', 'client-eps', 'e@e.test', repeat('4', 64)) like '%gelée%');
update public.organizations set frozen_at = null where slug = 'esn-demo';

-- ------------------------------------------------------------------ acceptation d'une invitation (M29)
create function pg_temp.accept(p_user uuid, p_email text, p_hash text) returns text language sql as
$$ select test.msg_admin(format('select public.admin_accept_invitation(%L, %L, %L)', p_user, p_email, p_hash)) $$;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e1', 'admin@gamma.test');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e2', 'intrus@autre.test');

select test.expect('M29 invitation : un jeton inconnu donne le message générique',
  pg_temp.accept('00000000-0000-4000-8000-0000000000e1', 'admin@gamma.test', repeat('9', 64)) = 'Invitation invalide ou expirée');
select test.expect('M29 invitation : une autre adresse e-mail donne le MÊME message générique',
  pg_temp.accept('00000000-0000-4000-8000-0000000000e2', 'intrus@autre.test', repeat('1', 64)) = 'Invitation invalide ou expirée');
select test.expect('M29 invitation : sans adresse vérifiée (nulle), refusée avec le même message',
  test.msg_admin(format('select public.admin_accept_invitation(%L, null, %L)', '00000000-0000-4000-8000-0000000000e1', repeat('1', 64))) = 'Invitation invalide ou expirée');
select test.expect('M29 invitation : aucun refus n''a créé d''appartenance',
  (select count(*) from public.memberships where org_id = pg_temp.o('client-gamma')) = 0);
select test.expect('M29 invitation : la bonne personne l''accepte (adresse en minuscules ou non)',
  pg_temp.accept('00000000-0000-4000-8000-0000000000e1', 'Admin@Gamma.test', repeat('1', 64)) is null);
select test.expect('M29 invitation : appartenance active avec le rôle FIXÉ par l''invitation',
  (select m.role = 'org_admin' and m.status = 'active' from public.memberships m
    where m.user_id = '00000000-0000-4000-8000-0000000000e1' and m.org_id = pg_temp.o('client-gamma')));
select test.expect('M29 invitation : le client n''est PAS activé par l''acceptation (activation = décision séparée)',
  (select activated_at is null from public.organizations where slug = 'client-gamma'));
select test.expect('M29 invitation : à usage unique, la rejouer est refusée (même message)',
  pg_temp.accept('00000000-0000-4000-8000-0000000000e1', 'admin@gamma.test', repeat('1', 64)) = 'Invitation invalide ou expirée');

-- Expirée, et organisation suspendue.
insert into public.invitations (org_id, email, role, token_hash, invited_by, created_at, expires_at)
  values (pg_temp.o('client-alpha'), 'vieux@alpha.test', 'org_technician', repeat('5', 64), pg_temp.u('admin@client-alpha.test'),
          now() - interval '3 days', now() - interval '1 day');
select test.expect('M29 invitation : expirée, refusée (même message)',
  pg_temp.accept('00000000-0000-4000-8000-0000000000e2', 'vieux@alpha.test', repeat('5', 64)) = 'Invitation invalide ou expirée');
insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
  values (pg_temp.o('client-beta'), 'nouveau@beta.test', 'org_technician', repeat('6', 64), pg_temp.u('admin@client-beta.test'), now() + interval '2 days');
update public.organizations set state = 'suspended' where slug = 'client-beta';
select test.expect('M29 invitation : organisation suspendue, refusée (même message)',
  pg_temp.accept('00000000-0000-4000-8000-0000000000e2', 'nouveau@beta.test', repeat('6', 64)) = 'Invitation invalide ou expirée');
update public.organizations set state = 'pilot' where slug = 'client-beta';

-- Déjà membre actif : refus, appartenance inchangée ; membre retiré : réactivé avec le rôle de l'invitation.
insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
  values (pg_temp.o('client-alpha'), 'salarie1@client-alpha.test', 'org_admin', repeat('7', 64), pg_temp.u('admin@client-alpha.test'), now() + interval '2 days');
select test.expect('M29 invitation : déjà membre actif, refusée, et le rôle n''est PAS modifié (pas d''élévation par invitation)',
  pg_temp.accept(pg_temp.u('salarie1@client-alpha.test'), 'salarie1@client-alpha.test', repeat('7', 64)) like '%déjà membre%'
  and (select role from public.memberships where user_id = pg_temp.u('salarie1@client-alpha.test') and org_id = pg_temp.o('client-alpha')) = 'end_user');
select test.expect('M29 invitation : l''invitation refusée n''est pas consommée',
  (select used_at is null from public.invitations where token_hash = repeat('7', 64)));
update public.memberships set status = 'removed' where user_id = pg_temp.u('salarie1@client-alpha.test') and org_id = pg_temp.o('client-alpha');
insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
  values (pg_temp.o('client-alpha'), 'salarie1@client-alpha.test', 'org_viewer', repeat('8', 64), pg_temp.u('admin@client-alpha.test'), now() + interval '2 days');
insert into res values ('reactive', coalesce(pg_temp.accept(pg_temp.u('salarie1@client-alpha.test'), 'salarie1@client-alpha.test', repeat('8', 64)), 'ok'));
select test.expect('M29 invitation : un membre retiré est réactivé avec le rôle de la NOUVELLE invitation',
  (select msg from res where k = 'reactive') = 'ok'
  and (select role || '/' || status from public.memberships where user_id = pg_temp.u('salarie1@client-alpha.test') and org_id = pg_temp.o('client-alpha')) = 'org_viewer/active');

-- ------------------------------------------------------------------ arrêt d'urgence (SEC-28)
-- Une demande d'action en attente sur Alpha (gardes désactivées pour la fabriquer, puis réactivées).
alter table public.action_requests disable trigger action_requests_guard;
insert into public.action_requests (org_id, capability, category, target_ref, requested_by_kind)
  values (pg_temp.o('client-alpha'), 'user.mfa_reregister', 'accounts', 'x@alpha.test', 'agent');
alter table public.action_requests enable trigger action_requests_guard;
insert into r select 'req', jsonb_build_object('id', (select id from public.action_requests where target_ref = 'x@alpha.test'));
create function pg_temp.freeze(p_actor text, p_org text, p_frozen boolean) returns text language sql as
$$ select test.msg_admin(format('select public.admin_set_freeze(%L, %L, %L)', pg_temp.u(p_actor), pg_temp.o(p_org), p_frozen)) $$;

select test.expect('SEC-28 gel : l''administrateur d''un AUTRE client ne peut pas geler',
  pg_temp.freeze('admin@client-beta.test', 'client-alpha', true) like '%Droits insuffisants%');
select test.expect('SEC-28 gel : un technicien de l''ESN ne peut pas geler',
  pg_temp.freeze('tech1@esn-demo.test', 'client-alpha', true) like '%Droits insuffisants%');
select test.expect('SEC-28 gel : un salarié ne peut pas geler',
  pg_temp.freeze('salarie2@client-alpha.test', 'client-alpha', true) like '%Droits insuffisants%');
select test.expect('SEC-28 gel : la plateforme ne se gèle pas',
  pg_temp.freeze('fondateur@releve-demo.test', 'releve', true) like '%introuvable%');
select test.expect('SEC-28 gel : les refus n''ont rien gelé ni annulé',
  (select frozen_at is null from public.organizations where slug = 'client-alpha')
  and (select status from public.action_requests where target_ref = 'x@alpha.test') = 'pending_approval');
insert into res values ('f1', coalesce(pg_temp.freeze('admin@client-alpha.test', 'client-alpha', true), 'ok'));
select test.expect('SEC-28 gel : l''administrateur du client gèle ; la demande en attente est annulée avec un motif',
  (select msg from res where k = 'f1') = 'ok'
  and (select frozen_at is not null and frozen_by = pg_temp.u('admin@client-alpha.test') from public.organizations where slug = 'client-alpha')
  and (select status || '/' || reason from public.action_requests where target_ref = 'x@alpha.test') = 'cancelled/Arrêt d''urgence de l''organisation');
select test.expect('SEC-28 gel : resolve_access annonce l''organisation gelée',
  (select is_frozen from public.resolve_access(pg_temp.u('admin@client-alpha.test'), pg_temp.o('client-alpha'))));
insert into res values ('f2', coalesce(pg_temp.freeze('admin@esn-demo.test', 'client-beta', true), 'ok'));
select test.expect('SEC-28 gel : l''administrateur de l''ESN (voie ESN) peut aussi geler un client',
  (select msg from res where k = 'f2') = 'ok'
  and (select frozen_at is not null from public.organizations where slug = 'client-beta'));
select test.expect('SEC-28 dégel : l''administrateur de l''ESN NE PEUT PAS dégeler un client (seul le client, ou la plateforme)',
  pg_temp.freeze('admin@esn-demo.test', 'client-beta', false) like '%Droits insuffisants%'
  and (select frozen_at is not null from public.organizations where slug = 'client-beta'));
insert into res values ('d1', coalesce(pg_temp.freeze('admin@client-beta.test', 'client-beta', false), 'ok'));
insert into res values ('d2', coalesce(pg_temp.freeze('admin@client-alpha.test', 'client-alpha', false), 'ok'));
select test.expect('SEC-28 dégel : l''administrateur du client dégèle ; la demande annulée ne revient JAMAIS',
  (select msg from res where k = 'd1') = 'ok' and (select msg from res where k = 'd2') = 'ok'
  and (select frozen_at is null from public.organizations where slug = 'client-alpha')
  and (select status from public.action_requests where target_ref = 'x@alpha.test') = 'cancelled');
insert into res values ('s1', coalesce(pg_temp.freeze('fondateur@releve-demo.test', 'client-alpha', true), 'ok'));
select test.expect('SEC-28 gel : le super administrateur peut geler n''importe quel client',
  (select msg from res where k = 's1') = 'ok'
  and (select frozen_at is not null from public.organizations where slug = 'client-alpha'));
insert into res values ('s2', coalesce(pg_temp.freeze('fondateur@releve-demo.test', 'client-alpha', false), 'ok'));
select test.expect('SEC-28 dégel : le super administrateur peut dégeler',
  (select msg from res where k = 's2') = 'ok'
  and (select frozen_at is null from public.organizations where slug = 'client-alpha'));
insert into res values ('g1', coalesce(pg_temp.freeze('admin@client-alpha.test', 'client-alpha', true), 'ok'));
insert into r select 'first_freeze', to_jsonb((select frozen_at from public.organizations where slug = 'client-alpha'));
insert into res values ('g2', coalesce(pg_temp.freeze('fondateur@releve-demo.test', 'client-alpha', true), 'ok'));
select test.expect('SEC-28 gel : geler deux fois conserve le premier gel (date et auteur)',
  (select msg from res where k = 'g2') = 'ok'
  and (select to_jsonb(frozen_at) from public.organizations where slug = 'client-alpha') = (select v from r where k = 'first_freeze')
  and (select frozen_by from public.organizations where slug = 'client-alpha') = pg_temp.u('admin@client-alpha.test'));
update public.organizations set frozen_at = null, frozen_by = null where slug = 'client-alpha';

-- ------------------------------------------------------------------ départ d'un technicien (R7)
create function pg_temp.offboard(p_actor text, p_user text) returns text language sql as
$$ select test.msg_admin(format('select public.admin_offboard_technician(%L, %L, %L)', pg_temp.u(p_actor), pg_temp.o('esn-demo'), pg_temp.u(p_user))) $$;
select test.expect('R7 départ : un technicien ne peut pas retirer un collègue',
  pg_temp.offboard('tech1@esn-demo.test', 'tech2@esn-demo.test') like '%administrateur de l''ESN%');
select test.expect('R7 départ : on ne se retire pas soi-même',
  pg_temp.offboard('admin@esn-demo.test', 'admin@esn-demo.test') like '%soi-même%');
select test.expect('R7 départ : on ne retire pas quelqu''un d''une autre organisation',
  pg_temp.offboard('admin@esn-demo.test', 'admin@client-alpha.test') like '%n''appartient pas à l''ESN%');
select test.expect('R7 départ : les refus n''ont rien révoqué',
  (select count(*) from public.partner_assignments where user_id = pg_temp.u('tech1@esn-demo.test') and revoked_at is null) >= 1);
insert into res values ('off', coalesce(pg_temp.offboard('admin@esn-demo.test', 'tech1@esn-demo.test'), 'ok'));
select test.expect('R7 départ : l''administrateur retire le technicien, tout est révoqué ensemble',
  (select msg from res where k = 'off') = 'ok'
  and (select count(*) from public.partner_assignments where user_id = pg_temp.u('tech1@esn-demo.test') and revoked_at is null) = 0
  and (select status from public.memberships where user_id = pg_temp.u('tech1@esn-demo.test') and org_id = pg_temp.o('esn-demo')) = 'removed'
  and (select count(*) from public.resolve_access(pg_temp.u('tech1@esn-demo.test'), pg_temp.o('client-alpha'))) = 0);
select test.expect('R7 départ : un technicien déjà retiré n''est plus retirable (rien à faire)',
  pg_temp.offboard('admin@esn-demo.test', 'tech1@esn-demo.test') like '%n''appartient pas à l''ESN%');

-- ------------------------------------------------------------------ limitation de débit (SEC-24)
select test.expect('débit : les trois premiers appels passent, le quatrième est refusé (limite 3)',
  (select array_agg(public.rate_limit_hit('test:a', 60, 3) order by g) from generate_series(1, 4) g) = array[true, true, true, false]);
select test.expect('débit : une autre clé a son propre compteur',
  public.rate_limit_hit('test:b', 60, 3));
select test.expect('débit : une clé vide, trop longue, une fenêtre ou une limite hors bornes sont refusées',
  test.msg_admin('select public.rate_limit_hit('''', 60, 3)') like '%invalides%'
  and test.msg_admin(format('select public.rate_limit_hit(%L, 60, 3)', repeat('x', 201))) like '%invalides%'
  and test.msg_admin('select public.rate_limit_hit(''k'', 0, 3)') like '%invalides%'
  and test.msg_admin('select public.rate_limit_hit(''k'', 60, 0)') like '%invalides%'
  and test.msg_admin('select public.rate_limit_hit(null, 60, 3)') like '%invalides%');
insert into public.rate_limits (key, window_start, hits) values ('test:vieux', now() - interval '3 days', 5);
select count(public.rate_limit_hit('test:purge', 60, 100000)) from generate_series(1, 2000);
select test.expect('débit : les lignes de plus d''un jour disparaissent d''elles-mêmes',
  (select count(*) from public.rate_limits where key = 'test:vieux') = 0);

-- ------------------------------------------------------------------ droits d'exécution : jamais pour un utilisateur de l'API
select test.expect('droits : un utilisateur connecté ne peut appeler AUCUNE de ces fonctions (42501)',
  test.err(pg_temp.u('admin@esn-demo.test'), format('select public.admin_create_client(%L, %L, ''x'', ''xx'', ''x@x.test'', %L, now())', pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo'), repeat('a', 64))) = '42501'
  and test.err(pg_temp.u('admin@esn-demo.test'), format('select public.admin_accept_invitation(%L, ''x@x.test'', %L)', pg_temp.u('admin@esn-demo.test'), repeat('a', 64))) = '42501'
  and test.err(pg_temp.u('admin@esn-demo.test'), format('select public.admin_set_freeze(%L, %L, true)', pg_temp.u('admin@esn-demo.test'), pg_temp.o('client-alpha'))) = '42501'
  and test.err(pg_temp.u('admin@esn-demo.test'), format('select public.admin_offboard_technician(%L, %L, %L)', pg_temp.u('admin@esn-demo.test'), pg_temp.o('esn-demo'), pg_temp.u('tech2@esn-demo.test'))) = '42501'
  and test.err(pg_temp.u('admin@esn-demo.test'), 'select public.rate_limit_hit(''k'', 60, 3)') = '42501');
select test.expect('droits : le rôle anonyme non plus',
  test.err(pg_temp.u('admin@esn-demo.test'), 'select public.rate_limit_hit(''k'', 60, 3)', 'anon') = '42501'
  and test.err(pg_temp.u('admin@esn-demo.test'), format('select public.admin_set_freeze(%L, %L, true)', pg_temp.u('admin@esn-demo.test'), pg_temp.o('client-alpha')), 'anon') = '42501');
select test.expect('droits : le service, lui, peut les appeler',
  test.err(pg_temp.u('admin@esn-demo.test'), 'select public.rate_limit_hit(''k'', 60, 3)', 'service_role') is null);
select test.expect('droits : la table des compteurs n''est lisible par aucun utilisateur de l''API',
  test.err(pg_temp.u('admin@esn-demo.test'), 'select count(*) from public.rate_limits') = '42501'
  and test.err(pg_temp.u('admin@esn-demo.test'), 'select count(*) from public.rate_limits', 'anon') = '42501');

rollback;
