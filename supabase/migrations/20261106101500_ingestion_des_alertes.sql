-- Migration 15 : ingestion des alertes, regroupement en incident, notifications de l'astreinte, plafonds des règles (jalon J4).
--
-- Principe : tout ce qui décide de l'ÉTAT (déduplication, confirmation, maintenance, rattachement, regroupement, plafonds) vit ici,
-- dans des fonctions réservées au service, atomiques et testées en SQL. Le code des fonctions Edge vérifie la signature, normalise,
-- masque les secrets, et appelle ces fonctions ; il ne recompose jamais ces règles lui-même.
-- Le contenu d'une alerte reste une DONNÉE : il n'est jamais montré aux salariés (gabarits fixes) ni exécuté (menaces M01, M16, M35).
--
-- Cette migration est à appliquer par le fondateur (éditeur SQL de Supabase), après la 14.

-- ---------------------------------------------------------------------------------------------------------------
-- Colonnes et constantes
-- ---------------------------------------------------------------------------------------------------------------
-- Anti-battement (spec § 11.3) : une alerte n'est « confirmée » (et ne peut déclencher une règle) qu'après 2 événements ou 3 minutes.
alter table public.alerts add column confirmed_at timestamptz;
create index alerts_pending_confirm_idx on public.alerts (first_seen_at) where confirmed_at is null and state in ('open', 'acknowledged');
create index alerts_awaiting_group_idx on public.alerts (org_id, confirmed_at) where incident_id is null and state in ('open', 'acknowledged');

-- Délai entre deux exécutions d'une règle, par périmètre (catégorie, source...) et non pour toute l'organisation.
alter table public.automation_runs add column scope text check (scope is null or char_length(scope) <= 120);
create index automation_runs_ref_idx on public.automation_runs (org_id, rule_key, trigger_ref);

create function private.alert_confirm_delay() returns interval language sql immutable set search_path = '' as $$ select interval '3 minutes' $$;
create function private.alert_confirm_events() returns int language sql immutable set search_path = '' as $$ select 2 $$;

