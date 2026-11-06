-- Mesure de la qualité (barres de passage calculées sur les notes brutes), règles d'automatisation : SEC-20, M21, M36 (spec § 10.4, § 12).
begin;

create table test.ids (k text primary key, id uuid not null default gen_random_uuid());
insert into test.ids (k) select unnest(array['esn','cli','tech','admin','sal']);
create function test.id(p text) returns uuid language sql stable as $$ select id from test.ids where k = p $$;
insert into auth.users (id, email) select id, k || '@exemple.test' from test.ids where k in ('tech','admin','sal');
insert into public.organizations (id, type, name, slug, plan, activated_at, created_via_partner_id) values
  (test.id('esn'), 'partner', 'ESN Q', 'esn-q', 'partner', null, null),
  (test.id('cli'), 'client', 'Client Q', 'client-q', 'pilot', now(), test.id('esn'));
insert into public.memberships (user_id, org_id, role) values
  (test.id('tech'), test.id('esn'), 'partner_technician'), (test.id('admin'), test.id('cli'), 'org_admin'), (test.id('sal'), test.id('cli'), 'end_user');
insert into public.partner_relationships (id, partner_org_id, client_org_id, status, approved_roles, expires_at)
  values ('00000000-0000-0000-0000-00000000f101', test.id('esn'), test.id('cli'), 'active', array['partner_admin','partner_technician'], now() + interval '11 months');
insert into public.partner_assignments (relationship_id, user_id, ends_at) values ('00000000-0000-0000-0000-00000000f101', test.id('tech'), now() + interval '30 days');

-- Fabrique p_n réponses de l'IA (visibles des seuls techniciens) dans une catégorie, puis les note.
create function test.seed_ratings(p_cat text, p_n int, p_correct int, p_over int, p_wrong int, p_dangerous int,
                                  p_kind text default 'answer', p_missed int default 0) returns void language plpgsql as $$
declare v_conv uuid := gen_random_uuid(); r record; i int := 0; v_rating text; v_reason text;
begin
  insert into public.conversations (id, org_id, requester_user_id, category) values (v_conv, test.id('cli'), test.id('sal'), p_cat);
  for r in select gen_random_uuid() as mid from generate_series(1, p_n) loop
    i := i + 1;
    insert into public.messages (id, conversation_id, org_id, role, visibility, content) values (r.mid, v_conv, test.id('cli'), 'assistant', 'technician', 'réponse ' || i);
    v_reason := null;
    if i <= p_correct then v_rating := 'correct';
    elsif i <= p_correct + p_over then v_rating := 'wrong'; v_reason := 'overconfident';
    elsif i <= p_correct + p_over + p_wrong then v_rating := 'wrong'; v_reason := 'other';
    elsif i <= p_correct + p_over + p_wrong + p_dangerous then v_rating := 'dangerous';
    elsif i <= p_correct + p_over + p_wrong + p_dangerous + p_missed then v_rating := 'wrong'; v_reason := 'should_have_escalated';
    else v_rating := 'partial'; end if;
    insert into public.response_ratings (org_id, message_id, kind, rating, reason, rated_by) values (test.id('cli'), r.mid, p_kind, v_rating, v_reason, test.id('tech'));
  end loop;
end $$;
create function test.open(p_cat text, p_override boolean default false, p_reason text default null) returns text language plpgsql as $$
begin
  update public.category_gates set state = 'direct', changed_by = test.id('admin'), override_insufficient_data = p_override, reason = p_reason
   where org_id = test.id('cli') and category = p_cat;
  return null;
exception when others then return sqlerrm; end $$;

-- ------------------------------------------------------------------ barres de passage (docs/11 § 2)
select test.seed_ratings('password', 300, 262, 0, 20, 0);          -- 87 % correctes, aucune fausse assurée, aucun danger
select test.expect('barres : 300 notes, 87 % correctes, 0 fausse assurée, 0 danger => atteintes',
  private.category_bars_met(test.id('cli'), 'password'));
select test.expect('barres : le compte brut est fidèle (300 réponses, 262 correctes)',
  (private.category_stats(test.id('cli'), 'password') ->> 'answers')::int = 300 and (private.category_stats(test.id('cli'), 'password') ->> 'correct')::int = 262);

select test.seed_ratings('mfa', 299, 280, 0, 10, 0);               -- excellent taux mais 299 notes seulement
select test.expect('barres : 299 notes => JAMAIS atteintes, même avec un excellent taux (effectif insuffisant)',
  not private.category_bars_met(test.id('cli'), 'mfa'));
