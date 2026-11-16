-- Migration 15 : réception des alertes, regroupement en incident, fin d'incident, astreinte, plafonds des règles (SEC-17, SEC-18, M21).
-- Graine de démonstration (Alpha : tech1 assigné ; Bêta : tech2 assigné) ; tout est annulé à la fin.
-- Une instruction ne voit pas les effets d'une fonction qu'elle appelle : on appelle d'abord (table res), on vérifie ensuite.
begin;

create function pg_temp.o(p text) returns uuid language sql as $$ select id from public.organizations where slug = p $$;
create function pg_temp.u(p text) returns uuid language sql as $$ select id from auth.users where email = p $$;
create function pg_temp.dg(p text) returns text language sql as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;
create function pg_temp.iso(p_at timestamptz default now()) returns text language sql as
$$ select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
-- Alerte normalisée de test.
create function pg_temp.al(p_key text, p_asset text, p_sev text default 'major', p_state text default 'open') returns jsonb language sql as
$$ select jsonb_build_object('dedup_key', p_key, 'asset_kind', 'host', 'asset_name', p_asset, 'severity', p_sev, 'state', p_state,
                             'summary', 'Contrôle en échec', 'occurred_at', pg_temp.iso(), 'raw', jsonb_build_object('host', p_asset)) $$;
-- Réception : résultat JSON, ou {"erreur": message}.
create function pg_temp.ing(p_src text, p_dig text, p_alert jsonb) returns jsonb language plpgsql as
$$ begin return public.alert_ingest(p_src::uuid, pg_temp.dg(p_dig), p_alert);
exception when others then return jsonb_build_object('erreur', sqlerrm); end $$;
create function pg_temp.ing_raw(p_src text, p_digest text, p_alert jsonb) returns jsonb language plpgsql as
$$ begin return public.alert_ingest(p_src::uuid, p_digest, p_alert);
exception when others then return jsonb_build_object('erreur', sqlerrm); end $$;
create function pg_temp.call(p_sql text) returns jsonb language plpgsql as
$$ declare v jsonb; begin execute p_sql into v; return v; exception when others then return jsonb_build_object('erreur', sqlerrm); end $$;
create function pg_temp.alert(p_key text) returns public.alerts language sql as
$$ select * from public.alerts where dedup_key = p_key order by first_seen_at desc limit 1 $$;

create temp table res (k text primary key, v jsonb);
create function pg_temp.r(p text) returns jsonb language sql as $$ select v from res where k = p $$;

-- Sources : d1 (Alpha, active, secret), d2 (Alpha, sans secret), d3 (Alpha, désactivée), d4 (Bêta), d5 (Alpha, muette).
insert into public.alert_sources (id, org_id, name, type, expected_interval_seconds, last_seen_at) values
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.o('client-alpha'), 'Supervision alpha', 'webhook', null, null),
  ('00000000-0000-4000-8000-0000000000d2', pg_temp.o('client-alpha'), 'Supervision sans secret', 'webhook', null, null),
  ('00000000-0000-4000-8000-0000000000d3', pg_temp.o('client-alpha'), 'Supervision coupée', 'webhook', null, null),
  ('00000000-0000-4000-8000-0000000000d4', pg_temp.o('client-beta'), 'Supervision bêta', 'webhook', null, null),
  ('00000000-0000-4000-8000-0000000000d5', pg_temp.o('client-alpha'), 'Sauvegardes alpha', 'webhook', 60, now() - interval '10 minutes');
