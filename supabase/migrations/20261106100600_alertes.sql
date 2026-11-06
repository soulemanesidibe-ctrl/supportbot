-- Relève IA : alertes de supervision, au format normalisé (docs/07 § 3 bis, spec § 11).
-- Le contenu d'une alerte est une DONNÉE : jamais une instruction (menaces M01, M16, M35).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100500_releve.sql.

create table public.alert_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  type text not null check (type in ('webhook', 'api_poll')),
  connector_id uuid references public.connectors (id) on delete set null,
  vault_secret_id uuid,                                   -- secret HMAC du webhook, dans Vault
  -- Correspondance des gravités propres à l'outil vers les quatre gravités normalisées.
  severity_map jsonb not null default '{}'::jsonb,
  -- Correspondance des champs (chemins simples) : configuration, jamais du code.
  field_mapping jsonb not null default '{}'::jsonb,
  expected_interval_seconds int check (expected_interval_seconds is null or expected_interval_seconds >= 60),
  last_seen_at timestamptz,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create trigger audit_alert_sources after insert or update or delete on public.alert_sources
  for each row execute function private.audit_change();

create table public.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_id uuid references public.alert_sources (id) on delete cascade,
  asset_pattern text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (char_length(reason) between 3 and 300),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '30 days')
);
create index maintenance_windows_org_time_idx on public.maintenance_windows (org_id, starts_at, ends_at);
create trigger audit_maintenance_windows after insert or update or delete on public.maintenance_windows
  for each row execute function private.audit_change();

create table public.asset_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  asset_pattern text not null check (char_length(asset_pattern) between 1 and 200),
  category text not null check (category = any (private.categories())),
  site text,
  unique (org_id, asset_pattern)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  source_id uuid not null references public.alert_sources (id) on delete cascade,
  dedup_key text not null check (char_length(dedup_key) between 1 and 300),
  asset_kind text not null default 'unknown' check (asset_kind in ('host', 'service', 'unknown')),
  asset_name text not null check (char_length(asset_name) <= 200),
  site text,
  severity text not null check (severity in ('information', 'warning', 'major', 'critical')),
  state text not null default 'open' check (state in ('open', 'acknowledged', 'resolved')),
  summary text not null check (char_length(summary) <= 500),     -- texte libre : DONNÉE, tronquée
  occurred_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  count int not null default 1 check (count >= 1),
  origin_url text,
  raw jsonb not null default '{}'::jsonb check (pg_column_size(raw) <= 65536),   -- charge brute : audit seulement
  -- « Non rattachée » plutôt que jetée : visible, jamais perdue.
  attachment_status text not null default 'unattached' check (attachment_status in ('attached', 'unattached')),
  category text check (category = any (private.categories())),
  incident_id uuid references public.incidents (id) on delete set null,
  synthetic boolean not null default false,                       -- alerte produite par Relève (ex. silence anormal)
  resolved_at timestamptz,
  check ((state = 'resolved') = (resolved_at is not null))
);
-- Une seule alerte ouverte par source et par clé : la déduplication est une contrainte de la base.
create unique index alerts_open_dedup on public.alerts (source_id, dedup_key) where state in ('open', 'acknowledged');
create index alerts_org_state_idx on public.alerts (org_id, state, last_seen_at desc);
create index alerts_incident_idx on public.alerts (incident_id) where incident_id is not null;

create function private.alerts_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if not exists (select 1 from public.alert_sources s where s.id = new.source_id and s.org_id = new.org_id) then
    raise exception 'L''alerte doit appartenir à l''organisation de sa source'; end if;
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.source_id <> old.source_id or new.dedup_key <> old.dedup_key) then
    raise exception 'org_id, source_id et dedup_key sont immuables'; end if;
  return new;
end $$;
create trigger alerts_guard before insert or update on public.alerts
  for each row execute function private.alerts_guard();

create table public.alert_events (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.alerts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('received', 'deduplicated', 'severity_changed', 'state_changed', 'grouped',
                                     'suppressed_maintenance', 'unattached', 'silence_detected')),
  at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);
create index alert_events_alert_idx on public.alert_events (alert_id, at);

-- Fenêtre de maintenance : l'alerte est conservée, mais ni incident ni message aux utilisateurs.
create function private.in_maintenance(p_org uuid, p_source uuid, p_asset text, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.maintenance_windows w
                 where w.org_id = p_org and w.starts_at <= p_at and w.ends_at > p_at
                   and (w.source_id is null or w.source_id = p_source)
                   and (w.asset_pattern is null or p_asset like replace(w.asset_pattern, '*', '%')))
$$;

-- Sources muettes : sans signe de vie depuis 3 fois l'intervalle attendu (une supervision muette est un incident).
create function private.silent_sources(p_now timestamptz default now()) returns table (source_id uuid, org_id uuid, silent_since timestamptz)
language sql stable security definer set search_path = '' as
$$
  select s.id, s.org_id, coalesce(s.last_seen_at, s.created_at)
  from public.alert_sources s
  where s.status = 'active' and s.expected_interval_seconds is not null
    and coalesce(s.last_seen_at, s.created_at) < p_now - (s.expected_interval_seconds * 3) * interval '1 second'
$$;

-- Secret HMAC d'une source : même principe que les connecteurs, réservé au service.
create function private.store_alert_source_secret(p_source uuid, p_secret text) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare v_id uuid;
begin
  if p_secret is null or length(p_secret) < 32 then raise exception 'secret de webhook trop court (32 caractères minimum)'; end if;
  v_id := vault.create_secret(p_secret, 'alert-source:' || p_source::text || ':' || extract(epoch from clock_timestamp())::bigint::text);
  update public.alert_sources set vault_secret_id = v_id where id = p_source;
  return v_id;
end $$;
create function private.read_alert_source_secret(p_source uuid) returns text
language sql stable security definer set search_path = '' as
$$
  select s.decrypted_secret from public.alert_sources a
  join vault.decrypted_secrets s on s.id = a.vault_secret_id where a.id = p_source
$$;
revoke all on function private.store_alert_source_secret(uuid, text), private.read_alert_source_secret(uuid) from public, anon, authenticated;
grant execute on function private.store_alert_source_secret(uuid, text), private.read_alert_source_secret(uuid) to service_role;

do $$
declare t text;
begin
  foreach t in array array['alert_sources', 'maintenance_windows', 'asset_links', 'alerts', 'alert_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke select on public.alert_sources from authenticated;
grant select (id, org_id, name, type, connector_id, severity_map, field_mapping, expected_interval_seconds, last_seen_at, status, created_at)
  on public.alert_sources to authenticated;

create policy alert_sources_read on public.alert_sources for select to authenticated using (private.can_read_org_config(org_id));
create policy maintenance_windows_read on public.maintenance_windows for select to authenticated using (private.can_read_org_config(org_id));
create policy asset_links_read on public.asset_links for select to authenticated using (private.can_read_org_config(org_id));
create policy alerts_read on public.alerts for select to authenticated using (private.can_read_support_data(org_id));
create policy alert_events_read on public.alert_events for select to authenticated using (private.can_read_support_data(org_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alerts;
  end if;
end $$;