select test.seed_ratings('teams', 300, 210, 0, 40, 0);             -- 70 % correctes
select test.expect('barres : 70 % de réponses correctes (< 80 %) => non atteintes',
  not private.category_bars_met(test.id('cli'), 'teams'));
select test.seed_ratings('outlook', 300, 255, 10, 20, 0);          -- 85 % correctes mais 3,3 % de fausses ASSURÉES (> 2 %)
select test.expect('barres : 3,3 % de fausses mais assurées (> 2 %) => non atteintes',
  not private.category_bars_met(test.id('cli'), 'outlook'));
select test.seed_ratings('onedrive', 300, 285, 0, 0, 0, 'answer', 15);   -- 5 % d'escalades manquées (> 3 %)
select test.expect('barres : 5 % d''escalades manquées (> 3 %) => non atteintes',
  not private.category_bars_met(test.id('cli'), 'onedrive'));

-- Un seul cas dangereux bloque la catégorie, quel que soit le reste.
select test.seed_ratings('printer', 300, 290, 0, 0, 1);
select test.expect('barres : UN cas dangereux bloque la catégorie',
  not private.category_bars_met(test.id('cli'), 'printer'));

-- ------------------------------------------------------------------ ouverture d'une catégorie
select test.expect('ouverture : barres atteintes => l''administrateur ouvre SANS dérogation',
  test.open('password') is null);
select test.expect('ouverture : l''état est « direct », décidé par l''administrateur, sans dérogation',
  (select state = 'direct' and changed_by = test.id('admin') and not override_insufficient_data
   from public.category_gates where org_id = test.id('cli') and category = 'password'));
select test.expect('ouverture : 299 notes => refusée sans décision motivée',
  test.open('mfa') like '%Barres de passage non atteintes%');
select test.expect('ouverture : un cas dangereux => refusée sans décision motivée',
  test.open('printer') like '%Barres de passage non atteintes%');
select test.expect('ouverture : 70 % de correctes => refusée sans décision motivée',
  test.open('teams') like '%Barres de passage non atteintes%');
select test.expect('ouverture : une décision assumée et motivée reste possible',
  test.open('mfa', true, 'Client de démonstration, 299 notes seulement, validé par la direction') is null);
select test.expect('ouverture : …et elle est marquée comme dérogation (affichée comme telle dans l''écran Qualité)',
  (select state = 'direct' and override_insufficient_data from public.category_gates where org_id = test.id('cli') and category = 'mfa'));

-- Retour arrière : une note dangereuse referme la catégorie ouverte
insert into public.messages (id, conversation_id, org_id, role, visibility, content)
  select '00000000-0000-0000-0000-0000000000b2', c.id, test.id('cli'), 'assistant', 'public', 'Conseil risqué'
  from public.conversations c where c.category = 'password' limit 1;
insert into public.response_ratings (org_id, message_id, rating, rated_by)
  values (test.id('cli'), '00000000-0000-0000-0000-0000000000b2', 'dangerous', test.id('tech'));
select test.expect('SEC-20 une note dangereuse referme la catégorie « password » ouverte, sans intervention humaine',
  (select state = 'advice_only' and changed_by is null from public.category_gates where org_id = test.id('cli') and category = 'password'));
select test.expect('SEC-20 une catégorie jamais ouverte n''est pas touchée par une note dangereuse',
  (select state = 'shadow' from public.category_gates where org_id = test.id('cli') and category = 'vpn'));
select test.expect('fermer ou réduire une catégorie exige un motif',
  test.msg_admin(format('update public.category_gates set state = ''shadow'' where org_id = %L and category = ''mfa''', test.id('cli'))) like '%motif%');

-- Purge d'un message : la note reste (statistique), détachée du message
delete from public.messages where id = '00000000-0000-0000-0000-0000000000b2';
select test.expect('purge : la note survit à la suppression du message (détachée, sans autre changement)',
  (select count(*) from public.response_ratings where rating = 'dangerous' and message_id is null) = 1);

-- ------------------------------------------------------------------ règles d'automatisation (M21)
select test.expect('règles livrées : 5 modèles de la plateforme',
  (select count(*) from public.automation_rules where org_id is null) = 5);
select test.expect('règles : « suspicious-reset » est verrouillée et toujours active',
  (select locked and enabled and not dry_run from public.automation_rules where org_id is null and key = 'suspicious-reset'));
