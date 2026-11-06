-- Relève IA : connecteurs, conversations, messages, tickets, incidents.
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100200_acces_et_audit.sql.

-- Catégories de demande de la démo (alignées sur les 20 fiches de connaissance, docs/spec-mvp.md § 10.2).
create function private.categories() returns text[]
language sql immutable parallel safe set search_path = '' as
$$ select array['password', 'mfa', 'vpn', 'printer', 'outlook', 'teams', 'onedrive', 'slow_pc', 'onboarding', 'offboarding', 'other'] $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Connecteurs : la configuration NON SECRÈTE vit ici ; les secrets vivent dans Vault (menace M04).
-- ---------------------------------------------------------------------------------------------------------------
create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('glpi', 'm365', 'demo')),
  name text not null check (char_length(name) between 2 and 80),
  -- Un connecteur qui permet des actions de niveau 1 doit être qualifié « test » ou « production » par l'administrateur
  -- du client (menace M22) : sans qualification, le niveau 1 est refusé.
  environment text check (environment in ('test', 'production')),
  qualified_by uuid references auth.users (id),
  qualified_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'ok', 'error', 'disabled')),
  config jsonb not null default '{}'::jsonb
    check (not (config ?| array['password', 'secret', 'token', 'api_key', 'apikey', 'client_secret', 'access_token', 'refresh_token'])),
  vault_secret_id uuid,                                  -- référence dans Vault ; la valeur n'est JAMAIS lisible via l'API
  tenant_id text,                                        -- Microsoft 365 : identifiant du tenant
  consent_granted_at timestamptz,                        -- Microsoft 365 : consentement de l'administrateur du tenant
  consent_granted_by uuid references auth.users (id),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name),
  check ((environment is null) = (qualified_at is null))
);
create trigger connectors_updated_at before update on public.connectors
  for each row execute function private.set_updated_at();

-- SEC-30 : avant l'activation par l'administrateur du client, l'ESN prépare mais ne connecte pas Microsoft 365.
create function private.connectors_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare v_activated timestamptz;
begin
  select o.activated_at into v_activated from public.organizations o where o.id = new.org_id;
  if new.type = 'm365' and new.status = 'ok' and v_activated is null then
    raise exception 'Microsoft 365 ne peut pas être connecté avant l''activation du client par son administrateur (SEC-30)'; end if;
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.type <> old.type) then
    raise exception 'org_id et type sont immuables'; end if;
  return new;
end $$;
create trigger connectors_guard before insert or update on public.connectors
  for each row execute function private.connectors_guard();
create trigger audit_connectors after insert or update or delete on public.connectors
  for each row execute function private.audit_change();

-- Les secrets passent par ces deux fonctions, réservées au service (Edge Functions) ; jamais le navigateur.
create function private.store_connector_secret(p_connector uuid, p_secret text) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare v_id uuid;
begin
  if p_secret is null or length(p_secret) < 8 then raise exception 'secret vide ou trop court'; end if;
  v_id := vault.create_secret(p_secret, 'connector:' || p_connector::text || ':' || extract(epoch from clock_timestamp())::bigint::text);
  update public.connectors set vault_secret_id = v_id where id = p_connector;
  return v_id;
end $$;

create function private.read_connector_secret(p_connector uuid) returns text
language sql stable security definer set search_path = '' as
$$
  select s.decrypted_secret from public.connectors c
  join vault.decrypted_secrets s on s.id = c.vault_secret_id where c.id = p_connector
$$;
revoke all on function private.store_connector_secret(uuid, text), private.read_connector_secret(uuid) from public, anon, authenticated;
grant execute on function private.store_connector_secret(uuid, text), private.read_connector_secret(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Conversations et messages
-- ---------------------------------------------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requester_user_id uuid not null references auth.users (id),
  directory_user_id uuid references public.directory_users (id) on delete set null,
  channel text not null default 'widget' check (channel in ('widget')),
  state text not null default 'open' check (state in ('open', 'waiting_technician', 'waiting_user', 'resolved', 'closed')),
  category text check (category = any (private.categories())),
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'urgent')),
  relief_active boolean not null default false,
  summary text,
  assigned_to uuid references auth.users (id),
  escalated_at timestamptz,
  resolved_at timestamptz,
  resolution text check (resolution in ('ai_confirmed', 'human', 'abandoned')),   -- « résolue par Relève ET confirmée »
  satisfaction smallint check (satisfaction between 1 and 5),
  purge_after timestamptz not null default (now() + interval '90 days'),         -- conservation (J7 : à valider)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_org_state_idx on public.conversations (org_id, state, updated_at desc);
