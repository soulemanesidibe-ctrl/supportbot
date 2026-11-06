-- Prix partenaire et marge (SEC-21, M37), rapports mensuels (M33), usage du modèle, conservation et purge (RGPD).
begin;

create table test.ids (k text primary key, id uuid not null default gen_random_uuid());
insert into test.ids (k) select unnest(array['esn','esn2','cli','cli2','esn_admin','esn_mgr','cli_admin','support','super','sal','stranger']);
create function test.id(p text) returns uuid language sql stable as $$ select id from test.ids where k = p $$;
insert into auth.users (id, email) select id, k || '@exemple.test' from test.ids where k not in ('esn','esn2','cli','cli2');
insert into public.organizations (id, type, name, slug, plan, activated_at, created_via_partner_id) values
  (test.id('esn'), 'partner', 'ESN R', 'esn-r', 'partner', null, null), (test.id('esn2'), 'partner', 'ESN R2', 'esn-r2', 'partner', null, null),
  (test.id('cli'), 'client', 'Client R', 'client-r', 'pilot', now(), test.id('esn')),
  (test.id('cli2'), 'client', 'Client R2', 'client-r2', 'pilot', now(), test.id('esn2'));
insert into public.memberships (user_id, org_id, role) values
  (test.id('esn_admin'), test.id('esn'), 'partner_admin'), (test.id('esn_mgr'), test.id('esn'), 'partner_manager'),
  (test.id('cli_admin'), test.id('cli'), 'org_admin'), (test.id('sal'), test.id('cli'), 'end_user'),
  (test.id('super'), (select id from public.organizations where type = 'platform'), 'super_admin'),
  (test.id('support'), (select id from public.organizations where type = 'platform'), 'platform_support');

-- ------------------------------------------------------------------ SEC-21 : prix partenaire et marge
create function test.price(p_partner text, p_client text, p_disc int, p_pub int, p_part int, p_cli int) returns text language plpgsql as $$
begin
  insert into public.partner_pricing (partner_org_id, client_org_id, discount_percent, public_price_cents, partner_price_cents, client_price_cents)
  values (test.id(p_partner), test.id(p_client), p_disc, p_pub, p_part, p_cli);
  return null;
exception when others then return sqlstate; end $$;

select test.expect('prix : 30 % de remise sur 390 € => 273 € pour l''ESN, l''ESN facture 450 € à son client',
  test.price('esn', 'cli', 30, 39000, 27300, 45000) is null);
select test.expect('prix : une remise hors paliers (25, 30, 35 %) est refusée',
  test.price('esn2', 'cli2', 40, 39000, 23400, 45000) = '23514');
select test.expect('prix : un prix partenaire incohérent avec la remise est refusé',
  test.price('esn2', 'cli2', 30, 39000, 20000, 45000) = '23514');
select test.expect('prix : une ESN ne fixe pas de prix pour le client d''une autre ESN',
  test.price('esn', 'cli2', 30, 39000, 27300, 45000) is not null);
select test.expect('prix : un seul tarif en cours par client',
  test.price('esn', 'cli', 25, 39000, 29250, 45000) = '23505');
select test.expect('SEC-21 l''administrateur de l''ESN lit prix et marge',
  test.q(test.id('esn_admin'), 'select count(*) from public.partner_pricing') = 1);
select test.expect('SEC-21 le CLIENT ne voit ni le prix partenaire ni la marge',
  test.q(test.id('cli_admin'), 'select count(*) from public.partner_pricing') = 0);
select test.expect('SEC-21 le responsable de compte de l''ESN ne les voit pas non plus (rôle admin seulement)',
  test.q(test.id('esn_mgr'), 'select count(*) from public.partner_pricing') = 0);
select test.expect('SEC-21 platform_support ne les voit pas',
  test.q(test.id('support'), 'select count(*) from public.partner_pricing') = 0);
select test.expect('SEC-21 le super administrateur les voit',
  test.q(test.id('super'), 'select count(*) from public.partner_pricing') = 1);
select test.expect('SEC-21 un étranger ne voit rien',
  test.q(test.id('stranger'), 'select count(*) from public.partner_pricing') = 0);
select test.expect('SEC-API le prix ne s''écrit pas depuis le navigateur',
  test.err(test.id('esn_admin'), format('update public.partner_pricing set client_price_cents = 1')) = '42501');

-- ------------------------------------------------------------------ rapports mensuels
create function test.report(p_status text, p_content jsonb default '{}', p_period date default '2026-10-01') returns text language plpgsql as $$
begin
  insert into public.monthly_reports (partner_org_id, client_org_id, period, status, content, reviewed_by, sent_by, sent_at)
  values (test.id('esn'), test.id('cli'), p_period, p_status, p_content,
          case when p_status in ('reviewed', 'sent') then test.id('esn_admin') end,
          case when p_status = 'sent' then test.id('esn_admin') end,
          case when p_status = 'sent' then now() end);
  return null;
exception when others then return sqlstate; end $$;
select test.expect('M37 un rapport ne peut PAS contenir la marge ou le prix partenaire',
  test.report('draft', '{"margin": 1200}') = '23514' and test.report('draft', '{"prix_partenaire": 273}', '2026-09-01') = '23514');
select test.expect('un rapport doit viser le premier jour d''un mois',
  test.report('draft', '{}', '2026-10-15') = '23514');
select test.expect('un rapport « envoyé » exige une relecture et un expéditeur',
  test.err_admin(format('insert into public.monthly_reports (partner_org_id, client_org_id, period, status) values (%L, %L, ''2026-08-01'', ''sent'')', test.id('esn'), test.id('cli'))) = '23514');