select public.alert_source_secret_set(pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000000d1', repeat('s', 40));
select public.alert_source_secret_set(pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000000d3', repeat('t', 40));
select public.alert_source_secret_set(pg_temp.o('client-beta'), '00000000-0000-4000-8000-0000000000d4', repeat('u', 40));
select public.alert_source_secret_set(pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000000d5', repeat('v', 40));
update public.alert_sources set status = 'disabled' where id = '00000000-0000-4000-8000-0000000000d3';
update public.alert_sources set last_seen_at = now() - interval '10 minutes' where id = '00000000-0000-4000-8000-0000000000d5';

insert into public.asset_links (org_id, asset_pattern, category) values
  (pg_temp.o('client-alpha'), 'vpn-*', 'vpn'),
  (pg_temp.o('client-alpha'), 'srv_print', 'printer'),
  (pg_temp.o('client-beta'), 'flap-*', 'teams');
insert into public.maintenance_windows (org_id, asset_pattern, starts_at, ends_at, reason) values
  (pg_temp.o('client-alpha'), 'maint-*', now() - interval '1 hour', now() + interval '1 hour', 'Mise à jour planifiée');

-- ------------------------------------------------------------------ motifs d'actifs
select test.expect('motif : « * » est le seul joker ; « _ » et « % » sont des caractères ordinaires',
  private.asset_matches('vpn-paris', 'vpn-*') and private.asset_matches('srv_print', 'srv_print')
  and not private.asset_matches('srvXprint', 'srv_print') and not private.asset_matches('a-b', 'a%b') and private.asset_matches('a%b', 'a%b'));

-- ------------------------------------------------------------------ sources refusées (SEC-17)
insert into res values
  ('inconnue', pg_temp.ing(gen_random_uuid()::text, 'x1', pg_temp.al('k1', 'vpn-paris'))),
  ('sans_secret', pg_temp.ing('00000000-0000-4000-8000-0000000000d2', 'x2', pg_temp.al('k1', 'vpn-paris'))),
  ('coupee', pg_temp.ing('00000000-0000-4000-8000-0000000000d3', 'x3', pg_temp.al('k1', 'vpn-paris')));
select test.expect('SEC-17 : source inconnue, sans secret ou désactivée : même refus, rien n''est enregistré',
  pg_temp.r('inconnue') ->> 'erreur' = 'Source introuvable' and pg_temp.r('sans_secret') ->> 'erreur' = 'Source introuvable'
  and pg_temp.r('coupee') ->> 'erreur' = 'Source introuvable'
  and (select count(*) from public.alerts) = 0 and (select count(*) from public.webhook_deliveries) = 0);

update public.organizations set state = 'suspended' where slug = 'client-beta';
insert into res values ('suspendue', pg_temp.ing('00000000-0000-4000-8000-0000000000d4', 'x4', pg_temp.al('k1', 'flap-1')));
update public.organizations set state = 'pilot' where slug = 'client-beta';
select test.expect('SEC-17 : la source d''une organisation suspendue est refusée',
  pg_temp.r('suspendue') ->> 'erreur' = 'Source introuvable');

-- ------------------------------------------------------------------ validation stricte
insert into res values
  ('grav', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v1', pg_temp.al('k1', 'vpn-paris', 'urgent'))),
  ('etat', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v2', pg_temp.al('k1', 'vpn-paris', 'major', 'closed'))),
  ('cle_releve', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v3', pg_temp.al('releve:silence', 'vpn-paris'))),
  ('date_now', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v4', pg_temp.al('k1', 'vpn-paris') || '{"occurred_at": "now"}')),
  ('date_future', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v5', pg_temp.al('k1', 'vpn-paris') || jsonb_build_object('occurred_at', pg_temp.iso(now() + interval '1 hour')))),
  ('date_vieille', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v6', pg_temp.al('k1', 'vpn-paris') || jsonb_build_object('occurred_at', pg_temp.iso(now() - interval '40 days')))),
  ('url_http', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v7', pg_temp.al('k1', 'vpn-paris') || '{"origin_url": "http://supervision.exemple.fr/a/1"}')),
  ('actif_vide', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v8', pg_temp.al('k1', ''))),
  ('resume_long', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v9', pg_temp.al('k1', 'vpn-paris') || jsonb_build_object('summary', repeat('x', 501)))),
  ('type_actif', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v10', pg_temp.al('k1', 'vpn-paris') || '{"asset_kind": "database"}')),
  ('pas_objet', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v11', '[1, 2]'::jsonb)),
  ('empreinte', pg_temp.ing_raw('00000000-0000-4000-8000-0000000000d1', 'pas-une-empreinte', pg_temp.al('k1', 'vpn-paris')));
select test.expect('validation : gravité, état, clé réservée « releve: », dates (mot spécial, futur, trop ancienne), adresse non https, actif vide, résumé trop long, type d''actif, charge non objet : refusés',
  -- coalesce : une alerte ACCEPTÉE à tort n'a pas de clé « erreur » (null), et bool_and ignorerait ce null.
  (select count(*) filter (where coalesce(v ->> 'erreur', '') = 'Alerte invalide') = 11 from res
    where k in ('grav', 'etat', 'cle_releve', 'date_now', 'date_future', 'date_vieille', 'url_http', 'actif_vide', 'resume_long', 'type_actif', 'pas_objet'))
  and pg_temp.r('empreinte') ->> 'erreur' = 'Empreinte invalide');
select test.expect('validation : un refus n''enregistre ni alerte ni livraison (l''outil peut renvoyer)',
  (select count(*) from public.alerts) = 0 and (select count(*) from public.webhook_deliveries) = 0);

-- ------------------------------------------------------------------ réception, rejeu, déduplication, confirmation
insert into res values ('v1_retry', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v1', pg_temp.al('vpn/paris/ping', 'vpn-paris')));
select test.expect('réception : une livraison refusée puis renvoyée (même empreinte) est acceptée, alerte reçue et rattachée à sa catégorie',
  pg_temp.r('v1_retry') ->> 'status' = 'received'
  and (pg_temp.alert('vpn/paris/ping')).category = 'vpn' and (pg_temp.alert('vpn/paris/ping')).attachment_status = 'attached'
  and (pg_temp.alert('vpn/paris/ping')).confirmed_at is null and (pg_temp.alert('vpn/paris/ping')).org_id = pg_temp.o('client-alpha')
  and (select last_seen_at is not null from public.alert_sources where id = '00000000-0000-4000-8000-0000000000d1')
  and exists (select 1 from public.alert_events e where e.alert_id = (pg_temp.alert('vpn/paris/ping')).id and e.kind = 'received'));

insert into res values ('rejeu', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'v1', pg_temp.al('vpn/paris/ping', 'vpn-paris')));
select test.expect('SEC-17 rejeu : la MÊME livraison présentée deux fois est sans effet',
  pg_temp.r('rejeu') ->> 'status' = 'duplicate' and (pg_temp.alert('vpn/paris/ping')).count = 1);

insert into res values ('second', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'p2', pg_temp.al('vpn/paris/ping', 'vpn-paris', 'critical')));
select test.expect('déduplication : même clé = même alerte, compteur, gravité mise à jour ; 2 événements = confirmée (anti-battement)',
  pg_temp.r('second') ->> 'status' = 'confirmed'
  and (select count(*) from public.alerts where dedup_key = 'vpn/paris/ping') = 1
  and (pg_temp.alert('vpn/paris/ping')).count = 2 and (pg_temp.alert('vpn/paris/ping')).severity = 'critical'
  and (pg_temp.alert('vpn/paris/ping')).confirmed_at is not null
  and exists (select 1 from public.alert_events e where e.alert_id = (pg_temp.alert('vpn/paris/ping')).id and e.kind = 'severity_changed')
  and exists (select 1 from public.alert_events e where e.alert_id = (pg_temp.alert('vpn/paris/ping')).id and e.kind = 'deduplicated'));

-- ------------------------------------------------------------------ rattachement, isolation, maintenance
insert into res values
  ('libre', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'a1', pg_temp.al('print/x', 'srvXprint'))),
  ('print', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'a2', pg_temp.al('print/ok', 'srv_print'))),
  ('beta_lien', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'a3', pg_temp.al('flap/1', 'flap-1')));
select test.expect('rattachement : sans motif correspondant, l''alerte est « non rattachée », conservée et signalée',
  (pg_temp.alert('print/x')).attachment_status = 'unattached' and (pg_temp.alert('print/x')).category is null
  and exists (select 1 from public.alert_events e where e.alert_id = (pg_temp.alert('print/x')).id and e.kind = 'unattached')
  and (pg_temp.alert('print/ok')).category = 'printer');
select test.expect('isolation : les motifs d''actifs de Bêta ne rattachent jamais une alerte d''Alpha',
  (pg_temp.alert('flap/1')).attachment_status = 'unattached' and (pg_temp.alert('flap/1')).org_id = pg_temp.o('client-alpha'));

insert into res values
  ('m1', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'm1', pg_temp.al('maint/1', 'maint-db'))),
  ('m2', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'm2', pg_temp.al('maint/1', 'maint-db'))),
  ('m3', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'm3', pg_temp.al('maint/1', 'maint-db')));
select test.expect('maintenance : l''alerte est conservée et comptée, mais jamais confirmée ; signalée une seule fois',
  pg_temp.r('m3') ->> 'status' = 'updated' and (pg_temp.alert('maint/1')).count = 3 and (pg_temp.alert('maint/1')).confirmed_at is null
  and (select count(*) from public.alert_events e where e.alert_id = (pg_temp.alert('maint/1')).id and e.kind = 'suppressed_maintenance') = 1);

-- ------------------------------------------------------------------ résolution et battement
insert into res values
  ('res_inconnue', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'r0', pg_temp.al('jamais/vue', 'vpn-x', 'major', 'resolved'))),
  ('flap_open', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'f1', pg_temp.al('flap/court', 'vpn-flap')));
insert into res values ('flap_res', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'f2', pg_temp.al('flap/court', 'vpn-flap', 'major', 'resolved')));
select test.expect('résolution : une fin d''alerte sans alerte ouverte est ignorée ; une alerte qui s''éteint avant confirmation n''a jamais été annoncée',
  pg_temp.r('res_inconnue') ->> 'status' = 'ignored' and not exists (select 1 from public.alerts where dedup_key = 'jamais/vue')
  and pg_temp.r('flap_res') ->> 'status' = 'resolved' and (pg_temp.r('flap_res') ->> 'was_confirmed')::boolean = false
  and (pg_temp.alert('flap/court')).state = 'resolved' and (pg_temp.alert('flap/court')).resolved_at is not null);

-- ------------------------------------------------------------------ confirmation à l'échéance (tâche planifiée)
update public.alerts set first_seen_at = now() - interval '4 minutes' where dedup_key in ('print/x', 'maint/1', 'flap/1');
update public.alerts set first_seen_at = now() - interval '1 minute' where dedup_key = 'print/ok';
create temp table due as select * from public.alerts_confirm_due(200);
select test.expect('confirmation : au bout de 3 minutes, hors maintenance ; une alerte récente ou en maintenance attend',
  (select count(*) from due) = 2
  and (pg_temp.alert('print/x')).confirmed_at is not null and (pg_temp.alert('flap/1')).confirmed_at is not null
  and (pg_temp.alert('print/ok')).confirmed_at is null and (pg_temp.alert('maint/1')).confirmed_at is null);

-- ------------------------------------------------------------------ source muette
create temp table silence1 as select * from public.alerts_record_silence(100);
create temp table silence2 as select * from public.alerts_record_silence(100);
select test.expect('silence : une source muette depuis 3 intervalles produit UNE alerte « silence anormal », majeure, confirmée, de Relève',
  (select count(*) from silence1) = 1 and (select count(*) from silence2) = 0
  and (select count(*) from public.alerts where source_id = '00000000-0000-4000-8000-0000000000d5' and synthetic and severity = 'major'
         and state = 'open' and confirmed_at is not null and dedup_key = 'releve:silence') = 1);
insert into res values ('retour', pg_temp.ing('00000000-0000-4000-8000-0000000000d5', 's1', pg_temp.al('backup/nuit', 'nas-1', 'information')));
select test.expect('silence : quand la source parle de nouveau, son alerte de silence se résout seule',
  pg_temp.r('retour') ->> 'status' = 'received'
  and (select state from public.alerts where source_id = '00000000-0000-4000-8000-0000000000d5' and dedup_key = 'releve:silence') = 'resolved');

-- ------------------------------------------------------------------ contexte des règles
insert into public.conversations (id, org_id, requester_user_id, category, created_at) values
  ('00000000-0000-4000-8000-00000000e001', pg_temp.o('client-alpha'), pg_temp.u('salarie1@client-alpha.test'), 'vpn', now() - interval '5 minutes'),
  ('00000000-0000-4000-8000-00000000e002', pg_temp.o('client-alpha'), pg_temp.u('salarie2@client-alpha.test'), 'vpn', now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-00000000e003', pg_temp.o('client-alpha'), pg_temp.u('salarie3@client-alpha.test'), 'vpn', now() - interval '40 minutes'),
  ('00000000-0000-4000-8000-00000000e004', pg_temp.o('client-beta'), pg_temp.u('salarie1@client-beta.test'), 'vpn', now() - interval '1 minute');
insert into public.tickets (id, org_id, conversation_id, title, category, external_ref) values
  ('00000000-0000-4000-8000-00000000f001', pg_temp.o('client-alpha'), '00000000-0000-4000-8000-00000000e001', 'VPN coupé', 'vpn', '1001'),
  ('00000000-0000-4000-8000-00000000f002', pg_temp.o('client-alpha'), '00000000-0000-4000-8000-00000000e002', 'VPN lent', 'vpn', null),
  ('00000000-0000-4000-8000-00000000f004', pg_temp.o('client-beta'), '00000000-0000-4000-8000-00000000e004', 'VPN Bêta', 'vpn', '2001');
select test.expect('contexte : champs typés de l''alerte et nombre de demandes de la même catégorie en 15 minutes, dans CETTE organisation',
  (select public.automation_alert_context(pg_temp.o('client-alpha'), (pg_temp.alert('vpn/paris/ping')).id)
     @> '{"alert.severity": "critical", "alert.attachment": "attached", "alert.category": "vpn", "alert.confirmed": true, "incident.resolved": false, "conversations.same_category_15min": 2}')
  and public.automation_alert_context(pg_temp.o('client-beta'), (pg_temp.alert('vpn/paris/ping')).id) is null);
select test.expect('regroupement : seules les alertes confirmées, ouvertes, rattachées et sans incident attendent',
  (select count(*) from public.alerts_awaiting_grouping(200) g where g.alert_id = (pg_temp.alert('vpn/paris/ping')).id) = 1
  and (select count(*) from public.alerts_awaiting_grouping(200) g where g.alert_id in ((pg_temp.alert('print/x')).id, (pg_temp.alert('maint/1')).id)) = 0);

-- ------------------------------------------------------------------ regroupement en incident
update public.organizations set frozen_at = now() where slug = 'client-alpha';
insert into res values ('gel', pg_temp.call(format('select public.incident_group(%L, %L, 100, %L)', pg_temp.o('client-alpha'), (pg_temp.alert('vpn/paris/ping')).id, 'Un incident est en cours.')));
update public.organizations set frozen_at = null where slug = 'client-alpha';
insert into res values
  ('non_conf', pg_temp.call(format('select public.incident_group(%L, %L, 100, null)', pg_temp.o('client-alpha'), (pg_temp.alert('print/ok')).id))),
  ('autre_org', pg_temp.call(format('select public.incident_group(%L, %L, 100, null)', pg_temp.o('client-beta'), (pg_temp.alert('vpn/paris/ping')).id))),
  ('gabarit', pg_temp.call(format('select public.incident_group(%L, %L, 100, %L)', pg_temp.o('client-alpha'), (pg_temp.alert('vpn/paris/ping')).id, 'court')));
select test.expect('regroupement : refusé en arrêt d''urgence ; une alerte non confirmée n''est pas regroupée ; IDOR : une autre organisation ne la trouve pas ; gabarit borné',
  pg_temp.r('gel') ->> 'erreur' like 'Organisation gelée%' and pg_temp.r('non_conf') ->> 'status' = 'not_eligible'
  and pg_temp.r('autre_org') ->> 'erreur' = 'Alerte introuvable' and pg_temp.r('gabarit') ->> 'erreur' = 'Gabarit invalide'
  and (select count(*) from public.incidents) = 0);

insert into res values ('grp1', pg_temp.call(format('select public.incident_group(%L, %L, 100, %L)', pg_temp.o('client-alpha'), (pg_temp.alert('vpn/paris/ping')).id,
  'Un incident en cours touche le service VPN. L''équipe technique est prévenue.')));
select test.expect('regroupement : un incident, un ticket parent, les tickets des demandes récentes de la catégorie deviennent ses enfants',
  (pg_temp.r('grp1') ->> 'created')::boolean and (select count(*) from public.incidents) = 1
  and (select severity from public.incidents) = 'critical'
  and (pg_temp.alert('vpn/paris/ping')).incident_id = (pg_temp.r('grp1') ->> 'incident_id')::uuid
  and (select count(*) from public.tickets where incident_id = (pg_temp.r('grp1') ->> 'incident_id')::uuid) = 3
  and (select parent_id from public.tickets where id = '00000000-0000-4000-8000-00000000f001') = (pg_temp.r('grp1') -> 'parent' ->> 'id')::uuid
  and jsonb_array_length(pg_temp.r('grp1') -> 'new_children') = 2
  and (select incident_id from public.tickets where id = '00000000-0000-4000-8000-00000000f004') is null);
select test.expect('regroupement : les salariés des demandes de la fenêtre (15 minutes) sont prévenus une fois, par un message FIXE et visible',
  (pg_temp.r('grp1') ->> 'notified')::int = 2
  and (select count(*) from public.messages where prompt_version = 'gabarit:incident-ouvert:1' and role = 'system' and visibility = 'public') = 2
  and not exists (select 1 from public.messages where conversation_id = '00000000-0000-4000-8000-00000000e003' and prompt_version like 'gabarit:%')
  and not exists (select 1 from public.messages where conversation_id = '00000000-0000-4000-8000-00000000e004'));
select test.expect('regroupement : le texte de l''alerte (actif, résumé) n''est JAMAIS montré au salarié (SEC-18)',
  not exists (select 1 from public.messages where content like '%vpn-paris%' or content like '%Contrôle en échec%'));

insert into res values ('grp2', pg_temp.call(format('select public.incident_group(%L, %L, 100, %L)', pg_temp.o('client-alpha'), (pg_temp.alert('vpn/paris/ping')).id,
  'Un incident en cours touche le service VPN. L''équipe technique est prévenue.')));
select test.expect('regroupement : rejoué, il ne crée ni incident, ni ticket, ni message de plus (idempotent)',
  (pg_temp.r('grp2') ->> 'created')::boolean = false and (pg_temp.r('grp2') ->> 'notified')::int = 0
  and jsonb_array_length(pg_temp.r('grp2') -> 'new_children') = 0
  and (select count(*) from public.incidents) = 1 and (select count(*) from public.messages where prompt_version like 'gabarit:%') = 2);

insert into res values ('vpn2', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'g1', pg_temp.al('vpn/lyon/ping', 'vpn-lyon', 'warning')));
insert into res values ('vpn2b', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'g2', pg_temp.al('vpn/lyon/ping', 'vpn-lyon', 'warning')));
insert into res values ('grp3', pg_temp.call(format('select public.incident_group(%L, %L, 100, null)', pg_temp.o('client-alpha'), (pg_temp.alert('vpn/lyon/ping')).id)));
select test.expect('regroupement : une seconde alerte de la même catégorie rejoint l''incident ouvert (gravité conservée au plus haut)',
  (pg_temp.r('grp3') ->> 'created')::boolean = false and (pg_temp.r('grp3') ->> 'incident_id') = (pg_temp.r('grp1') ->> 'incident_id')
  and (select count(*) from public.incidents) = 1 and (select severity from public.incidents) = 'critical');

insert into public.conversations (id, org_id, requester_user_id, category, created_at) values
  ('00000000-0000-4000-8000-00000000e005', pg_temp.o('client-alpha'), pg_temp.u('salarie3@client-alpha.test'), 'vpn', now());
select test.expect('suivi : un incident ouvert avec une alerte ouverte est suivi ; jamais celui d''une organisation gelée',
  (select count(*) from public.incidents_open_followup(100) f where f.incident_id = (pg_temp.r('grp1') ->> 'incident_id')::uuid
     and f.alert_id in ((pg_temp.alert('vpn/paris/ping')).id, (pg_temp.alert('vpn/lyon/ping')).id)) = 1);
update public.organizations set frozen_at = now() where slug = 'client-alpha';
select test.expect('suivi : organisation gelée, aucun suivi', (select count(*) from public.incidents_open_followup(100)) = 0);
update public.organizations set frozen_at = null where slug = 'client-alpha';
insert into res values ('suivi', pg_temp.call(format('select public.incident_group(%L, %L, 100, %L)', pg_temp.o('client-alpha'), (pg_temp.alert('vpn/paris/ping')).id,
  'Un incident en cours touche le service VPN. L''équipe technique est prévenue.')));
select test.expect('suivi : une demande arrivée APRÈS l''ouverture est rattachée à l''incident et son auteur prévenu, une fois',
  (pg_temp.r('suivi') ->> 'created')::boolean = false and (pg_temp.r('suivi') ->> 'notified')::int = 1
  and exists (select 1 from public.incident_conversations where conversation_id = '00000000-0000-4000-8000-00000000e005'
                and incident_id = (pg_temp.r('grp1') ->> 'incident_id')::uuid and opened_notice_at is not null)
  and (select count(*) from public.messages where prompt_version = 'gabarit:incident-ouvert:1') = 3);

-- ------------------------------------------------------------------ fin d'incident
insert into res values ('co_ouvert', pg_temp.call(format('select public.incident_close_out(%L, %L, 100, %L, true)', pg_temp.o('client-alpha'), pg_temp.r('grp1') ->> 'incident_id', 'L''incident est résolu.')));
insert into res values ('fin1', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'e1', pg_temp.al('vpn/paris/ping', 'vpn-paris', 'critical', 'resolved')));
select test.expect('fin d''incident : tant qu''une alerte de l''incident reste ouverte, l''incident reste ouvert et rien n''est proposé',
  pg_temp.r('co_ouvert') ->> 'status' = 'incident_open' and (pg_temp.r('fin1') ->> 'incident_resolved')::boolean = false
  and (select state from public.incidents) = 'open');
insert into res values ('fin2', pg_temp.ing('00000000-0000-4000-8000-0000000000d1', 'e2', pg_temp.al('vpn/lyon/ping', 'vpn-lyon', 'warning', 'resolved')));
select test.expect('fin d''incident : la dernière alerte résolue résout l''incident',
  (pg_temp.r('fin2') ->> 'incident_resolved')::boolean and (select state from public.incidents) = 'resolved'
  and (select resolved_at is not null from public.incidents)
  and (select count(*) from public.incidents_recently_resolved(200)) = 1);

insert into res values ('co0', pg_temp.call(format('select public.incident_close_out(%L, %L, 100, %L, true)', pg_temp.o('client-alpha'), pg_temp.r('grp1') ->> 'incident_id',
  'L''incident sur le service VPN est résolu. Si le problème persiste, répondez ici.')));
select test.expect('fin d''incident : les salariés prévenus de l''incident sont prévenus de sa fin, une fois',
  (pg_temp.r('co0') ->> 'notified')::int = 3
  and (select count(*) from public.messages where prompt_version = 'gabarit:incident-resolu:1') = 3);
select test.expect('fin d''incident : au niveau 0 (défaut du pilote), AUCUNE proposition de clôture ; la raison est rendue',
  jsonb_array_length(pg_temp.r('co0') -> 'proposed') = 0 and pg_temp.r('co0') ->> 'refused' like 'Niveau d''autonomie 0%'
  and (select count(*) from public.action_requests) = 0 and (pg_temp.r('co0') ->> 'children_open')::int = 2);

insert into public.autonomy_settings (org_id, category, level, set_by, mfa_verified_at)
  values (pg_temp.o('client-alpha'), 'tickets', 1, pg_temp.u('admin@client-alpha.test'), now());
insert into res values ('co1', pg_temp.call(format('select public.incident_close_out(%L, %L, 100, %L, true)', pg_temp.o('client-alpha'), pg_temp.r('grp1') ->> 'incident_id',
  'L''incident sur le service VPN est résolu. Si le problème persiste, répondez ici.')));
insert into res values ('co2', pg_temp.call(format('select public.incident_close_out(%L, %L, 100, null, true)', pg_temp.o('client-alpha'), pg_temp.r('grp1') ->> 'incident_id')));
select test.expect('fin d''incident : au niveau 1, une demande de clôture À VALIDER par ticket enfant connu de GLPI, jamais exécutée seule, jamais en double',
  jsonb_array_length(pg_temp.r('co1') -> 'proposed') = 1 and (pg_temp.r('co1') ->> 'notified')::int = 0
  and jsonb_array_length(pg_temp.r('co2') -> 'proposed') = 0
  and (select count(*) from public.action_requests) = 1
  and (select count(*) from public.action_requests where capability = 'ticket.update_status' and target_ref = '1001'
         and requested_by_kind = 'automation' and status = 'pending_approval' and params = '{"status": "solved"}'::jsonb) = 1);

-- ------------------------------------------------------------------ astreinte
insert into res values ('n1', to_jsonb(public.notify_oncall(pg_temp.o('client-alpha'), 'incident_opened', 'incident', (pg_temp.r('grp1') ->> 'incident_id')::uuid, '{"severity": "critical"}', 20)));
insert into res values ('n2', to_jsonb(public.notify_oncall(pg_temp.o('client-alpha'), 'incident_opened', 'incident', (pg_temp.r('grp1') ->> 'incident_id')::uuid, '{"severity": "critical"}', 20)));
select test.expect('astreinte : sans personne d''astreinte, les techniciens qui ont accès au client sont prévenus (et seulement eux), une fois',
  (pg_temp.r('n1'))::int = 1 and (pg_temp.r('n2'))::int = 0
  and (select count(*) from public.notifications where recipient_user_id = pg_temp.u('tech1@esn-demo.test') and fallback) = 1
  and not exists (select 1 from public.notifications where recipient_user_id = pg_temp.u('tech2@esn-demo.test')));
insert into public.relief_schedules (org_id, kind, technician_user_id, starts_at, ends_at)
  values (pg_temp.o('client-alpha'), 'on_call', pg_temp.u('tech1@esn-demo.test'), now() - interval '1 hour', now() + interval '6 hours'),
         (pg_temp.o('client-alpha'), 'on_call', pg_temp.u('tech2@esn-demo.test'), now() - interval '1 hour', now() + interval '6 hours');
insert into res values ('n3', to_jsonb(public.notify_oncall(pg_temp.o('client-alpha'), 'source_silent', 'alert', (pg_temp.alert('print/x')).id, '{}', 20)));
select test.expect('astreinte : la personne d''astreinte est prévenue ; une astreinte inscrite pour un technicien SANS accès au client ne reçoit rien',
  (pg_temp.r('n3'))::int = 1
  and exists (select 1 from public.notifications where kind = 'source_silent' and recipient_user_id = pg_temp.u('tech1@esn-demo.test') and not fallback)
  and not exists (select 1 from public.notifications where recipient_user_id = pg_temp.u('tech2@esn-demo.test')));
update public.organizations set frozen_at = now() where slug = 'client-alpha';
insert into res values ('n_gel', pg_temp.call(format('select to_jsonb(public.notify_oncall(%L, ''incident_resolved'', ''incident'', %L, ''{}'', 20))', pg_temp.o('client-alpha'), pg_temp.r('grp1') ->> 'incident_id')));
insert into res values ('co_gel', pg_temp.call(format('select public.incident_close_out(%L, %L, 100, null, false)', pg_temp.o('client-alpha'), pg_temp.r('grp1') ->> 'incident_id')));
update public.organizations set frozen_at = null where slug = 'client-alpha';
select test.expect('arrêt d''urgence : ni notification ni fin d''incident automatisée',
  pg_temp.r('n_gel') ->> 'erreur' like 'Organisation gelée%' and pg_temp.r('co_gel') ->> 'erreur' like 'Organisation gelée%');

select test.expect('RLS : un technicien lit SES notifications ; un autre technicien et l''administrateur du client n''en lisent aucune',
  test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.notifications') = 2
  and test.q(pg_temp.u('tech2@esn-demo.test'), 'select count(*) from public.notifications') = 0
  and test.q(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.notifications') = 0);
update public.partner_assignments set revoked_at = now()
 where user_id = pg_temp.u('tech1@esn-demo.test') and relationship_id = '00000000-0000-4000-8000-0000000000c1';
select test.expect('RLS : un technicien dont l''assignation est retirée ne lit plus les notifications de ce client',
  test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.notifications') = 0);
update public.partner_assignments set revoked_at = null
 where user_id = pg_temp.u('tech1@esn-demo.test') and relationship_id = '00000000-0000-4000-8000-0000000000c1';
select test.expect('RLS : un technicien ne peut changer que la date de lecture de ses notifications',
  test.err(pg_temp.u('tech1@esn-demo.test'), 'update public.notifications set read_at = now()') is null
  and test.err(pg_temp.u('tech1@esn-demo.test'), 'update public.notifications set kind = ''incident_resolved''') = '42501'
  and test.err(pg_temp.u('tech1@esn-demo.test'), format('insert into public.notifications (org_id, recipient_user_id, kind, subject_type, subject_id) values (%L, %L, ''source_silent'', ''alert'', gen_random_uuid())', pg_temp.o('client-alpha'), pg_temp.u('tech1@esn-demo.test'))) = '42501');
select test.expect('RLS : les conversations rattachées à un incident ne sont pas lisibles par un autre client',
  test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.incident_conversations') = 3
  and test.q(pg_temp.u('admin@client-beta.test'), 'select count(*) from public.incident_conversations') = 0);

-- ------------------------------------------------------------------ plafonds des règles (M21)
insert into res values ('c1', public.automation_claim(pg_temp.o('client-alpha'), 'incident-grouped', 'alerte-1', 'vpn', '{}'));
insert into res values ('c2', public.automation_claim(pg_temp.o('client-alpha'), 'incident-grouped', 'alerte-1', 'vpn', '{}'));
insert into res values ('c3', public.automation_claim(pg_temp.o('client-alpha'), 'incident-grouped', 'alerte-2', 'vpn', '{}'));
insert into res values ('c3b', public.automation_claim(pg_temp.o('client-alpha'), 'incident-grouped', 'alerte-2', 'vpn', '{}'));
insert into res values ('c4', public.automation_claim(pg_temp.o('client-alpha'), 'incident-grouped', 'alerte-3', 'printer', '{}'));
select test.expect('plafonds : une exécution par déclencheur ; délai minimal par périmètre (même catégorie) ; un autre périmètre passe',
  pg_temp.r('c1') ->> 'decision' = 'executed' and (pg_temp.r('c1') ->> 'max_items')::int = 100
  and pg_temp.r('c2') ->> 'decision' = 'already'
  and pg_temp.r('c3') ->> 'decision' = 'rate_limited' and pg_temp.r('c3b') ->> 'decision' = 'rate_limited'
  and pg_temp.r('c4') ->> 'decision' = 'executed'
  and (select count(*) from public.automation_runs where rule_key = 'incident-grouped' and trigger_ref = 'alerte-2' and decision = 'rate_limited') = 1);

insert into public.automation_runs (org_id, rule_key, rule_version, trigger_ref, scope, decision, at)
  select pg_temp.o('client-alpha'), 'source-silent', 1, 'r' || g, 'scope-' || g, 'executed', now() - interval '10 minutes' from generate_series(1, 10) g;
insert into res values ('c5', public.automation_claim(pg_temp.o('client-alpha'), 'source-silent', 'r11', 'scope-11', '{}'));
select test.expect('plafonds : au-delà du nombre d''exécutions par heure, la règle n''agit plus (tempête)',
  pg_temp.r('c5') ->> 'decision' = 'rate_limited');

insert into public.automation_rules (org_id, key, name, enabled, dry_run, autonomy, trigger_kind, definition)
  select pg_temp.o('client-beta'), key, name, true, true, autonomy, trigger_kind, definition from public.automation_rules where org_id is null and key = 'incident-grouped';
insert into public.automation_rules (org_id, key, name, enabled, dry_run, autonomy, trigger_kind, definition)
  select pg_temp.o('client-beta'), key, name, false, false, autonomy, trigger_kind, definition from public.automation_rules where org_id is null and key = 'source-silent';
insert into res values ('c6', public.automation_claim(pg_temp.o('client-beta'), 'incident-grouped', 'b-1', 'vpn', '{}'));
insert into res values ('c7', public.automation_claim(pg_temp.o('client-beta'), 'source-silent', 'b-2', 's', '{}'));
insert into res values ('c8', pg_temp.call(format('select public.automation_claim(%L, ''incident-grouped'', %L, ''vpn'', ''{}'')', pg_temp.o('client-beta'), repeat('x', 121))));
select test.expect('plafonds : la copie de l''organisation l''emporte sur le modèle (simulation, désactivée) ; déclencheur borné',
  pg_temp.r('c6') ->> 'decision' = 'dry_run' and pg_temp.r('c7') ->> 'decision' = 'disabled'
  and pg_temp.r('c8') ->> 'erreur' = 'Déclencheur invalide'
  and (select count(*) from public.automation_runs where org_id = pg_temp.o('client-beta') and decision = 'dry_run') = 1);

insert into res values ('note1', to_jsonb(public.automation_note(pg_temp.o('client-alpha'), 'incident-grouped', 2, 'alerte-9', 'skipped', '{"failed": ["conversations.same_category_15min"]}')));
insert into res values ('note2', to_jsonb(public.automation_note(pg_temp.o('client-alpha'), 'incident-grouped', 2, 'alerte-9', 'skipped', '{}')));
insert into res values ('note3', pg_temp.call(format('select to_jsonb(public.automation_note(%L, ''incident-grouped'', 2, ''alerte-9'', ''executed'', ''{}''))', pg_temp.o('client-alpha'))));
select test.expect('registre : une évaluation sans effet est notée une fois ; « exécutée » ne s''inscrit que par les plafonds',
  (pg_temp.r('note1'))::boolean and not (pg_temp.r('note2'))::boolean and pg_temp.r('note3') ->> 'erreur' = 'Décision invalide');

select test.expect('règle « fin d''incident » : ne joue que si l''incident est résolu (version 2)',
  (select version = 2 and definition -> 'all' @> '[{"field": "incident.resolved", "op": "eq", "value": true}]'
     from public.automation_rules where org_id is null and key = 'incident-resolved'));

-- ------------------------------------------------------------------ droits
select test.expect('droits : un utilisateur connecté ne peut appeler AUCUNE fonction de réception, de regroupement, d''astreinte ou de plafond',
  test.err(pg_temp.u('admin@client-alpha.test'), format('select public.alert_ingest(%L, %L, ''{}'')', '00000000-0000-4000-8000-0000000000d1', repeat('a', 64))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.alerts_confirm_due(1)') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.alerts_record_silence(1)') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.incident_group(%L, gen_random_uuid(), 1, null)', pg_temp.o('client-alpha'))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.incident_close_out(%L, gen_random_uuid(), 1, null, true)', pg_temp.o('client-alpha'))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.notify_oncall(%L, ''source_silent'', ''alert'', gen_random_uuid(), ''{}'', 1)', pg_temp.o('client-alpha'))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.automation_claim(%L, ''incident-grouped'', ''x'', null, ''{}'')', pg_temp.o('client-alpha'))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.automation_note(%L, ''incident-grouped'', 1, ''x'', ''skipped'', ''{}'')', pg_temp.o('client-alpha'))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.automation_alert_context(%L, gen_random_uuid())', pg_temp.o('client-alpha'))) = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.alerts_awaiting_grouping(1)') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.incidents_recently_resolved(1)') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.incidents_open_followup(1)') = '42501');
select test.expect('droits : l''anonyme non plus',
  test.err(pg_temp.u('admin@client-alpha.test'), format('select public.alert_ingest(%L, %L, ''{}'')', '00000000-0000-4000-8000-0000000000d1', repeat('a', 64)), 'anon') = '42501'
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.automation_claim(%L, ''incident-grouped'', ''x'', null, ''{}'')', pg_temp.o('client-alpha')), 'anon') = '42501');
select test.expect('droits : le service, lui, peut les appeler',
  test.err(pg_temp.u('admin@client-alpha.test'), 'select count(*) from public.alerts_awaiting_grouping(1)', 'service_role') is null
  and test.err(pg_temp.u('admin@client-alpha.test'), format('select public.automation_alert_context(%L, gen_random_uuid())', pg_temp.o('client-alpha')), 'service_role') is null);

rollback;
