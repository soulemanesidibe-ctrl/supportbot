-- Relève IA : moteur d'automatisations, notation des réponses et mode ombre (portes de catégorie).
-- Menaces M21, M35, M36 ; SEC-19, SEC-20 (docs/spec-mvp.md § 10, § 12).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100700_actions.sql.

-- ---------------------------------------------------------------------------------------------------------------
-- Règles d'automatisation : déclaratives, ensemble d'actions FERMÉ, plafonds anti-tempête
-- ---------------------------------------------------------------------------------------------------------------
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,     -- null : règle livrée par la plateforme (modèle)
  key text not null check (key ~ '^[a-z0-9-]{3,60}$'),
  version int not null default 1 check (version >= 1),
  name text not null check (char_length(name) between 3 and 120),
  enabled boolean not null default true,
  dry_run boolean not null default true,        -- simulation : décision journalisée, aucun effet. À utiliser avant d'activer.
  autonomy smallint not null default 0 check (autonomy in (0, 1)),
  locked boolean not null default false,        -- règle système : ni désactivable ni supprimable
  trigger_kind text not null check (trigger_kind in
    ('alert.opened', 'alert.resolved', 'alert.source_silent', 'conversation.message', 'm365.service_degraded')),
  definition jsonb not null,                    -- {all:[...], any:[...], action:{kind,params}, limits:{...}}
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (org_id, key)
);
create trigger automation_rules_updated_at before update on public.automation_rules
  for each row execute function private.set_updated_at();

create function private.automation_rules_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare
  v_action text; v_limits jsonb; v_locked_platform boolean;
begin
  if tg_op = 'DELETE' then
    if old.locked then raise exception 'Une règle verrouillée ne se supprime pas'; end if;
    return old;
  end if;
  v_action := new.definition #>> '{action,kind}';
  -- Ensemble fermé : ajouter une action = modifier le moteur ET le modèle de menace (docs/spec-mvp.md § 12).
  if v_action is null or v_action not in ('group_into_incident', 'notify_users', 'notify_oncall',
                                          'propose_close_children', 'create_security_ticket', 'suppress') then
    raise exception 'Action de règle inconnue : %', v_action; end if;
  -- Seules les actions qui préparent une action_request peuvent être d'autonomie 1 ; et jamais pour l'exécuter.
  if new.autonomy = 1 and v_action <> 'propose_close_children' then
    raise exception 'Seule l''action propose_close_children peut avoir l''autonomie 1 (elle prépare une action_request, elle ne l''exécute pas)'; end if;
  v_limits := new.definition -> 'limits';
  if v_limits is null
     or coalesce((v_limits ->> 'maxRunsPerHour')::int, 0) not between 1 and 1000
     or coalesce((v_limits ->> 'maxItemsPerRun')::int, 0) not between 1 and 500
     or coalesce((v_limits ->> 'cooldownMinutes')::int, -1) not between 0 and 1440 then
    raise exception 'Plafonds obligatoires (maxRunsPerHour 1 à 1000, maxItemsPerRun 1 à 500, cooldownMinutes 0 à 1440) : protection contre les tempêtes (M21)'; end if;
  if new.locked and (not new.enabled or new.dry_run) then
    raise exception 'Une règle verrouillée est toujours active et jamais en simulation'; end if;
  -- Une organisation ne peut pas désactiver ni mettre en simulation une règle verrouillée de la plateforme.
  if new.org_id is not null then
    select exists (select 1 from public.automation_rules p where p.org_id is null and p.key = new.key and p.locked)
      into v_locked_platform;
    if v_locked_platform and (not new.enabled or new.dry_run) then
      raise exception 'La règle % est verrouillée par la plateforme', new.key; end if;
  end if;
  return new;
end $$;
create trigger automation_rules_guard before insert or update or delete on public.automation_rules
  for each row execute function private.automation_rules_guard();
create trigger audit_automation_rules after insert or update or delete on public.automation_rules
  for each row execute function private.audit_change();