-- Un motif d'actif n'a qu'un joker, « * ». Les caractères « % » et « _ » d'un nom ou d'un motif restent des caractères ordinaires.
create function private.asset_matches(p_asset text, p_pattern text) returns boolean
language sql immutable set search_path = '' as
$$ select p_asset like replace(replace(replace(replace(p_pattern, '\', '\\'), '%', '\%'), '_', '\_'), '*', '%') escape '\' $$;

create or replace function private.in_maintenance(p_org uuid, p_source uuid, p_asset text, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.maintenance_windows w
                 where w.org_id = p_org and w.starts_at <= p_at and w.ends_at > p_at
                   and (w.source_id is null or w.source_id = p_source)
                   and (w.asset_pattern is null or private.asset_matches(p_asset, w.asset_pattern)))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Conversations rattachées à un incident (pour prévenir chaque salarié une fois à l'ouverture, une fois au rétablissement)
-- ---------------------------------------------------------------------------------------------------------------
create table public.incident_conversations (
  incident_id uuid not null references public.incidents (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  attached_at timestamptz not null default now(),
  opened_notice_at timestamptz,
  resolved_notice_at timestamptz,
  primary key (incident_id, conversation_id)
);
create index incident_conversations_conv_idx on public.incident_conversations (conversation_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Notifications internes (console des techniciens, J5). Envoi par e-mail ou Teams : backlog B14.
-- Charge utile = champs typés composés par le code (gravité, catégorie, identifiants), jamais le texte d'une alerte.
-- ---------------------------------------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('incident_opened', 'incident_resolved', 'source_silent')),
  subject_type text not null check (subject_type in ('incident', 'alert')),
  subject_id uuid not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2048),
  fallback boolean not null default false,       -- personne d'astreinte : prévenu au titre des techniciens de l'organisation
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_user_id, kind, subject_id)   -- une seule fois par personne et par événement
);
create index notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc) where read_at is null;

-- Qui prévenir : la personne d'astreinte en ce moment ; à défaut, les techniciens qui ont accès à l'organisation. Chaque candidat
-- est revérifié par resolve_access (une astreinte inscrite pour un technicien qui n'a plus accès ne reçoit rien).
create function private.oncall_recipients(p_org uuid, p_at timestamptz default now()) returns table (user_id uuid, fallback boolean)
language plpgsql stable security definer set search_path = '' as
$$
begin
  return query
    select distinct s.technician_user_id, false from public.relief_schedules s
     where s.org_id = p_org and s.kind = 'on_call' and s.starts_at <= p_at and s.ends_at > p_at
       and exists (select 1 from public.resolve_access(s.technician_user_id, p_org) r
                    where r.org_role in ('partner_technician', 'org_technician') and not r.read_only);
  if found then return; end if;
  return query
    select distinct c.uid, true from (
      select m.user_id as uid from public.memberships m where m.org_id = p_org and m.role = 'org_technician'
      union
      select pa.user_id from public.partner_assignments pa join public.partner_relationships pr on pr.id = pa.relationship_id
       where pr.client_org_id = p_org and pa.revoked_at is null and pa.starts_at <= p_at and pa.ends_at > p_at) c
     where exists (select 1 from public.resolve_access(c.uid, p_org) r
                    where r.org_role in ('partner_technician', 'org_technician') and not r.read_only);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Réception d'une alerte (SEC-17) : rejeu, déduplication, rattachement, maintenance, confirmation. UNE transaction : si quoi que ce
-- soit échoue, la livraison n'est pas marquée comme reçue et l'outil de supervision peut la renvoyer.
-- ---------------------------------------------------------------------------------------------------------------
create function public.alert_ingest(p_source uuid, p_digest text, p_alert jsonb) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  s public.alert_sources%rowtype;
  a public.alerts%rowtype;
  v_org_state text;
  v_key text := p_alert ->> 'dedup_key';
  v_kind text := coalesce(p_alert ->> 'asset_kind', 'unknown');
  v_asset text := p_alert ->> 'asset_name';
  v_site text := nullif(p_alert ->> 'site', '');
  v_sev text := p_alert ->> 'severity';
  v_state text := p_alert ->> 'state';
  v_summary text := coalesce(p_alert ->> 'summary', '');
  v_url text := nullif(p_alert ->> 'origin_url', '');
  v_raw jsonb := coalesce(p_alert -> 'raw', '{}'::jsonb);
  v_at timestamptz;
  v_cat text;
  v_link_site text;
  v_new boolean := false;
  v_confirmed boolean := false;
  v_incident_resolved boolean := false;
begin
  if jsonb_typeof(p_alert) is distinct from 'object' then raise exception 'Alerte invalide'; end if;
  select * into s from public.alert_sources where id = p_source for update;   -- une source à la fois : déduplication sans course
  if s.id is null or s.status <> 'active' or s.vault_secret_id is null then raise exception 'Source introuvable'; end if;
  select o.state into v_org_state from public.organizations o where o.id = s.org_id;
  if v_org_state is null or v_org_state = 'suspended' then raise exception 'Source introuvable'; end if;

  -- Validation stricte (la fonction Edge valide déjà : défense en profondeur).
  if v_key is null or char_length(v_key) not between 1 and 300 or v_key like 'releve:%'      -- clé réservée aux alertes de Relève
     or v_kind not in ('host', 'service', 'unknown')
     or v_asset is null or char_length(v_asset) not between 1 and 200
     or (v_site is not null and char_length(v_site) > 100)
     or v_sev is null or v_sev not in ('information', 'warning', 'major', 'critical')
     or v_state is null or v_state not in ('open', 'acknowledged', 'resolved')
     or char_length(v_summary) > 500
     or (v_url is not null and (char_length(v_url) > 500 or v_url !~ '^https://[^\s]+$'))
     or jsonb_typeof(v_raw) not in ('object', 'array') then
    raise exception 'Alerte invalide'; end if;
  -- Format ISO 8601 exigé : les mots spéciaux de Postgres (« now », « epoch »...) ne passent pas.
  if coalesce(p_alert ->> 'occurred_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'Alerte invalide'; end if;
  begin
    v_at := (p_alert ->> 'occurred_at')::timestamptz;
  exception when others then
    raise exception 'Alerte invalide';
  end;
  if v_at is null or v_at > now() + interval '5 minutes' or v_at < now() - interval '30 days' then raise exception 'Alerte invalide'; end if;
  if pg_column_size(v_raw) > 60000 then v_raw := '{"tronque": true}'::jsonb; end if;

  -- Rejeu : une livraison (empreinte de sa signature) n'est acceptée qu'une fois.
  if not public.webhook_first_delivery(p_source, p_digest) then return jsonb_build_object('status', 'duplicate'); end if;

  update public.alert_sources set last_seen_at = now() where id = p_source;
  -- La source parle de nouveau : son alerte « silence anormal » se résout d'elle-même.
  with r as (
    update public.alerts set state = 'resolved', resolved_at = now(), last_seen_at = now()
     where source_id = p_source and synthetic and dedup_key = 'releve:silence' and state in ('open', 'acknowledged')
    returning id, org_id)
  insert into public.alert_events (alert_id, org_id, kind, payload)
  select id, org_id, 'state_changed', '{"to": "resolved", "cause": "source_revenue"}'::jsonb from r;

  select * into a from public.alerts where source_id = p_source and dedup_key = v_key and state in ('open', 'acknowledged') for update;

  if v_state = 'resolved' then
    if a.id is null then return jsonb_build_object('status', 'ignored'); end if;   -- rien d'ouvert à résoudre
    update public.alerts set state = 'resolved', resolved_at = now(), last_seen_at = now(), count = count + 1 where id = a.id;
    insert into public.alert_events (alert_id, org_id, kind, payload)
    values (a.id, a.org_id, 'state_changed', jsonb_build_object('from', a.state, 'to', 'resolved'));
    -- L'incident se résout quand sa DERNIÈRE alerte ouverte se résout.
    if a.incident_id is not null and not exists (
         select 1 from public.alerts x where x.incident_id = a.incident_id and x.state in ('open', 'acknowledged')) then
      update public.incidents set state = 'resolved', resolved_at = now() where id = a.incident_id and state <> 'resolved';
      v_incident_resolved := found;
    end if;
    return jsonb_build_object('status', 'resolved', 'alert_id', a.id, 'org_id', a.org_id,
                              'was_confirmed', a.confirmed_at is not null, 'incident_id', a.incident_id,
                              'incident_resolved', v_incident_resolved);
  end if;

  if a.id is not null then
    update public.alerts
       set count = count + 1, last_seen_at = now(), severity = v_sev, state = v_state, summary = v_summary,
           origin_url = coalesce(v_url, origin_url), raw = v_raw
     where id = a.id;
    insert into public.alert_events (alert_id, org_id, kind, payload) values (a.id, a.org_id, 'deduplicated', jsonb_build_object('count', a.count + 1));
    if a.severity <> v_sev then
      insert into public.alert_events (alert_id, org_id, kind, payload)
      values (a.id, a.org_id, 'severity_changed', jsonb_build_object('from', a.severity, 'to', v_sev));
    end if;
    if a.state <> v_state then
      insert into public.alert_events (alert_id, org_id, kind, payload)
      values (a.id, a.org_id, 'state_changed', jsonb_build_object('from', a.state, 'to', v_state));
    end if;
    select * into a from public.alerts where id = a.id;
  else
    -- Rattachement à une catégorie par le motif d'actif le plus précis ; sinon « non rattachée », visible et jamais jetée.
    select l.category, l.site into v_cat, v_link_site from public.asset_links l
     where l.org_id = s.org_id and private.asset_matches(v_asset, l.asset_pattern)
     order by char_length(l.asset_pattern) desc, l.asset_pattern limit 1;
    insert into public.alerts (org_id, source_id, dedup_key, asset_kind, asset_name, site, severity, state, summary, occurred_at,
                               origin_url, raw, attachment_status, category)
    values (s.org_id, p_source, v_key, v_kind, v_asset, coalesce(v_site, v_link_site), v_sev, v_state, v_summary, v_at,
            v_url, v_raw, case when v_cat is null then 'unattached' else 'attached' end, v_cat)
    returning * into a;
    v_new := true;
    insert into public.alert_events (alert_id, org_id, kind) values (a.id, a.org_id, 'received');
    if v_cat is null then insert into public.alert_events (alert_id, org_id, kind) values (a.id, a.org_id, 'unattached'); end if;
  end if;

  if private.in_maintenance(a.org_id, p_source, a.asset_name) then
    -- Maintenance : l'alerte est conservée, mais elle n'est pas confirmée (ni incident ni message) tant que la fenêtre dure.
    if a.confirmed_at is null and not exists (select 1 from public.alert_events e where e.alert_id = a.id and e.kind = 'suppressed_maintenance') then
      insert into public.alert_events (alert_id, org_id, kind) values (a.id, a.org_id, 'suppressed_maintenance');
    end if;
  elsif a.confirmed_at is null and (a.count >= private.alert_confirm_events() or a.first_seen_at <= now() - private.alert_confirm_delay()) then
    update public.alerts set confirmed_at = now() where id = a.id;
    v_confirmed := true;
  end if;

  return jsonb_build_object('status', case when v_confirmed then 'confirmed' when v_new then 'received' else 'updated' end,
                            'alert_id', a.id, 'org_id', a.org_id);
end $$;

-- Confirmation à l'échéance (tâche planifiée, chaque minute) : alertes ouvertes depuis 3 minutes, hors maintenance.
create function public.alerts_confirm_due(p_limit int default 200) returns table (alert_id uuid, org_id uuid)
language plpgsql security definer set search_path = '' as
$$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id from public.alerts a join public.organizations o on o.id = a.org_id
     where a.confirmed_at is null and a.state in ('open', 'acknowledged') and not a.synthetic
       and a.first_seen_at <= now() - private.alert_confirm_delay() and o.state <> 'suspended'
       and not private.in_maintenance(a.org_id, a.source_id, a.asset_name)
     order by a.first_seen_at
     limit greatest(1, least(coalesce(p_limit, 200), 500))
     for update of a skip locked)
  update public.alerts x set confirmed_at = now() from due where x.id = due.id
  returning x.id, x.org_id;
end $$;

-- Alertes confirmées, ouvertes, rattachées et sans incident depuis moins d'une heure : les règles « alerte ouverte » sont
-- réévaluées (les demandes des salariés arrivent souvent APRÈS l'alerte).
create function public.alerts_awaiting_grouping(p_limit int default 200) returns table (alert_id uuid, org_id uuid)
language sql stable security definer set search_path = '' as
$$
  select a.id, a.org_id from public.alerts a join public.organizations o on o.id = a.org_id
   where a.incident_id is null and a.state in ('open', 'acknowledged') and a.attachment_status = 'attached' and not a.synthetic
     and a.confirmed_at is not null and a.confirmed_at > now() - interval '1 hour' and o.state <> 'suspended'
   order by a.confirmed_at
   limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

-- Incidents résolus depuis moins d'une heure, avec l'alerte qui les a résolus : déclencheur « alerte résolue ».
create function public.incidents_recently_resolved(p_limit int default 200) returns table (incident_id uuid, alert_id uuid, org_id uuid)
language sql stable security definer set search_path = '' as
$$
  select i.id, (select a.id from public.alerts a where a.incident_id = i.id order by a.resolved_at desc nulls last limit 1), i.org_id
    from public.incidents i join public.organizations o on o.id = i.org_id
   where i.state = 'resolved' and i.resolved_at > now() - interval '1 hour' and o.state <> 'suspended'
   order by i.resolved_at
   limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

-- Suivi des incidents OUVERTS (chaque minute) : les demandes arrivées après l'ouverture sont rattachées et leurs auteurs prévenus,
-- par la même fonction idempotente (incident_group) appelée sur une alerte ouverte de l'incident. Hors organisations gelées.
create function public.incidents_open_followup(p_limit int default 100) returns table (incident_id uuid, alert_id uuid, org_id uuid)
language sql stable security definer set search_path = '' as
$$
  select i.id,
         (select a.id from public.alerts a where a.incident_id = i.id and a.state in ('open', 'acknowledged') and a.confirmed_at is not null
           order by a.confirmed_at limit 1),
         i.org_id
    from public.incidents i join public.organizations o on o.id = i.org_id
   where i.state in ('open', 'mitigated') and i.opened_at > now() - interval '24 hours'
     and o.state <> 'suspended' and o.frozen_at is null
     and exists (select 1 from public.alerts a where a.incident_id = i.id and a.state in ('open', 'acknowledged') and a.confirmed_at is not null)
   order by i.opened_at
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

-- Sources muettes (spec § 11.3) : une alerte « silence anormal », majeure, produite par Relève, une seule tant qu'elle est ouverte.
create function public.alerts_record_silence(p_limit int default 100) returns table (alert_id uuid, org_id uuid, source_id uuid)
language plpgsql security definer set search_path = '' as
$$
#variable_conflict use_column
declare
  r record;
  v_id uuid;
  v_n int := 0;
begin
  for r in
    select ss.source_id, ss.org_id, ss.silent_since, s.name
      from private.silent_sources(now()) ss
      join public.alert_sources s on s.id = ss.source_id
      join public.organizations o on o.id = ss.org_id
     where o.state <> 'suspended'
     order by ss.silent_since
  loop
    exit when v_n >= greatest(1, least(coalesce(p_limit, 100), 500));
    v_id := null;
    insert into public.alerts (org_id, source_id, dedup_key, asset_kind, asset_name, severity, state, summary, occurred_at,
                               synthetic, attachment_status, confirmed_at)
    values (r.org_id, r.source_id, 'releve:silence', 'service', r.name, 'major', 'open',
            'Aucun signe de vie de cette source depuis le ' || to_char(r.silent_since at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' (UTC).',
            now(), true, 'unattached', now())
    on conflict (source_id, dedup_key) where state in ('open', 'acknowledged') do nothing
    returning id into v_id;
    if v_id is not null then
      insert into public.alert_events (alert_id, org_id, kind, payload)
      values (v_id, r.org_id, 'silence_detected', jsonb_build_object('since', r.silent_since));
      v_n := v_n + 1;
      alert_id := v_id; org_id := r.org_id; source_id := r.source_id;
      return next;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Contexte TYPÉ et FIXE des règles « alerte » (spec § 12) : les conditions ne portent que sur ces champs.
-- ---------------------------------------------------------------------------------------------------------------
create function public.automation_alert_context(p_org uuid, p_alert uuid) returns jsonb
language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object(
    'alert.severity', a.severity,
    'alert.attachment', a.attachment_status,
    'alert.category', a.category,
    'alert.state', a.state,
    'alert.synthetic', a.synthetic,
    'alert.confirmed', a.confirmed_at is not null,
    'alert.incident', a.incident_id,
    'incident.resolved', coalesce(i.state = 'resolved', false),
    'conversations.same_category_15min',
      (select count(*) from public.conversations c
        where c.org_id = p_org and a.category is not null and c.category = a.category and c.created_at >= now() - interval '15 minutes'))
  from public.alerts a left join public.incidents i on i.id = a.incident_id
  where a.id = p_alert and a.org_id = p_org
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Plafonds d'une règle (menace M21), appliqués AVANT tout effet, de façon atomique. Renvoie la décision et l'inscrit au registre.
--   already      : cette règle a déjà été exécutée (ou simulée) pour ce déclencheur : rien ne se répète ;
--   rate_limited : plafond horaire atteint, ou délai minimal pour ce périmètre non écoulé (inscrit une fois par déclencheur) ;
--   dry_run      : simulation, aucun effet ; executed : le code peut agir.
-- La règle est relue ICI (copie de l'organisation, sinon modèle de la plateforme) : l'appelant ne fournit pas les plafonds.
-- ---------------------------------------------------------------------------------------------------------------
create function public.automation_claim(p_org uuid, p_rule_key text, p_trigger_ref text, p_scope text, p_detail jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  r public.automation_rules%rowtype;
  v_limits jsonb;
  v_runs int;
  v_last timestamptz;
  v_decision text;
  v_id bigint;
begin
  if p_trigger_ref is null or char_length(p_trigger_ref) not between 1 and 120 then raise exception 'Déclencheur invalide'; end if;
  select * into r from public.automation_rules
   where key = p_rule_key and (org_id = p_org or org_id is null) order by org_id nulls last limit 1;
  if r.id is null or not r.enabled then return jsonb_build_object('decision', 'disabled'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '|' || p_rule_key, 0));
  if exists (select 1 from public.automation_runs x where x.org_id = p_org and x.rule_key = p_rule_key and x.trigger_ref = p_trigger_ref
                and x.decision in ('executed', 'dry_run')) then
    return jsonb_build_object('decision', 'already');
  end if;
  v_limits := r.definition -> 'limits';
  select count(*) into v_runs from public.automation_runs x
   where x.org_id = p_org and x.rule_key = p_rule_key and x.decision in ('executed', 'dry_run') and x.at > now() - interval '1 hour';
  select max(x.at) into v_last from public.automation_runs x
   where x.org_id = p_org and x.rule_key = p_rule_key and x.decision in ('executed', 'dry_run') and x.scope is not distinct from p_scope;
  if v_runs >= (v_limits ->> 'maxRunsPerHour')::int
     or (v_last is not null and v_last > now() - ((v_limits ->> 'cooldownMinutes')::int * interval '1 minute')) then
    if not exists (select 1 from public.automation_runs x where x.org_id = p_org and x.rule_key = p_rule_key
                      and x.trigger_ref = p_trigger_ref and x.decision = 'rate_limited') then
      insert into public.automation_runs (org_id, rule_key, rule_version, trigger_ref, scope, decision, detail)
      values (p_org, p_rule_key, r.version, p_trigger_ref, p_scope, 'rate_limited',
              jsonb_build_object('runs_last_hour', v_runs, 'cooldown', v_last is not null and v_runs < (v_limits ->> 'maxRunsPerHour')::int));
    end if;
    return jsonb_build_object('decision', 'rate_limited');
  end if;
  v_decision := case when r.dry_run then 'dry_run' else 'executed' end;
  insert into public.automation_runs (org_id, rule_key, rule_version, trigger_ref, scope, decision, detail)
  values (p_org, p_rule_key, r.version, p_trigger_ref, p_scope, v_decision, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  return jsonb_build_object('decision', v_decision, 'run_id', v_id, 'version', r.version,
                            'max_items', (v_limits ->> 'maxItemsPerRun')::int);
end $$;

-- Une évaluation sans effet (conditions non remplies, organisation gelée...) ou une erreur : inscrite UNE fois par règle et déclencheur
-- et par décision, pour que la réévaluation périodique ne remplisse pas le registre.
create function public.automation_note(p_org uuid, p_rule_key text, p_rule_version int, p_trigger_ref text, p_decision text, p_detail jsonb)
returns boolean
language plpgsql security definer set search_path = '' as
$$
begin
  if p_decision not in ('skipped', 'error') then raise exception 'Décision invalide'; end if;
  if exists (select 1 from public.automation_runs x where x.org_id = p_org and x.rule_key = p_rule_key and x.trigger_ref = p_trigger_ref
                and x.decision = p_decision) then
    return false;
  end if;
  insert into public.automation_runs (org_id, rule_key, rule_version, trigger_ref, decision, detail)
  values (p_org, p_rule_key, p_rule_version, p_trigger_ref, p_decision, coalesce(p_detail, '{}'::jsonb));
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Regroupement en incident (règle « incident-grouped »). Idempotent : une alerte déjà regroupée ne crée rien de plus.
-- p_notice : texte FIXE du gabarit (écrit par nous, jamais par le modèle ni tiré de l'alerte) ; null = ne pas prévenir les salariés.
-- ---------------------------------------------------------------------------------------------------------------
create function public.incident_group(p_org uuid, p_alert uuid, p_max int, p_notice text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  a public.alerts%rowtype;
  v_inc uuid;
  v_created boolean := false;
  v_parent uuid;
  v_max int := greatest(1, least(coalesce(p_max, 100), 500));
  v_children jsonb;
  v_notified int := 0;
  v_rank constant text[] := array['information', 'warning', 'major', 'critical'];
begin
  if p_notice is not null and char_length(p_notice) not between 10 and 1000 then raise exception 'Gabarit invalide'; end if;
  select * into a from public.alerts where id = p_alert and org_id = p_org for update;
  if a.id is null then raise exception 'Alerte introuvable'; end if;
  if private.org_is_frozen(p_org) then raise exception 'Organisation gelée (arrêt d''urgence) : aucune automatisation'; end if;
  if a.state = 'resolved' or a.confirmed_at is null or a.category is null then return jsonb_build_object('status', 'not_eligible'); end if;

  v_inc := a.incident_id;
  if v_inc is null then
    select i.id into v_inc from public.incidents i
     where i.org_id = p_org and i.category = a.category and i.state in ('open', 'mitigated')
     order by i.opened_at desc limit 1 for update;
    if v_inc is null then
      insert into public.incidents (org_id, title, category, severity)
      values (p_org, left('Incident ' || a.category || ' : ' || a.asset_name, 200), a.category, a.severity)
      returning id into v_inc;
      insert into public.tickets (org_id, incident_id, title, category, priority, status)
      values (p_org, v_inc, left('Incident ' || a.category || ' : ' || a.asset_name, 300), a.category, 'high', 'open')
      returning id into v_parent;
      update public.incidents set parent_ticket_id = v_parent where id = v_inc;
      v_created := true;
    else
      update public.incidents set severity = v_rank[greatest(array_position(v_rank, severity), array_position(v_rank, a.severity))]
       where id = v_inc;
    end if;
    update public.alerts set incident_id = v_inc where id = a.id;
    insert into public.alert_events (alert_id, org_id, kind, payload) values (a.id, p_org, 'grouped', jsonb_build_object('incident_id', v_inc));
  end if;
  select parent_ticket_id into v_parent from public.incidents where id = v_inc;

  -- Demandes de la même catégorie ouvertes dans les 15 dernières minutes : leurs tickets deviennent enfants de l'incident.
  insert into public.incident_conversations (incident_id, conversation_id, org_id)
  select v_inc, c.id, p_org from public.conversations c
   where c.org_id = p_org and c.category = a.category and c.created_at >= now() - interval '15 minutes'
     and c.state not in ('resolved', 'closed')
   order by c.created_at limit v_max
  on conflict do nothing;

  with t as (
    select tk.id from public.tickets tk join public.incident_conversations ic on ic.conversation_id = tk.conversation_id
     where ic.incident_id = v_inc and tk.org_id = p_org and tk.incident_id is null and tk.status not in ('solved', 'closed')
     order by tk.created_at limit v_max for update of tk),
  u as (update public.tickets x set incident_id = v_inc, parent_id = v_parent from t where x.id = t.id
        returning x.id, x.external_ref)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'external_ref', u.external_ref)), '[]'::jsonb) into v_children from u;

  if p_notice is not null then
    with targets as (
      select ic.conversation_id from public.incident_conversations ic
       where ic.incident_id = v_inc and ic.opened_notice_at is null
       order by ic.attached_at limit v_max for update of ic),
    m as (
      insert into public.messages (conversation_id, org_id, role, visibility, content, prompt_version)
      select conversation_id, p_org, 'system', 'public', p_notice, 'gabarit:incident-ouvert:1' from targets
      returning conversation_id)
    update public.incident_conversations ic set opened_notice_at = now()
      from m where ic.incident_id = v_inc and ic.conversation_id = m.conversation_id;
    get diagnostics v_notified = row_count;
  end if;

  return jsonb_build_object('status', 'grouped', 'incident_id', v_inc, 'created', v_created,
    'parent', (select jsonb_build_object('id', t.id, 'external_ref', t.external_ref) from public.tickets t where t.id = v_parent),
    'new_children', v_children, 'notified', v_notified,
    'severity', (select severity from public.incidents where id = v_inc), 'category', a.category);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Fin d'incident (règle « incident-resolved ») : prévient les salariés déjà prévenus de l'incident, et PROPOSE la clôture des tickets
-- enfants (une demande d'action ticket.update_status par ticket, à valider par un humain). Rien ne se clôt tout seul. Au niveau
-- d'autonomie 0 (défaut du pilote), aucune proposition n'est créée : la base refuse, la raison est rendue.
-- ---------------------------------------------------------------------------------------------------------------
create function public.incident_close_out(p_org uuid, p_incident uuid, p_max int, p_notice text default null, p_propose boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  i public.incidents%rowtype;
  t record;
  v_max int := greatest(1, least(coalesce(p_max, 200), 500));
  v_notified int := 0;
  v_proposed uuid[] := '{}';
  v_id uuid;
  v_refused text;
  v_pending int;
begin
  if p_notice is not null and char_length(p_notice) not between 10 and 1000 then raise exception 'Gabarit invalide'; end if;
  select * into i from public.incidents where id = p_incident and org_id = p_org for update;
  if i.id is null then raise exception 'Incident introuvable'; end if;
  if private.org_is_frozen(p_org) then raise exception 'Organisation gelée (arrêt d''urgence) : aucune automatisation'; end if;
  if i.state <> 'resolved' then return jsonb_build_object('status', 'incident_open'); end if;

  if p_notice is not null then
    with targets as (
      select ic.conversation_id from public.incident_conversations ic
        join public.conversations c on c.id = ic.conversation_id
       where ic.incident_id = i.id and ic.opened_notice_at is not null and ic.resolved_notice_at is null and c.state <> 'closed'
       order by ic.attached_at limit v_max for update of ic),
    m as (
      insert into public.messages (conversation_id, org_id, role, visibility, content, prompt_version)
      select conversation_id, p_org, 'system', 'public', p_notice, 'gabarit:incident-resolu:1' from targets
      returning conversation_id)
    update public.incident_conversations ic set resolved_notice_at = now()
      from m where ic.incident_id = i.id and ic.conversation_id = m.conversation_id;
    get diagnostics v_notified = row_count;
  end if;

  if p_propose then
    for t in
      select tk.id, tk.external_ref, tk.conversation_id from public.tickets tk
       where tk.incident_id = i.id and tk.id is distinct from i.parent_ticket_id and tk.external_ref is not null
         and tk.status not in ('solved', 'closed')
       order by tk.created_at limit v_max
    loop
      begin
        v_id := null;
        insert into public.action_requests (org_id, conversation_id, capability, category, target_ref, params, requested_by_kind)
        values (p_org, t.conversation_id, 'ticket.update_status', 'tickets', t.external_ref, '{"status": "solved"}'::jsonb, 'automation')
        on conflict do nothing
        returning id into v_id;
        if v_id is not null then v_proposed := v_proposed || v_id; end if;
      exception when raise_exception then
        v_refused := sqlerrm;   -- niveau 0, client non activé, organisation gelée : la même raison vaut pour tous les tickets
        exit;
      end;
    end loop;
  end if;

  select count(*) into v_pending from public.tickets tk
   where tk.incident_id = i.id and tk.id is distinct from i.parent_ticket_id and tk.status not in ('solved', 'closed');
  return jsonb_build_object('status', 'closed_out', 'incident_id', i.id, 'notified', v_notified,
                            'proposed', to_jsonb(v_proposed), 'refused', v_refused, 'children_open', v_pending,
                            'category', i.category);
end $$;

-- Prévenir l'astreinte. Idempotent (une notification par personne et par événement). Renvoie le nombre de personnes prévenues.
create function public.notify_oncall(p_org uuid, p_kind text, p_subject_type text, p_subject_id uuid, p_payload jsonb, p_max int default 20)
returns int
language plpgsql security definer set search_path = '' as
$$
declare v_n int;
begin
  if private.org_is_frozen(p_org) then raise exception 'Organisation gelée (arrêt d''urgence) : aucune automatisation'; end if;
  insert into public.notifications (org_id, recipient_user_id, kind, subject_type, subject_id, payload, fallback)
  select p_org, r.user_id, p_kind, p_subject_type, p_subject_id, coalesce(p_payload, '{}'::jsonb), r.fallback
    from private.oncall_recipients(p_org) r
   order by r.user_id limit greatest(1, least(coalesce(p_max, 20), 100))
  on conflict (recipient_user_id, kind, subject_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Règle « fin d'incident » : ne joue que lorsque l'INCIDENT est résolu (sa dernière alerte), pas à chaque alerte résolue.
-- ---------------------------------------------------------------------------------------------------------------
update public.automation_rules
   set version = version + 1,
       definition = jsonb_set(definition, '{all}',
         '[{"field":"alert.incident","op":"exists"},{"field":"incident.resolved","op":"eq","value":true}]'::jsonb)
 where org_id is null and key = 'incident-resolved';

-- ---------------------------------------------------------------------------------------------------------------
-- Droits : fonctions réservées au service ; tables lisibles selon la sécurité par ligne
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function private.asset_matches(text, text), private.oncall_recipients(uuid, timestamptz),
  private.alert_confirm_delay(), private.alert_confirm_events() from public, anon, authenticated;

revoke all on function public.alert_ingest(uuid, text, jsonb), public.alerts_confirm_due(int), public.alerts_awaiting_grouping(int),
  public.incidents_recently_resolved(int), public.incidents_open_followup(int), public.alerts_record_silence(int), public.automation_alert_context(uuid, uuid),
  public.automation_claim(uuid, text, text, text, jsonb), public.automation_note(uuid, text, int, text, text, jsonb),
  public.incident_group(uuid, uuid, int, text), public.incident_close_out(uuid, uuid, int, text, boolean),
  public.notify_oncall(uuid, text, text, uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.alert_ingest(uuid, text, jsonb), public.alerts_confirm_due(int), public.alerts_awaiting_grouping(int),
  public.incidents_recently_resolved(int), public.incidents_open_followup(int), public.alerts_record_silence(int), public.automation_alert_context(uuid, uuid),
  public.automation_claim(uuid, text, text, text, jsonb), public.automation_note(uuid, text, int, text, text, jsonb),
  public.incident_group(uuid, uuid, int, text), public.incident_close_out(uuid, uuid, int, text, boolean),
  public.notify_oncall(uuid, text, text, uuid, jsonb, int) to service_role;

alter table public.incident_conversations enable row level security;
alter table public.notifications enable row level security;
revoke all on public.incident_conversations, public.notifications from public, anon, authenticated;
grant select, insert, update, delete on public.incident_conversations, public.notifications to service_role;
grant select on public.incident_conversations, public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy incident_conversations_read on public.incident_conversations for select to authenticated
  using (private.can_read_support_data(org_id));
-- Une personne ne lit que SES notifications, et seulement tant qu'elle a encore accès aux données de l'organisation.
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()) and private.can_read_support_data(org_id));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_user_id = (select auth.uid()) and private.can_read_support_data(org_id))
  with check (recipient_user_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