select test.expect('rapport en brouillon enregistré', test.report('draft', '{"demandes": 186}') is null);
select test.expect('rapport envoyé enregistré', test.report('sent', '{"demandes": 150}', '2026-07-01') is null);
select test.expect('M33 l''ESN lit tous ses rapports',
  test.q(test.id('esn_admin'), 'select count(*) from public.monthly_reports') = 2);
select test.expect('M33 le client ne lit QUE les rapports qui lui ont été envoyés',
  test.q(test.id('cli_admin'), 'select count(*) from public.monthly_reports') = 1
  and test.q(test.id('cli_admin'), 'select count(*) from public.monthly_reports where status = ''draft''') = 0);
select test.expect('M33 le salarié ne lit aucun rapport',
  test.q(test.id('sal'), 'select count(*) from public.monthly_reports') = 0);

-- ------------------------------------------------------------------ usage du modèle
insert into public.llm_usage (org_id, model, purpose, tokens_in, tokens_out, latency_ms, cost_micro_eur)
  values (test.id('cli'), 'mistral-medium-latest', 'answer', 6000, 1000, 1200, 20000);
select test.expect('usage : l''administrateur du client lit l''usage de son organisation',
  test.q(test.id('cli_admin'), 'select count(*) from public.llm_usage') = 1 and test.q(test.id('stranger'), 'select count(*) from public.llm_usage') = 0);
select test.expect('usage : en insertion seule',
  test.err_admin('update public.llm_usage set tokens_in = 0') = '42501');

-- ------------------------------------------------------------------ conservation (RGPD) et purge
insert into public.conversations (id, org_id, requester_user_id, category, purge_after)
  values ('00000000-0000-0000-0000-0000000000c1', test.id('cli'), test.id('sal'), 'vpn', now() - interval '1 day'),
         ('00000000-0000-0000-0000-0000000000c2', test.id('cli'), test.id('sal'), 'vpn', now() + interval '60 days');
insert into public.messages (conversation_id, org_id, role, visibility, content)
  values ('00000000-0000-0000-0000-0000000000c1', test.id('cli'), 'user', 'public', 'Message à purger'),
         ('00000000-0000-0000-0000-0000000000c2', test.id('cli'), 'user', 'public', 'Message à conserver');
insert into public.conversations (id, org_id, requester_user_id) values ('00000000-0000-0000-0000-0000000000c3', test.id('cli'), test.id('sal'));
select test.expect('conservation : la durée par défaut est de 90 jours',
  (select purge_after between now() + interval '89 days' and now() + interval '91 days' from public.conversations where id = '00000000-0000-0000-0000-0000000000c3'));

insert into public.alert_sources (id, org_id, name, type) values ('00000000-0000-0000-0000-0000000000a1', test.id('cli'), 'Source R', 'webhook');
insert into public.alerts (org_id, source_id, dedup_key, asset_name, severity, summary, occurred_at, last_seen_at, raw)
  values (test.id('cli'), '00000000-0000-0000-0000-0000000000a1', 'vieille', 'srv', 'major', 'Ancienne', now() - interval '40 days', now() - interval '40 days', '{"payload":"ancien"}'),
         (test.id('cli'), '00000000-0000-0000-0000-0000000000a1', 'recente', 'srv', 'major', 'Récente', now(), now(), '{"payload":"recent"}');
insert into public.audit_logs (at, actor_kind, event, details) values (now() - interval '5 years', 'system', 'test.audit_ancien', '{}');
select count(*) as audit_avant from public.audit_logs \gset
create table test.purge_result (r jsonb);
insert into test.purge_result select private.purge_expired();
select test.expect('purge : la conversation échue et ses messages sont supprimés, l''autre est conservée',
  (select count(*) from public.conversations where id = '00000000-0000-0000-0000-0000000000c1') = 0
  and (select count(*) from public.messages where content = 'Message à purger') = 0
  and (select count(*) from public.messages where content = 'Message à conserver') = 1);
select test.expect('purge : la charge brute d''une alerte ancienne est effacée, pas celle d''une alerte récente',
  (select raw = '{}'::jsonb from public.alerts where dedup_key = 'vieille') and (select raw <> '{}'::jsonb from public.alerts where dedup_key = 'recente'));
select test.expect('purge : l''alerte elle-même est conservée (seule sa charge brute est minimisée)',
  (select count(*) from public.alerts where dedup_key = 'vieille') = 1);
select test.expect('purge : le journal d''audit n''est JAMAIS purgé (une ligne vieille de 5 ans survit)',
  exists (select 1 from public.audit_logs where event = 'test.audit_ancien')
  and (select count(*) from public.audit_logs) >= :audit_avant);
select test.expect('purge : réservée au service (pas à l''API)',
  test.err(test.id('cli_admin'), 'select private.purge_expired()') = '42501');

-- expirations (cosmétique : l'accès est évalué à la lecture, sans cette tâche)
insert into public.partner_relationships (partner_org_id, client_org_id, status, approved_roles, starts_at, expires_at)
  values (test.id('esn2'), test.id('cli'), 'active', array['partner_admin'], now() - interval '400 days', now() - interval '100 days');
insert into test.purge_result select private.expire_stale();
select test.expect('expiration : une relation échue passe à l''état « expired »',
  (select status = 'expired' from public.partner_relationships where partner_org_id = test.id('esn2') and client_org_id = test.id('cli')));

rollback;