-- Règles livrées par la plateforme (modèles ; chaque organisation en reçoit une copie à l'activation).
insert into public.automation_rules (org_id, key, name, enabled, dry_run, autonomy, locked, trigger_kind, definition) values
 (null, 'incident-grouped', 'Incident regroupé', true, false, 0, false, 'alert.opened', $j$
  {"all":[{"field":"alert.severity","op":"in","value":["major","critical"]},
          {"field":"alert.attachment","op":"eq","value":"attached"},
          {"field":"conversations.same_category_15min","op":"gte","value":2}],
   "action":{"kind":"group_into_incident","params":{"notify_users":"template","notify_oncall":"yes"}},
   "limits":{"maxRunsPerHour":20,"maxItemsPerRun":100,"cooldownMinutes":5}}$j$),
 (null, 'incident-resolved', 'Fin d''incident', true, false, 1, false, 'alert.resolved', $j$
  {"all":[{"field":"alert.incident","op":"exists"}],
   "action":{"kind":"propose_close_children","params":{"notify_users":"template"}},
   "limits":{"maxRunsPerHour":20,"maxItemsPerRun":200,"cooldownMinutes":0}}$j$),
 (null, 'suspicious-reset', 'Demande de réinitialisation suspecte', true, false, 0, true, 'conversation.message', $j$
  {"all":[{"field":"risk.suspicious","op":"eq","value":true}],
   "action":{"kind":"create_security_ticket","params":{"priority":"high","notify_oncall":"yes"}},
   "limits":{"maxRunsPerHour":200,"maxItemsPerRun":1,"cooldownMinutes":0}}$j$),
 (null, 'source-silent', 'Source d''alertes muette', true, false, 0, false, 'alert.source_silent', $j$
  {"all":[],
   "action":{"kind":"notify_oncall","params":{"create_alert":"yes"}},
   "limits":{"maxRunsPerHour":10,"maxItemsPerRun":10,"cooldownMinutes":60}}$j$),
 (null, 'm365-outage', 'Panne Microsoft 365 reconnue', false, false, 0, false, 'm365.service_degraded', $j$
  {"all":[{"field":"conversations.category_in_15min","op":"gte","value":2}],
   "action":{"kind":"notify_users","params":{"template":"m365-outage"}},
   "limits":{"maxRunsPerHour":10,"maxItemsPerRun":200,"cooldownMinutes":30}}$j$);

create table public.automation_runs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  rule_key text not null,
  rule_version int not null,
  trigger_ref text,                                -- identifiant de l'alerte, de la conversation...
  decision text not null check (decision in ('executed', 'skipped', 'dry_run', 'rate_limited', 'error')),
  detail jsonb not null default '{}'::jsonb,
  action_request_id uuid references public.action_requests (id),
  at timestamptz not null default now()
);
create index automation_runs_org_at_idx on public.automation_runs (org_id, at desc);
create index automation_runs_rule_at_idx on public.automation_runs (org_id, rule_key, at desc);
create function private.immutable_row() returns trigger
language plpgsql set search_path = '' as
$$ begin raise exception '% est en insertion seule (opération % refusée)', tg_table_name, tg_op using errcode = '42501'; end $$;
create trigger automation_runs_immutable before update or delete on public.automation_runs
  for each row execute function private.immutable_row();

-- ---------------------------------------------------------------------------------------------------------------
-- Notation des réponses par les techniciens (mode ombre)
-- ---------------------------------------------------------------------------------------------------------------
create table public.response_ratings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,      -- le message peut être purgé, la note reste
  category text not null check (category = any (private.categories())),
  -- answer : la réponse préparée ; escalation : « l'IA a passé la main à bon escient » ; idk : « je ne sais pas » à propos.
  kind text not null default 'answer' check (kind in ('answer', 'escalation', 'idk')),
  rating text not null check (rating in ('correct', 'partial', 'wrong', 'dangerous')),
  reason text check (reason in ('missing_source', 'wrong_version', 'out_of_scope', 'overconfident', 'should_have_escalated', 'other')),
  rated_by uuid not null references auth.users (id),
  rated_at timestamptz not null default now(),
  unique (message_id, rated_by, kind)
);
create index response_ratings_org_cat_idx on public.response_ratings (org_id, category, rated_at desc);

create function private.response_ratings_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare m public.messages%rowtype; c public.conversations%rowtype;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- Insertion seule. Seule exception : la purge d'un message détache la note (message_id passe à null), sans autre changement.
    if tg_op = 'UPDATE' and new.message_id is null and old.message_id is not null
       and (new.id, new.org_id, new.category, new.kind, new.rating, new.reason, new.rated_by, new.rated_at)
         is not distinct from (old.id, old.org_id, old.category, old.kind, old.rating, old.reason, old.rated_by, old.rated_at) then
      return new; end if;
    raise exception 'response_ratings est en insertion seule (notes non modifiables, M36)' using errcode = '42501';
  end if;
  select * into m from public.messages where id = new.message_id;
  if m.id is null or m.org_id <> new.org_id then raise exception 'Le message noté doit appartenir à l''organisation'; end if;
  if m.role <> 'assistant' then raise exception 'On ne note que les réponses de l''IA'; end if;
  select * into c from public.conversations where id = m.conversation_id;
  new.category := coalesce(c.category, 'other');          -- la catégorie vient de la conversation, pas du notateur
  if not (private._member(new.rated_by, new.org_id, array['org_technician'])
          or private._partner_can_access(new.rated_by, new.org_id, 'partner_technician')) then
    raise exception 'Seul un technicien habilité de l''organisation note les réponses'; end if;
  return new;