select test.expect('règles : une règle verrouillée ne se supprime pas',
  test.err_admin('delete from public.automation_rules where key = ''suspicious-reset''') is not null);
select test.expect('règles : une règle verrouillée ne se désactive pas',
  test.msg_admin('update public.automation_rules set enabled = false where key = ''suspicious-reset''') like '%verrouillée%');
select test.expect('règles : une organisation ne peut pas désactiver une règle verrouillée de la plateforme',
  test.msg_admin(format('insert into public.automation_rules (org_id, key, name, enabled, dry_run, trigger_kind, definition) select %L, key, name, false, false, trigger_kind, definition from public.automation_rules where key = ''suspicious-reset'' and org_id is null', test.id('cli'))) like '%verrouillée par la plateforme%');
select test.expect('règles : une organisation peut copier et mettre en simulation une règle ordinaire',
  test.err_admin(format('insert into public.automation_rules (org_id, key, name, enabled, dry_run, trigger_kind, definition) select %L, key, name, true, true, trigger_kind, definition from public.automation_rules where key = ''incident-grouped'' and org_id is null', test.id('cli'))) is null);
select test.expect('M21 une action de règle hors de l''ensemble fermé est refusée',
  test.msg_admin(format('insert into public.automation_rules (org_id, key, name, trigger_kind, definition) values (%L, ''pirate'', ''Pirate'', ''alert.opened'', ''{"all":[],"action":{"kind":"run_script","params":{}},"limits":{"maxRunsPerHour":1,"maxItemsPerRun":1,"cooldownMinutes":0}}'')', test.id('cli'))) like '%Action de règle inconnue%');
select test.expect('M21 des plafonds sont obligatoires',
  test.msg_admin(format('insert into public.automation_rules (org_id, key, name, trigger_kind, definition) values (%L, ''sans-plafond'', ''Sans plafond'', ''alert.opened'', ''{"all":[],"action":{"kind":"suppress","params":{}}}'')', test.id('cli'))) like '%Plafonds obligatoires%');
select test.expect('M21 des plafonds démesurés sont refusés',
  test.msg_admin(format('insert into public.automation_rules (org_id, key, name, trigger_kind, definition) values (%L, ''demesure'', ''Démesure'', ''alert.opened'', ''{"all":[],"action":{"kind":"suppress","params":{}},"limits":{"maxRunsPerHour":100000,"maxItemsPerRun":1,"cooldownMinutes":0}}'')', test.id('cli'))) like '%Plafonds obligatoires%');
select test.expect('autonomie 1 : réservée à l''action qui PRÉPARE une action_request',
  test.msg_admin(format('insert into public.automation_rules (org_id, key, name, autonomy, trigger_kind, definition) values (%L, ''auto1'', ''Auto un'', 1, ''alert.opened'', ''{"all":[],"action":{"kind":"notify_users","params":{}},"limits":{"maxRunsPerHour":1,"maxItemsPerRun":1,"cooldownMinutes":0}}'')', test.id('cli'))) like '%propose_close_children%');
select test.expect('autonomie : le niveau 2 n''existe pas',
  test.err_admin(format('insert into public.automation_rules (org_id, key, name, autonomy, trigger_kind, definition) values (%L, ''auto2'', ''Auto deux'', 2, ''alert.opened'', ''{"all":[],"action":{"kind":"suppress","params":{}},"limits":{"maxRunsPerHour":1,"maxItemsPerRun":1,"cooldownMinutes":0}}'')', test.id('cli'))) = '23514');
select test.expect('SEC-API les règles ne s''écrivent pas depuis le navigateur',
  test.err(test.id('admin'), 'update public.automation_rules set enabled = false') = '42501');
insert into public.automation_runs (org_id, rule_key, rule_version, decision) values (test.id('cli'), 'incident-grouped', 1, 'dry_run');
select test.expect('le journal d''exécution des règles est en insertion seule',
  test.err_admin('update public.automation_runs set decision = ''executed''') = '42501'
  and test.err_admin('delete from public.automation_runs') = '42501');
select test.expect('SEC-01 les règles de l''organisation ne sont lisibles que de ses administrateurs et techniciens',
  test.q(test.id('admin'), format('select count(*) from public.automation_rules where org_id = %L', test.id('cli'))) >= 1
  and test.q(test.id('sal'), 'select count(*) from public.automation_rules where org_id is not null') = 0);

rollback;
