-- Migration 14 : accès du service aux secrets, source de webhook, rejeu. Graine de démonstration ; tout est annulé à la fin.
-- Les fonctions sont exécutées en superutilisateur (le corps doit se défendre seul) ; les droits d'exécution sont testés à part.
-- Une instruction ne voit pas les effets d'une fonction qu'elle appelle : on appelle d'abord, on vérifie dans l'instruction suivante.
begin;

create function pg_temp.o(p text) returns uuid language sql as $$ select id from public.organizations where slug = p $$;
create function pg_temp.u(p text) returns uuid language sql as $$ select id from auth.users where email = p $$;

insert into public.connectors (id, org_id, type, name, status, config) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.o('client-alpha'), 'glpi', 'GLPI alpha', 'ok', '{"base_url":"https://alpha.glpi.exemple.fr"}'),
  ('00000000-0000-4000-8000-0000000000c2', pg_temp.o('client-beta'), 'glpi', 'GLPI bêta', 'ok', '{"base_url":"https://beta.glpi.exemple.fr"}'),
  ('00000000-0000-4000-8000-0000000000c3', pg_temp.o('client-alpha'), 'glpi', 'GLPI désactivé', 'disabled', '{}');
insert into public.alert_sources (id, org_id, name, type, severity_map, field_mapping) values
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.o('client-alpha'), 'Supervision alpha', 'webhook', '{"CRITICAL":"critical"}', '{"asset":"host"}'),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.o('client-alpha'), 'Supervision sans secret', 'webhook', '{}', '{}'),
  ('00000000-0000-4000-8000-0000000000d3', pg_temp.o('client-alpha'), 'Supervision coupée', 'webhook', '{}', '{}');

create temp table res (k text primary key, v text);
create function pg_temp.set_secret(p_org text, p_conn text, p_secret text) returns text language sql as
$$ select coalesce(test.msg_admin(format('select public.connector_secret_set(%L, %L, %L)', pg_temp.o(p_org), p_conn::uuid, p_secret)), 'ok') $$;
create function pg_temp.get_secret(p_org text, p_conn text) returns text language plpgsql as
$$ declare v text; begin
  v := public.connector_secret_get(pg_temp.o(p_org), p_conn::uuid); return v;
exception when others then return 'ERREUR : ' || sqlerrm; end $$;
create function pg_temp.set_alert_secret(p_org text, p_src text, p_secret text) returns text language sql as
$$ select coalesce(test.msg_admin(format('select public.alert_source_secret_set(%L, %L, %L)', pg_temp.o(p_org), p_src::uuid, p_secret)), 'ok') $$;

-- ------------------------------------------------------------------ secrets des connecteurs
select test.expect('secret : un secret vide ou trop court est refusé',
  pg_temp.set_secret('client-alpha', '00000000-0000-4000-8000-0000000000c1', 'court') like '%trop court%');
select test.expect('secret : IDOR : l''organisation Bêta ne peut ni écrire ni lire le secret du connecteur d''Alpha',
  pg_temp.set_secret('client-beta', '00000000-0000-4000-8000-0000000000c1', 'un-secret-de-test-32-caracteres!!') = 'Connecteur introuvable'
  and pg_temp.get_secret('client-beta', '00000000-0000-4000-8000-0000000000c1') = 'ERREUR : Connecteur introuvable');
select test.expect('secret : un connecteur désactivé n''a ni écriture ni lecture',
  pg_temp.set_secret('client-alpha', '00000000-0000-4000-8000-0000000000c3', 'un-secret-de-test-32-caracteres!!') = 'Connecteur introuvable');
select test.expect('secret : un connecteur inconnu donne le même message',
  pg_temp.get_secret('client-alpha', gen_random_uuid()::text) = 'ERREUR : Connecteur introuvable');
select test.expect('secret : aucun secret n''a été écrit par les refus',
  (select vault_secret_id is null from public.connectors where id = '00000000-0000-4000-8000-0000000000c1'));

insert into res values ('set', pg_temp.set_secret('client-alpha', '00000000-0000-4000-8000-0000000000c1', '{"user_token":"jeton-utilisateur-de-test","app_token":"jeton-appli-de-test"}'));
select test.expect('secret : le bon connecteur de la bonne organisation écrit son secret',
  (select v from res where k = 'set') = 'ok'
  and (select vault_secret_id is not null from public.connectors where id = '00000000-0000-4000-8000-0000000000c1'));
select test.expect('secret : la lecture rend le secret de CE connecteur',
  pg_temp.get_secret('client-alpha', '00000000-0000-4000-8000-0000000000c1') = '{"user_token":"jeton-utilisateur-de-test","app_token":"jeton-appli-de-test"}');
select test.expect('secret : le secret d''Alpha reste illisible pour Bêta même après écriture',
  pg_temp.get_secret('client-beta', '00000000-0000-4000-8000-0000000000c1') = 'ERREUR : Connecteur introuvable');
select test.expect('secret : le secret n''apparaît dans AUCUNE ligne du journal d''audit',
  (select count(*) from public.audit_logs where details::text like '%jeton-utilisateur-de-test%' or details::text like '%jeton-appli-de-test%') = 0);
select test.expect('secret : le secret n''est pas non plus dans la table des connecteurs (configuration)',
  (select count(*) from public.connectors where config::text like '%jeton-%') = 0);