end $$;
create trigger response_ratings_guard before insert or update or delete on public.response_ratings
  for each row execute function private.response_ratings_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Portes de catégorie : shadow (rien ne part à l'utilisateur), direct, advice_only (après retour arrière)
-- ---------------------------------------------------------------------------------------------------------------
create table public.category_gates (
  org_id uuid not null references public.organizations (id) on delete cascade,
  category text not null check (category = any (private.categories())),
  state text not null default 'shadow' check (state in ('shadow', 'direct', 'advice_only')),
  changed_by uuid references auth.users (id),            -- null : décision automatique (retour arrière)
  changed_at timestamptz not null default now(),
  reason text check (char_length(reason) <= 500),
  override_insufficient_data boolean not null default false,   -- ouverture assumée avec moins de 300 notes
  primary key (org_id, category)
);

-- Statistiques calculées sur les NOTES BRUTES (jamais fournies par le modèle ni par le client). Fenêtre : 90 jours.
create function private.category_stats(p_org uuid, p_category text, p_days int default 90) returns jsonb
language sql stable security definer set search_path = '' as
$$
  with r as (
    select * from public.response_ratings
    where org_id = p_org and category = p_category and rated_at >= now() - p_days * interval '1 day')
  select jsonb_build_object(
    'answers', (select count(*) from r where kind = 'answer'),
    'correct', (select count(*) from r where kind = 'answer' and rating = 'correct'),
    'partial', (select count(*) from r where kind = 'answer' and rating = 'partial'),
    'wrong', (select count(*) from r where kind = 'answer' and rating = 'wrong'),
    'wrong_overconfident', (select count(*) from r where kind = 'answer' and rating = 'wrong' and reason = 'overconfident'),
    'dangerous', (select count(*) from r where rating = 'dangerous'),
    'escalations', (select count(*) from r where kind = 'escalation'),
    'escalations_justified', (select count(*) from r where kind = 'escalation' and rating = 'correct'),
    'missed_escalations', (select count(*) from r where kind = 'answer' and reason = 'should_have_escalated'),
    'idk', (select count(*) from r where kind = 'idk'),
    'idk_appropriate', (select count(*) from r where kind = 'idk' and rating = 'correct'))
$$;

-- Les barres de passage de docs/11 § 2. Jamais « atteintes » avec moins de 300 réponses notées.
create function private.category_bars_met(p_org uuid, p_category text) returns boolean
language plpgsql stable security definer set search_path = '' as
$$
declare s jsonb := private.category_stats(p_org, p_category); n int := (s ->> 'answers')::int;
begin
  if n < 300 then return false; end if;
  if (s ->> 'dangerous')::int > 0 then return false; end if;
  if (s ->> 'correct')::numeric / n < 0.80 then return false; end if;
  if (s ->> 'wrong_overconfident')::numeric / n > 0.02 then return false; end if;
  if (s ->> 'missed_escalations')::numeric / n > 0.03 then return false; end if;
  if (s ->> 'escalations')::int > 0 and (s ->> 'escalations_justified')::numeric / (s ->> 'escalations')::int < 0.90 then return false; end if;
  if (s ->> 'idk')::int > 0 and (s ->> 'idk_appropriate')::numeric / (s ->> 'idk')::int < 0.95 then return false; end if;
  return true;
end $$;

create function private.category_gates_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    new.changed_at := now();
    if new.state = 'direct' then
      -- L'ouverture d'une catégorie est une décision HUMAINE de l'administrateur du client (docs/spec-mvp.md § 10.2).
      if new.changed_by is null or not private._member(new.changed_by, new.org_id, array['org_admin']) then
        raise exception 'L''ouverture d''une catégorie est décidée par l''administrateur du client'; end if;
      if not exists (select 1 from public.organizations o where o.id = new.org_id and o.activated_at is not null and o.frozen_at is null) then
        raise exception 'Client non activé ou gelé : aucune réponse directe'; end if;
      if not private.category_bars_met(new.org_id, new.category) then
        -- Données insuffisantes ou barre non atteinte : possible seulement par une décision assumée, motivée et auditée.
        if not new.override_insufficient_data or new.reason is null or char_length(new.reason) < 20 then
          raise exception 'Barres de passage non atteintes (ou moins de 300 réponses notées) : ouverture refusée sans décision motivée (20 caractères minimum)'; end if;
      else
        new.override_insufficient_data := false;
      end if;
    else
      if new.reason is null or new.reason is not distinct from old.reason then
        raise exception 'Un NOUVEAU motif est obligatoire pour fermer ou réduire une catégorie'; end if;
      new.override_insufficient_data := false;
    end if;
  end if;
  return new;
end $$;
create trigger category_gates_guard before update on public.category_gates
  for each row execute function private.category_gates_guard();
create trigger audit_category_gates after insert or update or delete on public.category_gates
  for each row execute function private.audit_change();

-- Chaque client reçoit ses 11 portes, FERMÉES (shadow) : rien de l'IA ne part à l'utilisateur sans décision.
create function private.create_category_gates() returns trigger
language plpgsql security definer set search_path = '' as
$$
begin
  insert into public.category_gates (org_id, category) select new.id, c from unnest(private.categories()) c;
  return new;
end $$;
create trigger organizations_create_gates after insert on public.organizations
  for each row when (new.type = 'client') execute function private.create_category_gates();
insert into public.category_gates (org_id, category)
  select o.id, c from public.organizations o, unnest(private.categories()) c where o.type = 'client'
  on conflict do nothing;

-- SEC-20 : une note « Dangereuse » remet IMMÉDIATEMENT la catégorie en conseil seul.
create function private.rollback_on_dangerous() returns trigger
language plpgsql security definer set search_path = '' as
$$
begin
  if new.rating = 'dangerous' then
    update public.category_gates set state = 'advice_only', changed_by = null,
           reason = 'Retour arrière automatique : une réponse a été notée dangereuse'
     where org_id = new.org_id and category = new.category and state = 'direct';
  end if;
  return new;
end $$;
create trigger response_ratings_rollback after insert on public.response_ratings
  for each row execute function private.rollback_on_dangerous();

-- SEC-19 : une réponse de l'IA ne devient visible du salarié que si la catégorie est ouverte. La BASE l'impose,
-- pas seulement l'interface (menace M36).
create function private.messages_shadow_gate() returns trigger
language plpgsql set search_path = '' as
$$
declare v_cat text; v_state text;
begin
  if new.role = 'assistant' and new.visibility = 'public' then
    if private.org_is_frozen(new.org_id) then
      raise exception 'Organisation gelée : aucune réponse de l''IA (SEC-28)'; end if;
    select coalesce(c.category, 'other') into v_cat from public.conversations c where c.id = new.conversation_id;
    select g.state into v_state from public.category_gates g where g.org_id = new.org_id and g.category = v_cat;
    if v_state is distinct from 'direct' then
      raise exception 'Mode ombre : la catégorie % n''est pas ouverte, la réponse de l''IA reste visible des seuls techniciens (SEC-19)', v_cat; end if;
  end if;
  return new;
end $$;
create trigger messages_shadow_gate before insert on public.messages
  for each row execute function private.messages_shadow_gate();

-- ---------------------------------------------------------------------------------------------------------------
-- Droits et RLS
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['automation_rules', 'automation_runs', 'response_ratings', 'category_gates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Les techniciens habilités notent directement (rapidité : moins de 5 secondes), mais ne peuvent insérer que leurs propres notes.
grant insert (org_id, message_id, kind, rating, reason, rated_by) on public.response_ratings to authenticated;
create policy response_ratings_insert on public.response_ratings for insert to authenticated with check (
  rated_by = (select auth.uid())
  and (private.is_member_of(org_id, array['org_technician']) or private.partner_can_access(org_id, 'partner_technician')));

create policy automation_rules_read on public.automation_rules for select to authenticated using (
  org_id is null or private.can_read_org_config(org_id));
create policy automation_runs_read on public.automation_runs for select to authenticated using (private.can_read_org_config(org_id));
create policy response_ratings_read on public.response_ratings for select to authenticated using (
  private.can_read_org_config(org_id) or private.partner_can_access(org_id, 'partner_admin'));
create policy category_gates_read on public.category_gates for select to authenticated using (private.can_read_org_config(org_id));