create index conversations_requester_idx on public.conversations (requester_user_id);
create index conversations_purge_idx on public.conversations (purge_after);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'technician', 'system')),
  -- « public » : le salarié le voit. « technician » : visible des seuls techniciens (mode ombre, notes internes).
  visibility text not null default 'public' check (visibility in ('public', 'technician')),
  content text not null check (char_length(content) <= 20000),     -- TOUJOURS masqué avant insertion (aucun secret)
  redactions int not null default 0,                               -- nombre de secrets masqués dans ce message
  author_id uuid references auth.users (id),
  model text,
  prompt_version text,
  latency_ms int,
  created_at timestamptz not null default now(),
  -- Un message du salarié ou d'un technicien n'est jamais présenté comme venant de l'IA, et inversement.
  check (role <> 'assistant' or author_id is null),
  check (role <> 'technician' or author_id is not null)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_org_idx on public.messages (org_id, created_at desc);

-- La cohérence org_id entre message et conversation est imposée par la base.
create function private.messages_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if not exists (select 1 from public.conversations c where c.id = new.conversation_id and c.org_id = new.org_id) then
    raise exception 'Le message doit appartenir à l''organisation de sa conversation'; end if;
  if tg_op = 'UPDATE' and (new.content <> old.content or new.role <> old.role or new.conversation_id <> old.conversation_id) then
    raise exception 'Un message est immuable'; end if;
  return new;
end $$;
create trigger messages_guard before insert or update on public.messages
  for each row execute function private.messages_guard();

create function private.owns_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.conversations c where c.id = p_conversation and c.requester_user_id = (select auth.uid())) $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Incidents et tickets (miroir local des tickets de l'ITSM : on ne remplace pas GLPI)
-- ---------------------------------------------------------------------------------------------------------------
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  category text check (category = any (private.categories())),
  severity text not null check (severity in ('information', 'warning', 'major', 'critical')),
  state text not null default 'open' check (state in ('open', 'mitigated', 'resolved')),
  parent_ticket_id uuid,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'resolved') = (resolved_at is not null))
);
create index incidents_org_state_idx on public.incidents (org_id, state, opened_at desc);
create trigger incidents_updated_at before update on public.incidents
  for each row execute function private.set_updated_at();

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  connector_id uuid references public.connectors (id) on delete set null,
  external_ref text,
  external_url text,
  parent_id uuid references public.tickets (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  incident_id uuid references public.incidents (id) on delete set null,
  title text not null check (char_length(title) between 3 and 300),
  category text check (category = any (private.categories())),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'new' check (status in ('new', 'open', 'pending', 'solved', 'closed')),
  diagnostic jsonb not null default '{}'::jsonb,        -- ce que Relève a déjà vérifié
  created_by_ai boolean not null default false,
  security boolean not null default false,              -- ticket de sécurité (demande suspecte)
  sla_due_at timestamptz,                               -- lu dans GLPI, affichage seul
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tickets_external_idx on public.tickets (connector_id, external_ref) where external_ref is not null;
create index tickets_org_status_idx on public.tickets (org_id, status, updated_at desc);
create trigger tickets_updated_at before update on public.tickets
  for each row execute function private.set_updated_at();
alter table public.incidents add constraint incidents_parent_ticket_fk
  foreign key (parent_ticket_id) references public.tickets (id) on delete set null;

-- ---------------------------------------------------------------------------------------------------------------
-- Droits et RLS : lecture seule pour l'API
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['connectors', 'conversations', 'messages', 'incidents', 'tickets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- La référence Vault n'est lisible par personne côté API.
revoke select on public.connectors from authenticated;
grant select (id, org_id, type, name, environment, qualified_by, qualified_at, status, config, tenant_id,
              consent_granted_at, consent_granted_by, last_sync_at, last_error, created_at, updated_at)
  on public.connectors to authenticated;

create policy connectors_read on public.connectors for select to authenticated using (private.can_read_org_config(org_id));

create policy conversations_read on public.conversations for select to authenticated using (
  requester_user_id = (select auth.uid()) or private.can_read_support_data(org_id));

-- Le salarié ne lit QUE les messages publics de ses propres conversations (mode ombre : jamais la réponse préparée).
create policy messages_read on public.messages for select to authenticated using (
  private.can_read_support_data(org_id)
  or (visibility = 'public' and private.owns_conversation(conversation_id)));

create policy incidents_read on public.incidents for select to authenticated using (private.can_read_support_data(org_id));
create policy tickets_read on public.tickets for select to authenticated using (private.can_read_support_data(org_id));

-- Temps réel pour la console technicien (la RLS s'applique aux abonnements). Ignoré si la publication n'existe pas.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.tickets, public.incidents;
  end if;
end $$;