-- ------------------------------------------------------------------ source d'alertes : secret et accès du webhook
select test.expect('webhook : un secret de moins de 32 caractères est refusé',
  pg_temp.set_alert_secret('client-alpha', '00000000-0000-4000-8000-0000000000d1', 'trop court') like '%secret%');
select test.expect('webhook : IDOR : Bêta ne peut pas poser le secret d''une source d''Alpha',
  pg_temp.set_alert_secret('client-beta', '00000000-0000-4000-8000-0000000000d1', repeat('s', 40)) = 'Source introuvable');
insert into res values ('src', pg_temp.set_alert_secret('client-alpha', '00000000-0000-4000-8000-0000000000d1', repeat('s', 40)));
insert into res values ('src3', pg_temp.set_alert_secret('client-alpha', '00000000-0000-4000-8000-0000000000d3', repeat('t', 40)));
update public.alert_sources set status = 'disabled' where id = '00000000-0000-4000-8000-0000000000d3';

select test.expect('webhook : une source active avec secret est retrouvée (organisation, secret, correspondances)',
  (select v from res where k = 'src') = 'ok'
  and (public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d1') ->> 'org_id') = pg_temp.o('client-alpha')::text
  and (public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d1') ->> 'secret') = repeat('s', 40)
  and (public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d1') -> 'severity_map' ->> 'CRITICAL') = 'critical');
update public.organizations set frozen_at = now() where slug = 'client-alpha';
select test.expect('webhook : l''état de l''organisation accompagne la source (arrêt d''urgence, activation), pour le contexte de la requête',
  (public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d1') ->> 'frozen')::boolean
  and (public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d1') ->> 'activated')::boolean);
update public.organizations set frozen_at = null where slug = 'client-alpha';
select test.expect('webhook : organisation active : non gelée',
  not (public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d1') ->> 'frozen')::boolean);
select test.expect('webhook : source inconnue, sans secret ou désactivée : MÊME résultat vide (rien à distinguer)',
  public.alert_source_for_webhook(gen_random_uuid()) is null
  and public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d2') is null
  and public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d3') is null);
update public.organizations set state = 'suspended' where slug = 'client-alpha';
select test.expect('webhook : organisation suspendue : la source n''est plus servie',
  public.alert_source_for_webhook('00000000-0000-4000-8000-0000000000d1') is null);
update public.organizations set state = 'pilot' where slug = 'client-alpha';

-- ------------------------------------------------------------------ rejeu
create function pg_temp.delivery(p_src text, p_digest text) returns boolean language sql as
$$ select public.webhook_first_delivery(p_src::uuid, p_digest) $$;
select test.expect('rejeu : la première présentation passe',
  pg_temp.delivery('00000000-0000-4000-8000-0000000000d1', repeat('a', 64)));
select test.expect('rejeu : la MÊME livraison présentée une seconde fois est refusée',
  not pg_temp.delivery('00000000-0000-4000-8000-0000000000d1', repeat('a', 64)));
select test.expect('rejeu : une autre livraison, ou la même empreinte pour une autre source, passe',
  pg_temp.delivery('00000000-0000-4000-8000-0000000000d1', repeat('b', 64))
  and pg_temp.delivery('00000000-0000-4000-8000-0000000000d2', repeat('a', 64)));
select test.expect('rejeu : une empreinte mal formée est refusée',
  test.msg_admin('select public.webhook_first_delivery(''00000000-0000-4000-8000-0000000000d1'', ''pas-une-empreinte'')') = 'Empreinte invalide'
  and test.msg_admin('select public.webhook_first_delivery(''00000000-0000-4000-8000-0000000000d1'', null)') = 'Empreinte invalide');

-- ------------------------------------------------------------------ droits d'exécution : jamais pour un utilisateur de l'API
select test.expect('droits : un utilisateur connecté ne peut appeler AUCUNE de ces fonctions (42501)',
  test.err(pg_temp.u('admin@client-alpha.test'), format('select public.connector_secret_get(%L, %L)', pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000000c1'::uuid)) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.connector_secret_set(%L, %L, ''un-secret-de-test-32-caracteres!!'')', pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000000c1'::uuid)) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.alert_source_secret_set(%L, %L, %L)', pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000000d1'::uuid, repeat('s', 40))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), 'select public.alert_source_for_webhook(''00000000-0000-4000-8000-0000000000d1'')') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.webhook_first_delivery(''00000000-0000-4000-8000-0000000000d1'', %L)', repeat('c', 64))) = '42501');
select test.expect('droits : le rôle anonyme non plus',
  test.err(pg_temp.u('admin@client-alpha.test'), 'select public.alert_source_for_webhook(''00000000-0000-4000-8000-0000000000d1'')', 'anon') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.connector_secret_get(%L, %L)', pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000000c1'::uuid), 'anon') = '42501');
select test.expect('droits : le service, lui, peut les appeler',
  test.err(pg_temp.u('admin@client-alpha.test'), 'select public.alert_source_for_webhook(''00000000-0000-4000-8000-0000000000d1'')', 'service_role') is null);
select test.expect('droits : la table des livraisons n''est lisible par aucun utilisateur de l''API',
  test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.webhook_deliveries') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.webhook_deliveries', 'anon') = '42501');

rollback;
