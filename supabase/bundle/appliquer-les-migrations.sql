-- Relève IA : application des 18 migrations en une seule fois. GÉNÉRÉ par scripts/build-migration-bundle.sh : ne pas modifier à la main.
-- Mode d'emploi : tableau de bord Supabase, « SQL Editor », « New query », collez TOUT ce fichier, puis « Run ».
-- À faire UNE fois, sur un projet VIDE. Résultat attendu : « Success. No rows returned ».
-- Tout est dans une seule transaction : en cas d'erreur, rien n'est appliqué ; copiez le message d'erreur (sans clé ni mot de passe).
-- Ne contient ni la graine de démonstration ni les tests.

begin;

-- ====================================================================================================
-- 20261106100100_fondations.sql
-- ====================================================================================================
-- Relève IA : fondations.
-- Extensions, schéma privé (fonctions de contrôle non exposées par l'API), utilitaires, offres et fonctionnalités.
-- MIGRATION À APPLIQUER PAR LE FONDATEUR (supabase db push), après les migrations précédentes (aucune).

-- pgvector pour la base de connaissance ; pgcrypto pour gen_random_uuid() et les empreintes.
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Vault : stockage chiffré des secrets des connecteurs. Activé par défaut sur Supabase ; ignoré s'il n'est pas disponible
-- (banc d'essai local, où un faux schéma vault est fourni).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault')
     and not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    create extension supabase_vault with schema vault;
  end if;
end $$;

-- Schéma privé : jamais listé dans les schémas exposés de l'API (config.toml). Les fonctions SECURITY DEFINER
-- de contrôle d'accès y vivent : appelables par les politiques RLS, pas par un client.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- Rôles de l'application : la liste fermée des 10 rôles (docs/10, spec § 8).
create function private.role_family(p_role text) returns text
language sql immutable parallel safe set search_path = '' as
$$ select case p_role
     when 'super_admin' then 'platform' when 'platform_support' then 'platform'
     when 'partner_admin' then 'partner' when 'partner_manager' then 'partner' when 'partner_technician' then 'partner'
     when 'org_admin' then 'client' when 'org_technician' then 'client' when 'org_viewer' then 'client'
     when 'auditor' then 'client' when 'end_user' then 'client'
     else null end $$;

-- Rang d'un rôle dans sa famille : sert à interdire qu'une invitation donne plus de droits que celui qui invite.
create function private.role_rank(p_role text) returns int
language sql immutable parallel safe set search_path = '' as
$$ select case p_role
     when 'super_admin' then 100 when 'platform_support' then 50
     when 'partner_admin' then 100 when 'partner_manager' then 60 when 'partner_technician' then 40
     when 'org_admin' then 100 when 'org_technician' then 60 when 'org_viewer' then 30
     when 'auditor' then 30 when 'end_user' then 10
     else 0 end $$;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as
$$ begin new.updated_at := now(); return new; end $$;

-- Retire d'une ligne les colonnes qui ne doivent jamais atterrir dans le journal d'audit.
create function private.redact_row(p_row jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as
$$ select coalesce(p_row, '{}'::jsonb) - 'token_hash' - 'secret' - 'vault_secret_id' - 'embedding' $$;


-- ====================================================================================================
-- 20261106100200_acces_et_audit.sql
-- ====================================================================================================
-- Relève IA : organisations, rôles, relations ESN-client, assignations, accès d'assistance, invitations, journal d'audit.
-- C'est le socle de l'isolation (menaces M03, M27 à M30, M18 ; invariants R1 à R9 de docs/threat-model.md).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100100_fondations.sql.
--
-- Principe : le navigateur LIT (RLS) mais n'ÉCRIT RIEN directement. Toute écriture passe par les Edge Functions
-- (service_role) qui vérifient l'identité, le rôle et le MFA. La base garde ses propres garde-fous (triggers,
-- contraintes) pour que même une fonction défaillante ne puisse pas casser un invariant.

-- ---------------------------------------------------------------------------------------------------------------
-- Journal d'audit : INSERT seulement (menace M18). Créé en premier : des triggers y écrivent.
-- ---------------------------------------------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  org_id uuid,                                  -- sans clé étrangère : le journal survit à tout
  actor_kind text not null check (actor_kind in ('user', 'agent', 'system', 'service')),
  actor_id uuid,
  on_behalf_of uuid,                            -- pour le compte de (valideur, délégant...)
  event text not null,
  subject_type text,
  subject_id text,
  details jsonb not null default '{}'::jsonb,   -- toujours masqué : jamais de secret
  request_id text
);
create index audit_logs_org_at_idx on public.audit_logs (org_id, at desc);
create index audit_logs_event_idx on public.audit_logs (event, at desc);
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated, service_role;
grant select on public.audit_logs to authenticated;
grant insert on public.audit_logs to service_role;
grant usage on sequence public.audit_logs_id_seq to service_role;

-- Aucune modification ni suppression, pour personne, y compris le propriétaire de la table.
create function private.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as
$$ begin raise exception 'audit_logs est en insertion seule (opération % refusée)', tg_op using errcode = '42501'; end $$;
create trigger audit_logs_no_update_delete before update or delete on public.audit_logs
  for each row execute function private.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_logs_immutable();

-- Enregistre automatiquement chaque changement des tables sensibles : impossible à oublier côté fonction.
create function private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_actor uuid := (select auth.uid());
begin
  insert into public.audit_logs (org_id, actor_kind, actor_id, on_behalf_of, event, subject_type, subject_id, details)
  values (
    coalesce((v_row ->> 'org_id')::uuid, (v_row ->> 'client_org_id')::uuid,
             case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end),
    case when v_actor is null then 'service' else 'user' end,
    v_actor,
    nullif(current_setting('app.on_behalf_of', true), '')::uuid,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    jsonb_build_object(
      'old', case when tg_op <> 'INSERT' then private.redact_row(to_jsonb(old)) end,
      'new', case when tg_op <> 'DELETE' then private.redact_row(to_jsonb(new)) end)
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Organisations
-- ---------------------------------------------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('platform', 'partner', 'client')),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  state text not null default 'active' check (state in ('trial', 'pilot', 'active', 'suspended')),
  plan text not null default 'pilot' check (plan in ('pilot', 'essential', 'pro', 'partner', 'platform')),
  labels text[] not null default '{}',
  -- Niveau d'autonomie par défaut : 0 (conseille) ou 1 (agit après validation). Le niveau 2 n'existe pas.
  autonomy_default smallint not null default 0 check (autonomy_default in (0, 1)),
  branding jsonb not null default '{}'::jsonb,
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  created_via_partner_id uuid references public.organizations (id),   -- ESN créatrice (facturation, rattachement)
  activated_at timestamptz,                                           -- activation par l'administrateur du client
  frozen_at timestamptz,                                              -- arrêt d'urgence (ANSSI, principe 6)
  frozen_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organizations_one_platform on public.organizations ((true)) where type = 'platform';
create index organizations_created_via_partner_idx on public.organizations (created_via_partner_id);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

create function private.organizations_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' then
    if new.type is distinct from old.type then raise exception 'Le type d''une organisation est immuable'; end if;
    if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
      raise exception 'Une organisation activée ne peut pas être désactivée'; end if;
    if new.created_via_partner_id is distinct from old.created_via_partner_id then
      raise exception 'Le rattachement à l''ESN créatrice est immuable (un client ne passe à une autre ESN qu''avec l''accord de son administrateur : nouvelle relation)'; end if;
  end if;
  if new.created_via_partner_id is not null then
    if new.type <> 'client' then raise exception 'Seul un client peut avoir été créé par une ESN'; end if;
    if not exists (select 1 from public.organizations p where p.id = new.created_via_partner_id and p.type = 'partner') then
      raise exception 'created_via_partner_id doit désigner une ESN'; end if;
  end if;
  if new.type = 'platform' and new.plan <> 'platform' then raise exception 'La plateforme a l''offre platform'; end if;
  if new.type <> 'platform' and new.plan = 'platform' then raise exception 'L''offre platform est réservée à la plateforme'; end if;
  return new;
end $$;
create trigger organizations_guard before insert or update on public.organizations
  for each row execute function private.organizations_guard();

-- Fonctionnalités par offre : jamais de test d'offre en dur dans le SQL ni dans le code (règle 4).
create table public.plan_features (
  plan text not null check (plan in ('pilot', 'essential', 'pro', 'partner', 'platform')),
  feature text not null,
  primary key (plan, feature)
);
insert into public.plan_features (plan, feature) values
  ('pilot', 'shadow_mode'), ('pilot', 'quality_screen'), ('pilot', 'level1_actions'),
  ('essential', 'shadow_mode'), ('essential', 'quality_screen'), ('essential', 'level1_actions'),
  ('pro', 'shadow_mode'), ('pro', 'quality_screen'), ('pro', 'level1_actions'),
  ('partner', 'partner_console'), ('partner', 'white_label'), ('partner', 'monthly_report'), ('partner', 'reseller_pricing'),
  ('platform', 'platform_admin');

-- La plateforme elle-même : une seule organisation de type platform.
insert into public.organizations (type, name, slug, plan) values ('platform', 'Relève IA', 'releve', 'platform');

-- ---------------------------------------------------------------------------------------------------------------
-- Appartenances : une personne × une organisation × un rôle (droits toujours calculés DANS une organisation, R2)
-- ---------------------------------------------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('super_admin', 'platform_support', 'partner_admin', 'partner_manager',
    'partner_technician', 'org_admin', 'org_technician', 'org_viewer', 'auditor', 'end_user')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'removed')),
  ends_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id)
);
create index memberships_org_idx on public.memberships (org_id, role) where status = 'active';
create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

create function private.memberships_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare v_type text;
begin
  if tg_op = 'DELETE' then
    -- R9 : on ne retire pas le dernier administrateur d'une organisation (sauf si l'organisation disparaît).
    if old.status = 'active' and old.role in ('org_admin', 'partner_admin')
       and exists (select 1 from public.organizations o where o.id = old.org_id)
       and not exists (select 1 from public.memberships m where m.org_id = old.org_id and m.id <> old.id
                         and m.role = old.role and m.status = 'active') then
      raise exception 'Impossible de retirer le dernier administrateur de l''organisation (R9)';
    end if;
    return old;
  end if;

  select o.type into v_type from public.organizations o where o.id = new.org_id;
  if private.role_family(new.role) is distinct from v_type then
    raise exception 'Le rôle % n''est pas valide dans une organisation de type %', new.role, v_type;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.org_id <> old.org_id then raise exception 'user_id et org_id sont immuables'; end if;
    if old.status = 'active' and old.role in ('org_admin', 'partner_admin')
       and (new.status <> 'active' or new.role <> old.role)
       and not exists (select 1 from public.memberships m where m.org_id = old.org_id and m.id <> old.id
                         and m.role = old.role and m.status = 'active') then
      raise exception 'Impossible de rétrograder ou suspendre le dernier administrateur de l''organisation (R9)';
    end if;
  end if;
  return new;
end $$;
create trigger memberships_guard before insert or update or delete on public.memberships
  for each row execute function private.memberships_guard();

-- Salariés importés (CSV ou Entra ID) : l'annuaire sert à reconnaître qui a le droit d'ouvrir une conversation.
create table public.directory_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  department text,
  manager_email text check (manager_email is null or manager_email = lower(manager_email)),
  source text not null check (source in ('csv', 'entra')),
  external_id text,
  active boolean not null default true,
  linked_user_id uuid references auth.users (id) on delete set null,   -- renseigné à la première connexion
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users (id),
  unique (org_id, email)
);
create index directory_users_linked_idx on public.directory_users (linked_user_id) where linked_user_id is not null;

-- ---------------------------------------------------------------------------------------------------------------
-- Relation ESN-client (modèle GDAP de Microsoft, docs/10 § 3.1) et assignation des techniciens
-- ---------------------------------------------------------------------------------------------------------------
create table public.partner_relationships (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references public.organizations (id) on delete restrict,
  client_org_id uuid not null references public.organizations (id) on delete restrict,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'reduced', 'suspended', 'revoked', 'expired')),
  approved_roles text[] not null default '{}'
    check (approved_roles <@ array['partner_admin', 'partner_manager', 'partner_technician']::text[]),
  created_by_partner boolean not null default false,   -- client créé par l'ESN : relation active d'emblée
  proposed_by uuid references auth.users (id),
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (partner_org_id <> client_org_id),
  check (expires_at > starts_at and expires_at <= starts_at + interval '12 months'),
  check ((status = 'revoked') = (revoked_at is not null))
);
create unique index partner_relationships_one_live on public.partner_relationships (partner_org_id, client_org_id)
  where status in ('proposed', 'active', 'reduced', 'suspended');
create index partner_relationships_client_idx on public.partner_relationships (client_org_id);
create trigger partner_relationships_updated_at before update on public.partner_relationships
  for each row execute function private.set_updated_at();

create function private.partner_relationships_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if not exists (select 1 from public.organizations o where o.id = new.partner_org_id and o.type = 'partner') then
    raise exception 'partner_org_id doit désigner une ESN'; end if;
  if not exists (select 1 from public.organizations o where o.id = new.client_org_id and o.type = 'client') then
    raise exception 'client_org_id doit désigner un client'; end if;

  if tg_op = 'UPDATE' then
    if new.partner_org_id <> old.partner_org_id or new.client_org_id <> old.client_org_id then
      raise exception 'Les deux parties d''une relation sont immuables'; end if;
    if old.status = 'revoked' then raise exception 'Une relation révoquée ne peut plus changer (il faut une nouvelle relation)'; end if;
    -- Une ESN ne peut jamais élargir son propre accès : après l'activation, les rôles approuvés ne font que diminuer.
    if old.status <> 'proposed' and not (new.approved_roles <@ old.approved_roles) then
      raise exception 'Les rôles approuvés ne peuvent que diminuer : une extension exige une nouvelle approbation du client'; end if;
    -- Un renouvellement (échéance plus lointaine) exige une nouvelle confirmation du client.
    if new.expires_at > old.expires_at and new.confirmed_at is not distinct from old.confirmed_at then
      raise exception 'Prolonger une relation exige une nouvelle confirmation du client'; end if;
  end if;

  if new.status in ('active', 'reduced') and cardinality(new.approved_roles) = 0 then
    raise exception 'Une relation active doit approuver au moins un rôle'; end if;
  return new;
end $$;
create trigger partner_relationships_guard before insert or update on public.partner_relationships
  for each row execute function private.partner_relationships_guard();

create table public.partner_assignments (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.partner_relationships (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'partner_technician' check (role = 'partner_technician'),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create unique index partner_assignments_one_live on public.partner_assignments (relationship_id, user_id)
  where revoked_at is null;
create index partner_assignments_user_idx on public.partner_assignments (user_id) where revoked_at is null;

create function private.partner_assignments_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare r public.partner_relationships%rowtype;
begin
  select * into r from public.partner_relationships where id = new.relationship_id;
  if tg_op = 'INSERT' then
    if r.status not in ('active', 'reduced') or r.revoked_at is not null or r.expires_at <= now() then
      raise exception 'Impossible d''assigner un technicien sur une relation qui n''est pas active'; end if;
    if not ('partner_technician' = any (r.approved_roles)) then
      raise exception 'Le client n''a pas approuvé le rôle partner_technician'; end if;
    if not exists (select 1 from public.memberships m where m.user_id = new.user_id and m.org_id = r.partner_org_id
                     and m.role = 'partner_technician' and m.status = 'active') then
      raise exception 'Le technicien assigné doit être un technicien actif de l''ESN'; end if;
  else
    if new.relationship_id <> old.relationship_id or new.user_id <> old.user_id then
      raise exception 'relationship_id et user_id sont immuables'; end if;
  end if;
  if new.ends_at > r.expires_at then
    raise exception 'Une assignation ne peut pas dépasser la fin de la relation'; end if;
  return new;
end $$;
create trigger partner_assignments_guard before insert or update on public.partner_assignments
  for each row execute function private.partner_assignments_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Accès d'assistance de la plateforme (« bris de glace », docs/10 § 3.4, menace M30)
-- ---------------------------------------------------------------------------------------------------------------
create table public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  client_org_id uuid not null references public.organizations (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  reason text not null check (char_length(reason) between 10 and 500),
  duration_minutes int not null default 240 check (duration_minutes between 15 and 1440),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  scope text not null default 'read_only' check (scope = 'read_only'),
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> requested_by),                 -- jamais auto-approuvé
  check ((approved_by is null) = (approved_at is null)),
  check ((starts_at is null) = (ends_at is null)),
  check (ends_at is null or (ends_at > starts_at and ends_at <= starts_at + interval '24 hours')),
  check (approved_by is not null or starts_at is null)                        -- pas de fenêtre sans approbation
);
create index support_access_grants_client_idx on public.support_access_grants (client_org_id, requested_by);

-- ---------------------------------------------------------------------------------------------------------------
-- Invitations à usage unique (menace M29)
-- ---------------------------------------------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('super_admin', 'platform_support', 'partner_admin', 'partner_manager',
    'partner_technician', 'org_admin', 'org_technician', 'org_viewer', 'auditor', 'end_user')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),       -- le jeton lui-même n'est jamais stocké
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id),
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check ((used_at is null) = (used_by is null))
);
create unique index invitations_one_pending on public.invitations (org_id, email, role) where used_at is null;

create table public.access_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open', 'completed')),
  items jsonb not null default '[]'::jsonb,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Fonctions de contrôle d'accès (SECURITY DEFINER, schéma privé). Expiration et révocation sont évaluées À LA LECTURE
-- (now()), jamais par une tâche planifiée (R4, I11).
-- ---------------------------------------------------------------------------------------------------------------
-- Variante qui prend l'utilisateur en paramètre : sert aux triggers, qui ne tournent pas dans le contexte de l'appelant.
create function private._member(p_user uuid, p_org uuid, p_roles text[] default null) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.org_id and o.state <> 'suspended'
    where m.user_id = p_user and m.org_id = p_org and m.status = 'active'
      and (m.ends_at is null or m.ends_at > now())
      and (p_roles is null or m.role = any (p_roles))
  )
$$;

create function private.is_member_of(p_org uuid, p_roles text[] default null) returns boolean
language sql stable security definer set search_path = '' as
$$ select private._member((select auth.uid()), p_org, p_roles) $$;

create function private.has_role(p_org uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as
$$ select private._member((select auth.uid()), p_org, array[p_role]) $$;

create function private.is_platform_staff(p_user uuid default null) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id and o.type = 'platform'
    where m.user_id = coalesce(p_user, (select auth.uid())) and m.status = 'active'
      and m.role in ('super_admin', 'platform_support')
  )
$$;

-- Voie A : administrateur ou responsable de compte de l'ESN, sur les clients dont la relation approuve ce rôle.
-- Voie B : technicien de l'ESN assigné (assignation active) sur un client dont la relation approuve le rôle technicien.
-- La relation ET (voie B) l'assignation doivent être actives, à cet instant (R3).
create function private._partner_can_access(p_user uuid, p_client uuid, p_needed text) returns boolean
language sql stable security definer set search_path = '' as
$$
  select case
    when p_needed = 'partner_technician' then exists (
      select 1
      from public.partner_assignments a
      join public.partner_relationships r on r.id = a.relationship_id
      join public.organizations pc on pc.id = r.client_org_id and pc.state <> 'suspended'
      join public.organizations pp on pp.id = r.partner_org_id and pp.state <> 'suspended'
      join public.memberships m on m.user_id = a.user_id and m.org_id = r.partner_org_id
                               and m.role = 'partner_technician' and m.status = 'active'
                               and (m.ends_at is null or m.ends_at > now())
      where r.client_org_id = p_client and a.user_id = p_user and a.role = 'partner_technician'
        and a.revoked_at is null and a.starts_at <= now() and a.ends_at > now()
        and r.status in ('active', 'reduced') and r.revoked_at is null
        and r.starts_at <= now() and r.expires_at > now()
        and 'partner_technician' = any (r.approved_roles))
    when p_needed in ('partner_admin', 'partner_manager') then exists (
      select 1
      from public.partner_relationships r
      join public.organizations pc on pc.id = r.client_org_id and pc.state <> 'suspended'
      join public.organizations pp on pp.id = r.partner_org_id and pp.state <> 'suspended'
      join public.memberships m on m.org_id = r.partner_org_id and m.user_id = p_user
                               and m.role = p_needed and m.status = 'active'
                               and (m.ends_at is null or m.ends_at > now())
      where r.client_org_id = p_client
        and r.status in ('active', 'reduced') and r.revoked_at is null
        and r.starts_at <= now() and r.expires_at > now()
        and p_needed = any (r.approved_roles))
    else false
  end
$$;

create function private.partner_can_access(p_client uuid, p_needed text default 'partner_technician') returns boolean
language sql stable security definer set search_path = '' as
$$ select private._partner_can_access((select auth.uid()), p_client, p_needed) $$;

-- L'accès d'assistance : le personnel de la plateforme qui l'a demandé, approuvé par le client, dans sa fenêtre (R5).
create function private.has_support_access(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select private.is_platform_staff() and exists (
    select 1 from public.support_access_grants g
    where g.client_org_id = p_client and g.requested_by = (select auth.uid())
      and g.approved_by is not null and g.revoked_at is null
      and g.starts_at <= now() and g.ends_at > now()
  )
$$;

-- Contenu des conversations, tickets, alertes... Ni la direction, ni l'auditeur, ni l'administrateur ESN hors assignation.
create function private.can_read_support_data(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select private.is_member_of(p_org, array['org_admin', 'org_technician'])
      or private.partner_can_access(p_org, 'partner_technician')
      or private.has_support_access(p_org)
$$;

-- Configuration et indicateurs agrégés (pas le contenu).
create function private.can_read_org_config(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select private.is_member_of(p_org, array['org_admin', 'org_technician'])
      or private.partner_can_access(p_org, 'partner_admin')
      or private.partner_can_access(p_org, 'partner_manager')
      or private.partner_can_access(p_org, 'partner_technician')
$$;

create function private.org_has_feature(p_org uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1 from public.organizations o join public.plan_features f on f.plan = o.plan
    where o.id = p_org and f.feature = p_feature and o.state <> 'suspended')
$$;

create function private.org_is_frozen(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select o.frozen_at is not null from public.organizations o where o.id = p_org), true) $$;

-- Second facteur récent : horodatage de la dernière vérification TOTP dans la revendication « amr » du jeton.
-- À CONFIRMER dans la documentation Supabase (format exact de « amr ») lors de l'application sur un vrai projet.
create function private.recent_mfa(p_max_age_seconds int default 600) returns boolean
language sql stable set search_path = '' as
$$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and coalesce((
       select max((e ->> 'timestamp')::bigint)
       from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
       where jsonb_typeof(e) = 'object' and e ->> 'method' in ('totp', 'mfa/totp', 'webauthn')
     ), 0) >= extract(epoch from now())::bigint - p_max_age_seconds
$$;

-- Un technicien voit la relation sur laquelle il est assigné ; un client voit l'ESN qui le gère.
create function private.is_assigned_to_relationship(p_rel uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.partner_assignments a
                 where a.relationship_id = p_rel and a.user_id = (select auth.uid()) and a.revoked_at is null)
$$;

create function private.client_of_partner(p_partner uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.partner_relationships r
                 where r.partner_org_id = p_partner and private.is_member_of(r.client_org_id, array['org_admin']))
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Garde-fous des accès d'assistance et des invitations (écrits ici car ils s'appuient sur les fonctions ci-dessus)
-- ---------------------------------------------------------------------------------------------------------------
create function private.support_access_grants_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if not private.is_platform_staff(new.requested_by) then
    raise exception 'Seul le personnel de la plateforme peut demander un accès d''assistance'; end if;
  if tg_op = 'UPDATE' then
    if new.client_org_id <> old.client_org_id or new.requested_by <> old.requested_by or new.reason <> old.reason then
      raise exception 'La demande d''accès d''assistance est immuable'; end if;
    -- Une fois approuvé, la fenêtre ne peut plus être étendue : une prolongation exige une nouvelle demande.
    if old.approved_by is not null and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
         or new.approved_by is distinct from old.approved_by) then
      raise exception 'Un accès d''assistance approuvé ne peut être ni prolongé ni réapprouvé'; end if;
  end if;
  if new.approved_by is not null then
    -- L'approbateur est l'administrateur du client, ou l'administrateur de l'ESN qui le gère (docs/10 § 3.4).
    if not (private._member(new.approved_by, new.client_org_id, array['org_admin'])
         or private._partner_can_access(new.approved_by, new.client_org_id, 'partner_admin')) then
      raise exception 'L''accès d''assistance doit être approuvé par l''administrateur du client ou de son ESN'; end if;
  end if;
  return new;
end $$;
create trigger support_access_grants_guard before insert or update on public.support_access_grants
  for each row execute function private.support_access_grants_guard();

create function private.invitations_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_inviter_role text;
begin
  select * into v_org from public.organizations where id = new.org_id;

  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.email <> old.email or new.role <> old.role
       or new.token_hash <> old.token_hash or new.invited_by <> old.invited_by or new.expires_at <> old.expires_at then
      raise exception 'Une invitation est immuable (sauf son utilisation)'; end if;
    if old.used_at is not null then raise exception 'Une invitation ne sert qu''une fois'; end if;
    if new.used_at is not null and old.expires_at <= now() then raise exception 'Invitation expirée'; end if;
    return new;
  end if;

  -- Le rôle doit exister dans ce type d'organisation.
  if private.role_family(new.role) is distinct from v_org.type then
    raise exception 'Le rôle % ne peut pas être invité dans une organisation de type %', new.role, v_org.type; end if;

  select m.role into v_inviter_role from public.memberships m
   where m.user_id = new.invited_by and m.org_id = new.org_id and m.status = 'active';

  if new.role in ('super_admin', 'platform_support') then
    if not exists (select 1 from public.memberships m where m.user_id = new.invited_by and m.org_id = new.org_id
                     and m.role = 'super_admin' and m.status = 'active') then
      raise exception 'Seul un super administrateur invite du personnel de la plateforme'; end if;
  elsif v_inviter_role is not null then
    -- Cas (a) : un membre de l'organisation invite, sans jamais donner plus de droits que les siens.
    if private.role_rank(new.role) > private.role_rank(v_inviter_role) then
      raise exception 'On ne peut pas inviter un rôle supérieur au sien (élévation de rôle refusée)'; end if;
  elsif v_org.type = 'partner' and new.role = 'partner_admin'
        and exists (select 1 from public.memberships m join public.organizations p on p.id = m.org_id and p.type = 'platform'
                     where m.user_id = new.invited_by and m.role = 'super_admin' and m.status = 'active') then
    null;   -- Cas (b) : le super administrateur invite le premier administrateur d'une ESN.
  elsif v_org.type = 'client' and new.role = 'org_admin' and v_org.activated_at is null
        and v_org.created_via_partner_id is not null
        and private._member(new.invited_by, v_org.created_via_partner_id, array['partner_admin']) then
    null;   -- Cas (c) : l'ESN créatrice invite le premier administrateur de son client, avant son activation.
  else
    raise exception 'L''invitant n''a pas autorité pour inviter ce rôle dans cette organisation'; end if;

  return new;
end $$;
create trigger invitations_guard before insert or update on public.invitations
  for each row execute function private.invitations_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Audit automatique des tables sensibles
-- ---------------------------------------------------------------------------------------------------------------
create trigger audit_organizations after insert or update or delete on public.organizations
  for each row execute function private.audit_change();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit_change();
create trigger audit_partner_relationships after insert or update or delete on public.partner_relationships
  for each row execute function private.audit_change();
create trigger audit_partner_assignments after insert or update or delete on public.partner_assignments
  for each row execute function private.audit_change();
create trigger audit_support_access_grants after insert or update or delete on public.support_access_grants
  for each row execute function private.audit_change();
create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function private.audit_change();
create trigger audit_directory_users after insert or update or delete on public.directory_users
  for each row execute function private.audit_change();

-- ---------------------------------------------------------------------------------------------------------------
-- Droits et politiques RLS : lecture seule pour l'API, écriture par les Edge Functions uniquement
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations', 'plan_features', 'memberships', 'directory_users', 'partner_relationships',
                           'partner_assignments', 'support_access_grants', 'invitations', 'access_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Le condensé du jeton d'invitation n'est lisible par personne côté API.
revoke select on public.invitations from authenticated;
grant select (id, org_id, email, role, invited_by, created_at, expires_at, used_at) on public.invitations to authenticated;

create policy plan_features_read on public.plan_features for select to authenticated using (true);

create policy organizations_read on public.organizations for select to authenticated using (
  private.is_platform_staff()
  or private.is_member_of(id)
  or private.partner_can_access(id, 'partner_admin')
  or private.partner_can_access(id, 'partner_manager')
  or private.partner_can_access(id, 'partner_technician')
  or (type = 'partner' and private.client_of_partner(id))
);

create policy memberships_read on public.memberships for select to authenticated using (
  user_id = (select auth.uid())
  or private.is_member_of(org_id, array['org_admin', 'partner_admin'])
  or (role <> 'end_user' and private.partner_can_access(org_id, 'partner_admin'))
);

create policy directory_users_read on public.directory_users for select to authenticated using (
  private.is_member_of(org_id, array['org_admin'])
  or private.partner_can_access(org_id, 'partner_admin')
  or private.partner_can_access(org_id, 'partner_technician')
);

create policy partner_relationships_read on public.partner_relationships for select to authenticated using (
  private.is_member_of(client_org_id, array['org_admin'])
  or private.is_member_of(partner_org_id, array['partner_admin', 'partner_manager'])
  or private.is_assigned_to_relationship(id)
);

create policy partner_assignments_read on public.partner_assignments for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.partner_relationships r where r.id = relationship_id
             and (private.is_member_of(r.partner_org_id, array['partner_admin', 'partner_manager'])
               or private.is_member_of(r.client_org_id, array['org_admin'])))
);

create policy support_access_grants_read on public.support_access_grants for select to authenticated using (
  requested_by = (select auth.uid())
  or private.is_member_of(client_org_id, array['org_admin'])
);

create policy invitations_read on public.invitations for select to authenticated using (
  private.is_member_of(org_id, array['org_admin', 'partner_admin'])
);

create policy access_reviews_read on public.access_reviews for select to authenticated using (
  private.is_member_of(org_id, array['org_admin', 'partner_admin', 'auditor'])
);

-- Journal d'audit : l'administrateur et l'auditeur de l'organisation voient ses événements ; la plateforme voit les
-- siens (organisation « platform ») mais jamais ceux d'un client.
create policy audit_logs_read on public.audit_logs for select to authenticated using (
  (org_id is not null and private.is_member_of(org_id, array['org_admin', 'partner_admin', 'auditor']))
);

-- Fonctions de contrôle : appelables par les politiques (rôle authenticated) mais pas par n'importe qui.
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function private.audit_change(), private.audit_logs_immutable(), private.memberships_guard(),
  private.organizations_guard(), private.partner_relationships_guard(), private.partner_assignments_guard(),
  private.support_access_grants_guard(), private.invitations_guard() from authenticated;


-- ====================================================================================================
-- 20261106100300_support_et_connecteurs.sql
-- ====================================================================================================
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


-- ====================================================================================================
-- 20261106100400_connaissance.sql
-- ====================================================================================================
-- Relève IA : base de connaissance (fiches et morceaux vectorisés).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100300_support_et_connecteurs.sql.

create table public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  category text check (category = any (private.categories())),
  source text not null default 'manual' check (source in ('manual', 'import', 'ticket', 'seed')),
  source_ref text,
  -- Une fiche n'est consultable par l'agent qu'une fois VALIDÉE par un humain (menace M08, empoisonnement).
  status text not null default 'draft' check (status in ('draft', 'validated', 'archived')),
  version int not null default 1 check (version >= 1),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id),
  validated_by uuid references auth.users (id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'validated' or (validated_by is not null and validated_at is not null))
);
create index kb_documents_org_status_idx on public.kb_documents (org_id, status);
create trigger kb_documents_updated_at before update on public.kb_documents
  for each row execute function private.set_updated_at();

-- Le validateur doit être une personne habilitée de l'organisation (jamais l'agent, jamais un salarié).
create function private.kb_documents_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then raise exception 'org_id est immuable'; end if;
  if new.status = 'validated' and not (
       private._member(new.validated_by, new.org_id, array['org_admin', 'org_technician'])
       or private._partner_can_access(new.validated_by, new.org_id, 'partner_technician')
       or private._partner_can_access(new.validated_by, new.org_id, 'partner_admin')) then
    raise exception 'Une fiche ne peut être validée que par un technicien ou un administrateur habilité'; end if;
  return new;
end $$;
create trigger kb_documents_guard before insert or update on public.kb_documents
  for each row execute function private.kb_documents_guard();
create trigger audit_kb_documents after insert or update or delete on public.kb_documents
  for each row execute function private.audit_change();

create table public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 8000),
  token_count int,
  embedding extensions.vector(1024),                     -- vecteur de mistral-embed ; nul tant qu'il n'est pas calculé
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index kb_chunks_org_idx on public.kb_chunks (org_id);
create index kb_chunks_embedding_hnsw on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create function private.kb_chunks_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if not exists (select 1 from public.kb_documents d where d.id = new.document_id and d.org_id = new.org_id) then
    raise exception 'Le morceau doit appartenir à l''organisation de sa fiche (isolation de la base vectorielle)'; end if;
  return new;
end $$;
create trigger kb_chunks_guard before insert or update on public.kb_chunks
  for each row execute function private.kb_chunks_guard();

-- Recherche vectorielle. FILTRÉE PAR ORGANISATION À L'INTÉRIEUR DE LA FONCTION : même appelée avec la clé service_role
-- (qui contourne la RLS), elle ne renvoie jamais une fiche d'une autre organisation. Seules les fiches validées sont lues.
create function public.match_kb_chunks(
  p_org uuid, p_query extensions.vector(1024), p_limit int default 5, p_min_score float default 0.0)
returns table (chunk_id uuid, document_id uuid, title text, content text, score float)
language sql stable security invoker set search_path = '' as
$$
  select c.id, c.document_id, d.title, c.content,
         (1 - (c.embedding operator(extensions.<=>) p_query))::float as score
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where c.org_id = p_org and d.org_id = p_org
    and d.status = 'validated' and c.embedding is not null
    and (1 - (c.embedding operator(extensions.<=>) p_query)) >= p_min_score
  order by c.embedding operator(extensions.<=>) p_query
  limit least(greatest(p_limit, 1), 20)
$$;
revoke all on function public.match_kb_chunks(uuid, extensions.vector, int, float) from public, anon;
grant execute on function public.match_kb_chunks(uuid, extensions.vector, int, float) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['kb_documents', 'kb_chunks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy kb_documents_read on public.kb_documents for select to authenticated using (private.can_read_org_config(org_id));
create policy kb_chunks_read on public.kb_chunks for select to authenticated using (private.can_read_org_config(org_id));


-- ====================================================================================================
-- 20261106100500_releve.sql
-- ====================================================================================================
-- Relève IA : plannings de relève et rapports de passation de garde.
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100400_connaissance.sql.

create table public.relief_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- absence / night / leave : l'équipe est absente, la relève est active.
  -- on_call : un technicien est d'astreinte (premier maillon de la chaîne de validation).
  kind text not null check (kind in ('absence', 'night', 'leave', 'on_call')),
  technician_user_id uuid references auth.users (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text check (char_length(note) <= 500),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (kind <> 'on_call' or technician_user_id is not null)
);
create index relief_schedules_org_time_idx on public.relief_schedules (org_id, starts_at, ends_at);
create trigger audit_relief_schedules after insert or update or delete on public.relief_schedules
  for each row execute function private.audit_change();

create function private.relief_active(p_org uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.relief_schedules s
                 where s.org_id = p_org and s.kind in ('absence', 'night', 'leave')
                   and s.starts_at <= p_at and s.ends_at > p_at)
$$;

create function private.on_call_now(p_org uuid, p_user uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.relief_schedules s
                 where s.org_id = p_org and s.kind = 'on_call' and s.technician_user_id = p_user
                   and s.starts_at <= p_at and s.ends_at > p_at)
$$;

create table public.handover_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  technician_user_id uuid not null references auth.users (id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  content jsonb not null default '{}'::jsonb,       -- résolu / en attente / escaladé / à surveiller
  generated_at timestamptz not null default now(),
  read_at timestamptz,
  check (period_end > period_start),
  unique (org_id, technician_user_id, period_start)
);

do $$
declare t text;
begin
  foreach t in array array['relief_schedules', 'handover_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy relief_schedules_read on public.relief_schedules for select to authenticated using (private.can_read_org_config(org_id));
-- Un rapport de passation est celui d'un technicien : lui et l'administrateur du client le lisent, personne d'autre.
create policy handover_reports_read on public.handover_reports for select to authenticated using (
  technician_user_id = (select auth.uid()) or private.is_member_of(org_id, array['org_admin']));


-- ====================================================================================================
-- 20261106100600_alertes.sql
-- ====================================================================================================
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


-- ====================================================================================================
-- 20261106100700_actions.sql
-- ====================================================================================================
-- Relève IA : actions de niveau 1 (menaces M01, M02, M05, M09, M12, M13 ; invariants I1 à I12 de docs/threat-model.md).
-- L'IA PRÉPARE une action_request, un humain nommé la VALIDE, elle s'exécute avec l'identité de cet humain.
-- Les invariants sont écrits DANS LA BASE : une Edge Function défaillante ne peut pas les contourner.
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100600_alertes.sql.

create function private.approval_categories() returns text[]
language sql immutable parallel safe set search_path = '' as
$$ select array['accounts', 'mailboxes', 'licenses', 'scripts', 'tickets'] $$;

-- Capacités qui passent par une action_request (PrivilegedCapability du contrat, docs/spec-mvp.md § 7).
create function private.privileged_capabilities() returns text[]
language sql immutable parallel safe set search_path = '' as
$$ select array['user.reset_password', 'user.unlock', 'user.revoke_sessions', 'user.mfa_reregister',
                'ticket.update_status', 'ticket.assign', 'alert.acknowledge'] $$;

create function private.capability_category(p_capability text) returns text
language sql immutable parallel safe set search_path = '' as
$$ select case when p_capability like 'user.%' then 'accounts' else 'tickets' end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Niveau d'autonomie par catégorie et par organisation : 0 (conseille) ou 1 (agit après validation). Jamais 2.
-- ---------------------------------------------------------------------------------------------------------------
create table public.autonomy_settings (
  org_id uuid not null references public.organizations (id) on delete cascade,
  category text not null check (category = any (private.approval_categories())),
  level smallint not null default 0 check (level in (0, 1)),
  set_by uuid references auth.users (id),
  set_at timestamptz not null default now(),
  mfa_verified_at timestamptz,
  primary key (org_id, category),
  -- Passer au niveau 1 exige un second facteur vérifié au moment du changement.
  check (level = 0 or (set_by is not null and mfa_verified_at is not null
         and mfa_verified_at >= set_at - interval '10 minutes' and mfa_verified_at <= set_at + interval '1 minute'))
);

create function private.autonomy_settings_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if new.level = 1 then
    if not exists (select 1 from public.organizations o where o.id = new.org_id and o.activated_at is not null
                   and o.frozen_at is null) then
      raise exception 'Le niveau 1 exige un client activé et non gelé'; end if;
    if not private.org_has_feature(new.org_id, 'level1_actions') then
      raise exception 'Le niveau 1 n''est pas inclus dans l''offre de cette organisation'; end if;
    if new.category = 'accounts' and not exists (
         select 1 from public.connectors c where c.org_id = new.org_id and c.type = 'm365'
           and c.status = 'ok' and c.environment is not null) then
      raise exception 'Le niveau 1 sur les comptes exige un connecteur Microsoft 365 connecté et qualifié test ou production'; end if;
  end if;
  return new;
end $$;
create trigger autonomy_settings_guard before insert or update on public.autonomy_settings
  for each row execute function private.autonomy_settings_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Chaînes de valideurs
-- ---------------------------------------------------------------------------------------------------------------
create table public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category text not null check (category = any (private.approval_categories())),
  -- Chaîne ordonnée : [{"kind":"on_call"}, {"kind":"user","user_id":"..."}, {"kind":"partner_fallback"}]
  -- Chaîne vide = personne n'est éligible = rien ne s'exécute (I8).
  chain jsonb not null default '[]'::jsonb check (jsonb_typeof(chain) = 'array' and jsonb_array_length(chain) <= 10),
  timeout_minutes int not null default 15 check (timeout_minutes between 1 and 240),
  expires_after_minutes int not null default 1440 check (expires_after_minutes between 15 and 4320),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (org_id, category)
);

create function private.approval_policies_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare step jsonb;
begin
  for step in select * from jsonb_array_elements(new.chain) loop
    if jsonb_typeof(step) <> 'object' or step ->> 'kind' not in ('on_call', 'user', 'partner_fallback') then
      raise exception 'Étape de chaîne invalide : %', step; end if;
    if step ->> 'kind' = 'user' then
      if (step ->> 'user_id') is null or (step ->> 'user_id') !~ '^[0-9a-f-]{36}$' then
        raise exception 'Une étape « user » exige un user_id'; end if;
      if not (private._member((step ->> 'user_id')::uuid, new.org_id, array['org_technician'])
              or private._partner_can_access((step ->> 'user_id')::uuid, new.org_id, 'partner_technician')) then
        raise exception 'Le valideur % n''est pas un technicien habilité de cette organisation', step ->> 'user_id'; end if;
    end if;
  end loop;
  return new;
end $$;
create trigger approval_policies_guard before insert or update on public.approval_policies
  for each row execute function private.approval_policies_guard();

-- Un technicien habilité à agir dans l'organisation : membre technicien interne, ou technicien d'ESN assigné.
create function private.can_act_in_org(p_user uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as
$$ select private._member(p_user, p_org, array['org_technician']) or private._partner_can_access(p_user, p_org, 'partner_technician') $$;

-- Cette personne figure-t-elle DIRECTEMENT dans la chaîne (sans délégation) ?
create function private._direct_step_match(p_org uuid, p_category text, p_user uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as
$$
  select private.can_act_in_org(p_user, p_org) and exists (
    select 1 from public.approval_policies pol, jsonb_array_elements(pol.chain) step
    where pol.org_id = p_org and pol.category = p_category
      and ((step ->> 'kind' = 'user' and step ->> 'user_id' = p_user::text)
        or (step ->> 'kind' = 'on_call' and private.on_call_now(p_org, p_user, p_at))
        or (step ->> 'kind' = 'partner_fallback' and private._partner_can_access(p_user, p_org, 'partner_technician')))
  )
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Délégations temporaires (suppléance) : nominatives, limitées, datées, non transmissibles
-- ---------------------------------------------------------------------------------------------------------------
create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  delegator_id uuid not null references auth.users (id),
  delegate_id uuid not null references auth.users (id),
  categories text[] not null check (cardinality(categories) >= 1 and categories <@ private.approval_categories()),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid not null references auth.users (id),    -- le délégant, ou l'administrateur du client (réattribution, I9)
  mfa_verified_at timestamptz not null,                   -- second facteur au moment de la création (I3)
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  check (delegator_id <> delegate_id),                                              -- I2 : pas d'auto-délégation
  check (ends_at > starts_at and ends_at <= starts_at + interval '30 days'),        -- I4 : 30 jours au maximum
  check (mfa_verified_at >= created_at - interval '10 minutes' and mfa_verified_at <= created_at + interval '1 minute')
);
create index approval_delegations_delegate_idx on public.approval_delegations (delegate_id) where revoked_at is null;

create function private.approval_delegations_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare c text;
begin
  if tg_op = 'UPDATE' then
    -- Seule la révocation est possible ; la délégation ne se modifie jamais (on en crée une autre).
    if (new.org_id, new.delegator_id, new.delegate_id, new.categories, new.starts_at, new.ends_at, new.created_by, new.mfa_verified_at)
       is distinct from (old.org_id, old.delegator_id, old.delegate_id, old.categories, old.starts_at, old.ends_at, old.created_by, old.mfa_verified_at) then
      raise exception 'Une délégation ne se modifie pas : on la révoque et on en crée une autre'; end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'Une délégation révoquée reste révoquée'; end if;
    return new;
  end if;

  -- I6 : le suppléant doit déjà être habilité dans l'organisation ; la délégation n'élargit pas ses droits de lecture.
  if not private.can_act_in_org(new.delegate_id, new.org_id) then
    raise exception 'Le suppléant doit être un technicien déjà habilité dans cette organisation (I6)'; end if;
  -- On ne délègue que ce que l'on détient DIRECTEMENT : une délégation ne se transmet pas (I6).
  foreach c in array new.categories loop
    if not private._direct_step_match(new.org_id, c, new.delegator_id, new.starts_at) then
      raise exception 'Le délégant ne détient pas directement la catégorie % : il ne peut pas la déléguer', c; end if;
  end loop;
  -- Création par le délégant, ou réattribution par l'administrateur du client (I9, mêmes bornes).
  if new.created_by <> new.delegator_id and not private._member(new.created_by, new.org_id, array['org_admin']) then
    raise exception 'Une délégation est créée par le délégant ou par l''administrateur du client'; end if;
  return new;
end $$;
create trigger approval_delegations_guard before insert or update on public.approval_delegations
  for each row execute function private.approval_delegations_guard();

-- Éligibilité à valider : habilité dans l'organisation ET (dans la chaîne OU suppléant actif d'un membre de la chaîne).
create function private.is_eligible_approver(p_org uuid, p_category text, p_user uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as
$$
  select private.can_act_in_org(p_user, p_org) and (
    private._direct_step_match(p_org, p_category, p_user, p_at)
    or exists (
      select 1 from public.approval_delegations d
      where d.org_id = p_org and d.delegate_id = p_user and p_category = any (d.categories)
        and d.revoked_at is null and d.starts_at <= p_at and d.ends_at > p_at
        and private._direct_step_match(p_org, p_category, d.delegator_id, p_at))
  )
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Demandes d'action
-- ---------------------------------------------------------------------------------------------------------------
create table public.action_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  capability text not null check (capability = any (private.privileged_capabilities())),
  category text not null check (category = any (private.approval_categories())),
  target_ref text not null check (char_length(target_ref) between 1 and 320),          -- e-mail du compte, ou référence du ticket
  target_directory_user_id uuid references public.directory_users (id),
  target_user_id uuid references auth.users (id),
  params jsonb not null default '{}'::jsonb,
  -- Empreinte calculée PAR LA BASE à l'insertion : ce que le valideur a vu est exactement ce qui s'exécute (M12).
  params_hash text not null default '' ,
  requested_by_kind text not null check (requested_by_kind in ('agent', 'user', 'automation')),
  requester_user_id uuid references auth.users (id),                                    -- le salarié à l'origine
  status text not null default 'pending_approval' check (status in
    ('pending_approval', 'approved', 'executing', 'succeeded', 'failed', 'unknown', 'rejected', 'expired', 'cancelled')),
  risk_flags jsonb not null default '[]'::jsonb,
  -- Vérification d'identité hors bande, faite par le valideur : {"method":"callback|manager_confirmation|in_person","performed_by":"uuid","at":"..."}
  identity_check jsonb,
  approver_id uuid references auth.users (id),
  approved_via_delegation_id uuid references public.approval_delegations (id),
  approved_hash text,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  reason text check (char_length(reason) <= 500),       -- motif de refus (mauvaise cible, mauvais périmètre, identité non confirmée, autre) ou d'annulation
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);
-- Idempotence : une seule demande ouverte pour la même action exacte (double clic, relance).
create unique index action_requests_open_unique on public.action_requests (org_id, params_hash)
  where status in ('pending_approval', 'approved', 'executing');
create index action_requests_org_status_idx on public.action_requests (org_id, status, created_at desc);

create function private.action_requests_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_conv public.conversations%rowtype;
  v_policy public.approval_policies%rowtype;
  v_level smallint;
  v_target_email text;
  v_approver_email text;
  v_requires_identity boolean;
  v_direct boolean;
begin
  select * into v_org from public.organizations where id = new.org_id;

  ------------------------------------------------------------------ création
  if tg_op = 'INSERT' then
    new.category := private.capability_category(new.capability);
    new.status := 'pending_approval';
    if v_org.frozen_at is not null then raise exception 'Organisation gelée (arrêt d''urgence) : aucune action (SEC-28)'; end if;
    if v_org.activated_at is null then raise exception 'Le client n''a pas été activé par son administrateur : aucune action (SEC-30)'; end if;
    select coalesce(max(level), 0) into v_level from public.autonomy_settings s where s.org_id = new.org_id and s.category = new.category;
    if v_level < 1 then raise exception 'Niveau d''autonomie 0 pour la catégorie % : l''agent ne prépare aucune action', new.category; end if;
    if new.category = 'accounts' and not exists (
         select 1 from public.connectors c where c.org_id = new.org_id and c.type = 'm365' and c.status = 'ok' and c.environment is not null) then
      raise exception 'Connecteur Microsoft 365 absent ou non qualifié test/production (SEC-31)'; end if;

    if new.capability like 'user.%' then
      -- self_only : la cible est l'utilisateur authentifié de la conversation, jamais une valeur lue dans un message (X5, M01).
      if new.conversation_id is null then raise exception 'Une action sur un compte exige une conversation'; end if;
      select * into v_conv from public.conversations where id = new.conversation_id;
      if v_conv.id is null or v_conv.org_id <> new.org_id then raise exception 'Conversation inconnue pour cette organisation'; end if;
      if new.target_directory_user_id is distinct from v_conv.directory_user_id or v_conv.directory_user_id is null then
        raise exception 'La cible d''une action sur un compte doit être l''utilisateur de la conversation (self_only)'; end if;
      new.requester_user_id := v_conv.requester_user_id;
      select du.email, du.linked_user_id into v_target_email, new.target_user_id from public.directory_users du where du.id = new.target_directory_user_id;
      new.target_ref := v_target_email;
    end if;

    select * into v_policy from public.approval_policies p where p.org_id = new.org_id and p.category = new.category;
    if found then new.expires_at := now() + (v_policy.expires_after_minutes * interval '1 minute'); end if;
    new.params_hash := encode(extensions.digest(convert_to(
      new.org_id::text || '|' || new.capability || '|' || new.target_ref || '|' || new.params::text, 'UTF8'), 'sha256'), 'hex');
    new.approved_hash := null; new.approver_id := null; new.approved_at := null; new.identity_check := null;
    return new;
  end if;

  ------------------------------------------------------------------ modification
  if (new.org_id, new.conversation_id, new.capability, new.category, new.target_ref, new.target_directory_user_id,
      new.target_user_id, new.params, new.params_hash, new.requested_by_kind, new.requester_user_id, new.expires_at, new.created_at)
     is distinct from
     (old.org_id, old.conversation_id, old.capability, old.category, old.target_ref, old.target_directory_user_id,
      old.target_user_id, old.params, old.params_hash, old.requested_by_kind, old.requester_user_id, old.expires_at, old.created_at) then
    raise exception 'Une demande d''action est immuable : seul son état évolue (empreinte, M12)'; end if;

  if new.status = old.status then
    -- Seuls le résultat et la fin peuvent se compléter pendant l'exécution.
    if old.status in ('succeeded', 'failed', 'unknown', 'rejected', 'expired', 'cancelled') and new is distinct from old then
      raise exception 'État final : la demande ne change plus'; end if;
    return new;
  end if;

  if not ((old.status = 'pending_approval' and new.status in ('approved', 'rejected', 'expired', 'cancelled'))
       or (old.status = 'approved' and new.status in ('executing', 'cancelled'))
       or (old.status = 'executing' and new.status in ('succeeded', 'failed', 'unknown'))) then
    raise exception 'Transition interdite : % vers %', old.status, new.status; end if;

  if new.status = 'approved' then
    if v_org.frozen_at is not null then raise exception 'Organisation gelée : validation impossible (SEC-28)'; end if;
    if now() > old.expires_at then raise exception 'Demande expirée : rien ne s''exécute (I8)'; end if;
    if new.approver_id is null then raise exception 'Un valideur nommé est obligatoire (I1)'; end if;
    -- I2 : ni le demandeur, ni la cible, ne valident.
    if new.approver_id = old.requester_user_id or new.approver_id = old.target_user_id then
      raise exception 'Auto-validation interdite (I2)'; end if;
    select email into v_approver_email from auth.users where id = new.approver_id;
    if old.capability like 'user.%' and lower(coalesce(v_approver_email, '')) = lower(old.target_ref) then
      raise exception 'Un valideur ne valide pas une action sur son propre compte (I2)'; end if;
    -- SEC-12 : vérification d'identité hors bande enregistrée par le valideur lui-même.
    v_requires_identity := old.capability like 'user.%';
    if v_requires_identity and (new.identity_check is null
        or new.identity_check ->> 'method' not in ('callback', 'manager_confirmation', 'in_person')
        or new.identity_check ->> 'performed_by' is distinct from new.approver_id::text
        or (new.identity_check ->> 'at') is null) then
      raise exception 'Vérification d''identité hors bande obligatoire, faite par le valideur (SEC-12)'; end if;
    if new.approved_hash is distinct from old.params_hash then
      raise exception 'L''empreinte validée ne correspond pas à l''action (M12)'; end if;
    -- Éligibilité : dans la chaîne, ou suppléant actif ; la délégation utilisée doit être déclarée.
    if not private.is_eligible_approver(old.org_id, old.category, new.approver_id, now()) then
      raise exception 'Ce valideur n''est pas éligible pour cette catégorie (chaîne vide, hors chaîne, délégation absente ou expirée)'; end if;
    v_direct := private._direct_step_match(old.org_id, old.category, new.approver_id, now());
    if not v_direct and new.approved_via_delegation_id is null then
      raise exception 'Une validation par suppléance doit déclarer la délégation utilisée (I7)'; end if;
    if v_direct then
      new.approved_via_delegation_id := null;
    elsif not exists (
        select 1 from public.approval_delegations d
         where d.id = new.approved_via_delegation_id and d.org_id = old.org_id and d.delegate_id = new.approver_id
           and old.category = any (d.categories) and d.revoked_at is null and d.starts_at <= now() and d.ends_at > now()
           and private._direct_step_match(old.org_id, old.category, d.delegator_id, now())) then
      raise exception 'La délégation déclarée n''est pas valide pour cette validation (I7)';
    end if;
    new.approved_at := now();
  end if;

  if new.status = 'executing' then
    if v_org.frozen_at is not null then raise exception 'Organisation gelée : exécution impossible (SEC-28)'; end if;
    if now() > old.expires_at then raise exception 'Demande expirée'; end if;
    if new.approved_hash is distinct from old.params_hash then raise exception 'L''empreinte validée ne correspond pas à l''action (M12)'; end if;
    -- I5 : le droit de valider est REVÉRIFIÉ au moment d'agir (délégation révoquée, assignation expirée...).
    if not private.is_eligible_approver(old.org_id, old.category, old.approver_id, now()) then
      raise exception 'Le valideur n''est plus éligible au moment de l''exécution (I5)'; end if;
    new.started_at := now();
  end if;

  if new.status = 'expired' and now() <= old.expires_at then
    raise exception 'La demande n''a pas encore expiré'; end if;
  if new.status in ('succeeded', 'failed', 'unknown', 'rejected', 'expired', 'cancelled') then new.finished_at := now(); end if;
  if new.status in ('rejected', 'cancelled') and new.reason is null then raise exception 'Un motif est obligatoire'; end if;
  return new;
end $$;
create trigger action_requests_guard before insert or update on public.action_requests
  for each row execute function private.action_requests_guard();

create function private.action_requests_no_delete() returns trigger
language plpgsql set search_path = '' as
$$ begin raise exception 'Une demande d''action ne se supprime pas (traçabilité)'; end $$;
create trigger action_requests_no_delete before delete on public.action_requests
  for each row execute function private.action_requests_no_delete();

-- ---------------------------------------------------------------------------------------------------------------
-- Compte Microsoft du valideur : l'action s'exécute avec SON identité (flux délégué). Aucun jeton n'est stocké ici.
-- ---------------------------------------------------------------------------------------------------------------
create table public.microsoft_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  connector_id uuid not null references public.connectors (id) on delete cascade,
  tenant_id text not null,
  object_id text not null,
  upn text not null,
  linked_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, connector_id)
);

create function private.microsoft_identities_guard() returns trigger
language plpgsql set search_path = '' as
$$
declare c public.connectors%rowtype;
begin
  select * into c from public.connectors where id = new.connector_id;
  if c.id is null or c.type <> 'm365' then raise exception 'Le connecteur doit être de type m365'; end if;
  if new.org_id <> c.org_id then raise exception 'Le compte doit être lié dans l''organisation du connecteur'; end if;
  if c.tenant_id is not null and new.tenant_id <> c.tenant_id then
    raise exception 'Le compte appartient à un autre tenant Microsoft que celui du connecteur'; end if;
  if tg_op = 'INSERT' and not private.can_act_in_org(new.user_id, new.org_id) then
    raise exception 'Seul un technicien habilité de cette organisation peut lier son compte Microsoft'; end if;
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.connector_id <> old.connector_id or new.object_id <> old.object_id) then
    raise exception 'Le compte lié est immuable : on le révoque et on le lie à nouveau'; end if;
  return new;
end $$;
create trigger microsoft_identities_guard before insert or update on public.microsoft_identities
  for each row execute function private.microsoft_identities_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Départ d'un technicien : tout est révoqué ENSEMBLE (R7). Les sessions d'authentification sont révoquées par l'Edge Function.
-- ---------------------------------------------------------------------------------------------------------------
create function private.offboard_technician(p_partner_org uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare a int; d int; p int; i int; m int;
begin
  update public.partner_assignments pa set revoked_at = now()
    from public.partner_relationships r
   where pa.relationship_id = r.id and r.partner_org_id = p_partner_org and pa.user_id = p_user and pa.revoked_at is null;
  get diagnostics a = row_count;
  update public.approval_delegations set revoked_at = now()
   where revoked_at is null and (delegator_id = p_user or delegate_id = p_user);
  get diagnostics d = row_count;
  update public.approval_policies pol set chain = (
      select coalesce(jsonb_agg(s), '[]'::jsonb) from jsonb_array_elements(pol.chain) s
       where not (s ->> 'kind' = 'user' and s ->> 'user_id' = p_user::text))
   where exists (select 1 from jsonb_array_elements(pol.chain) s where s ->> 'user_id' = p_user::text);
  get diagnostics p = row_count;
  update public.microsoft_identities set revoked_at = now() where user_id = p_user and revoked_at is null;
  get diagnostics i = row_count;
  update public.memberships set status = 'removed' where user_id = p_user and org_id = p_partner_org and status <> 'removed';
  get diagnostics m = row_count;
  return jsonb_build_object('assignments', a, 'delegations', d, 'chains', p, 'microsoft_identities', i, 'memberships', m);
end $$;
revoke all on function private.offboard_technician(uuid, uuid) from public, anon, authenticated;
grant execute on function private.offboard_technician(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Audit, droits, RLS
-- ---------------------------------------------------------------------------------------------------------------
create trigger audit_autonomy_settings after insert or update or delete on public.autonomy_settings
  for each row execute function private.audit_change();
create trigger audit_approval_policies after insert or update or delete on public.approval_policies
  for each row execute function private.audit_change();
create trigger audit_approval_delegations after insert or update or delete on public.approval_delegations
  for each row execute function private.audit_change();
create trigger audit_action_requests after insert or update on public.action_requests
  for each row execute function private.audit_change();
create trigger audit_microsoft_identities after insert or update or delete on public.microsoft_identities
  for each row execute function private.audit_change();

do $$
declare t text;
begin
  foreach t in array array['autonomy_settings', 'approval_policies', 'approval_delegations', 'action_requests', 'microsoft_identities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy autonomy_settings_read on public.autonomy_settings for select to authenticated using (private.can_read_org_config(org_id));
create policy approval_policies_read on public.approval_policies for select to authenticated using (private.can_read_org_config(org_id));
create policy approval_delegations_read on public.approval_delegations for select to authenticated using (
  delegator_id = (select auth.uid()) or delegate_id = (select auth.uid())
  or private.is_member_of(org_id, array['org_admin']) or private.partner_can_access(org_id, 'partner_admin'));
create policy action_requests_read on public.action_requests for select to authenticated using (private.can_read_support_data(org_id));
create policy microsoft_identities_read on public.microsoft_identities for select to authenticated using (
  user_id = (select auth.uid()) or private.is_member_of(org_id, array['org_admin']));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.action_requests;
  end if;
end $$;


-- ====================================================================================================
-- 20261106100800_automatisations_et_qualite.sql
-- ====================================================================================================
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


-- ====================================================================================================
-- 20261106100900_revendeur_et_usage.sql
-- ====================================================================================================
-- Relève IA : prix partenaire et marge de l'ESN, rapports mensuels à sa marque, suivi de l'usage du modèle.
-- Menaces M33, M37, M38 ; SEC-21 (docs/spec-mvp.md § 13).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100800_automatisations_et_qualite.sql.

create function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.memberships m join public.organizations o on o.id = m.org_id and o.type = 'platform'
                 where m.user_id = (select auth.uid()) and m.role = 'super_admin' and m.status = 'active')
$$;

-- Le prix partenaire et la marge appartiennent à l'ESN : le CLIENT ne les voit jamais, dans aucun écran, rapport ni export (M37).
create table public.partner_pricing (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references public.organizations (id) on delete cascade,
  client_org_id uuid not null references public.organizations (id) on delete cascade,
  -- Remise revendeur par paliers selon le volume (décision du fondateur, 6 novembre 2026). Seuils des paliers à fixer.
  discount_percent smallint not null check (discount_percent in (25, 30, 35)),
  public_price_cents int not null check (public_price_cents > 0),
  partner_price_cents int not null check (partner_price_cents > 0),     -- ce que Relève facture à l'ESN
  client_price_cents int not null check (client_price_cents >= 0),      -- ce que l'ESN facture à son client (libre)
  currency text not null default 'EUR' check (currency = 'EUR'),
  starts_at date not null default current_date,
  ends_at date,
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  -- Le prix partenaire est le prix public moins la remise : cohérence imposée par la base.
  check (partner_price_cents = (public_price_cents * (100 - discount_percent)) / 100)
);
create unique index partner_pricing_one_live on public.partner_pricing (partner_org_id, client_org_id) where ends_at is null;

create function private.partner_pricing_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if not exists (select 1 from public.organizations o where o.id = new.partner_org_id and o.type = 'partner') then
    raise exception 'partner_org_id doit désigner une ESN'; end if;
  if not exists (select 1 from public.organizations o where o.id = new.client_org_id and o.type = 'client'
                 and (o.created_via_partner_id = new.partner_org_id
                      or exists (select 1 from public.partner_relationships r where r.client_org_id = o.id and r.partner_org_id = new.partner_org_id))) then
    raise exception 'Ce client n''est pas rattaché à cette ESN'; end if;
  return new;
end $$;
create trigger partner_pricing_guard before insert or update on public.partner_pricing
  for each row execute function private.partner_pricing_guard();
create trigger audit_partner_pricing after insert or update or delete on public.partner_pricing
  for each row execute function private.audit_change();

-- Rapport mensuel à la marque de l'ESN. Il ne contient JAMAIS la marge ni le prix partenaire (M37).
create table public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references public.organizations (id) on delete cascade,
  client_org_id uuid not null references public.organizations (id) on delete cascade,
  period date not null check (extract(day from period) = 1),                         -- premier jour du mois
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'sent')),
  content jsonb not null default '{}'::jsonb
    check (not (content ?| array['margin', 'marge', 'partner_price', 'prix_partenaire', 'client_price_cents', 'partner_price_cents'])),
  branding jsonb not null default '{}'::jsonb,                                       -- marque appliquée au moment de la génération
  reviewed_by uuid references auth.users (id),
  sent_by uuid references auth.users (id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (partner_org_id, client_org_id, period),
  check (status <> 'sent' or (sent_by is not null and sent_at is not null and reviewed_by is not null))
);
create trigger audit_monthly_reports after insert or update or delete on public.monthly_reports
  for each row execute function private.audit_change();

-- Suivi de l'usage du modèle : quotas, coût, délais (aucun contenu).
create table public.llm_usage (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  at timestamptz not null default now(),
  model text not null,
  purpose text not null check (purpose in ('triage', 'answer', 'embedding', 'eval')),
  tokens_in int not null default 0 check (tokens_in >= 0),
  tokens_out int not null default 0 check (tokens_out >= 0),
  latency_ms int check (latency_ms >= 0),
  cost_micro_eur bigint not null default 0 check (cost_micro_eur >= 0)
);
create index llm_usage_org_at_idx on public.llm_usage (org_id, at desc);
create trigger llm_usage_immutable before update on public.llm_usage
  for each row execute function private.immutable_row();

do $$
declare t text;
begin
  foreach t in array array['partner_pricing', 'monthly_reports', 'llm_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Prix et marge : les administrateurs de l'ESN et le super administrateur, personne d'autre (ni le client, ni platform_support).
create policy partner_pricing_read on public.partner_pricing for select to authenticated using (
  private.is_member_of(partner_org_id, array['partner_admin']) or private.is_super_admin());
-- Rapports : l'ESN les voit tous ; le client ne voit que ceux qui lui ont été ENVOYÉS.
create policy monthly_reports_read on public.monthly_reports for select to authenticated using (
  private.is_member_of(partner_org_id, array['partner_admin', 'partner_manager'])
  or (status = 'sent' and private.is_member_of(client_org_id, array['org_admin'])));
create policy llm_usage_read on public.llm_usage for select to authenticated using (
  private.is_member_of(org_id, array['org_admin']) or private.partner_can_access(org_id, 'partner_admin'));


-- ====================================================================================================
-- 20261106101000_conservation.sql
-- ====================================================================================================
-- Relève IA : conservation des données et tâches de maintenance (RGPD : minimisation, durée de conservation).
-- Les durées sont des PROPOSITIONS à valider en J7 avec un juriste (docs/spec-mvp.md § 8).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100900_revendeur_et_usage.sql.

-- Purge : conversations échues (leurs messages partent avec), charges brutes d'alerte anciennes, usage ancien,
-- invitations périmées. Le journal d'audit n'est JAMAIS purgé par cette fonction (il est en insertion seule).
create function private.purge_expired() returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare c int; a int; u int; i int; h int;
begin
  delete from public.conversations where purge_after < now();                       get diagnostics c = row_count;
  update public.alerts set raw = '{}'::jsonb where raw <> '{}'::jsonb and last_seen_at < now() - interval '30 days';
                                                                                     get diagnostics a = row_count;
  delete from public.llm_usage where at < now() - interval '13 months';              get diagnostics u = row_count;
  delete from public.invitations where expires_at < now() - interval '30 days';      get diagnostics i = row_count;
  delete from public.handover_reports where generated_at < now() - interval '12 months'; get diagnostics h = row_count;
  return jsonb_build_object('conversations', c, 'alerts_raw', a, 'llm_usage', u, 'invitations', i, 'handover_reports', h);
end $$;

-- Mise à jour d'état (cosmétique : l'accès, lui, est évalué à la lecture, sans cette tâche).
create function private.expire_stale() returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare r int; p int; d int; s int;
begin
  update public.action_requests set status = 'expired' where status = 'pending_approval' and expires_at < now();
  get diagnostics r = row_count;
  update public.partner_relationships set status = 'expired' where status in ('active', 'reduced') and expires_at <= now();
  get diagnostics p = row_count;
  update public.partner_assignments set revoked_at = now() where revoked_at is null and ends_at <= now();
  get diagnostics d = row_count;
  update public.support_access_grants set revoked_at = now() where revoked_at is null and ends_at is not null and ends_at <= now();
  get diagnostics s = row_count;
  return jsonb_build_object('action_requests', r, 'relationships', p, 'assignments', d, 'support_grants', s);
end $$;
revoke all on function private.purge_expired(), private.expire_stale() from public, anon, authenticated;
grant execute on function private.purge_expired(), private.expire_stale() to service_role;

-- Planification : pg_cron, À ACTIVER dans le tableau de bord (Database, Extensions). Ignoré s'il est absent :
-- la fonction « cron » des Edge Functions appellera alors ces deux fonctions.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('releve-purge', '17 3 * * *', 'select private.purge_expired()');
    perform cron.schedule('releve-expire', '*/10 * * * *', 'select private.expire_stale()');
  end if;
end $$;


-- ====================================================================================================
-- 20261106101100_contexte_de_requete.sql
-- ====================================================================================================
-- Relève IA : contexte de requête pour les Edge Functions (jalon J3).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101000_conservation.sql.
--
-- Deux besoins que les migrations 1 à 10 ne couvraient pas :
--   1. Une Edge Function qui écrit avec la clé service_role contourne la RLS, donc auth.uid() est nul : le journal d'audit
--      ne saurait pas QUI a agi. Désormais, serviceClient(auth) pose des en-têtes (acteur, requête) que la base lit,
--      et SEULEMENT quand la requête porte bien le rôle service_role (un navigateur ne peut pas se faire passer pour un autre).
--   2. requireOrgMember doit savoir, pour un utilisateur et une organisation, quel rôle il y exerce et PAR QUELLE VOIE
--      (membre, ESN, accès d'assistance), avec les règles de la base (relation ET assignation actives, à cet instant).
--      Une seule implémentation de ces règles : la base. Le code TypeScript n'en réécrit aucune.

-- ---------------------------------------------------------------------------------------------------------------
-- En-têtes de requête (PostgREST les expose dans le réglage request.headers)
-- ---------------------------------------------------------------------------------------------------------------
create function private.request_header(p_name text) returns text
language plpgsql stable set search_path = '' as
$$
begin
  return nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> lower(p_name), '');
exception when others then
  return null;          -- en-têtes absents ou malformés : aucun acteur, jamais d'erreur dans un déclencheur d'audit
end $$;

-- Acteur désigné par l'en-tête x-releve-actor : honoré UNIQUEMENT pour une requête service_role (menace M23).
create function private.service_actor() returns uuid
language plpgsql stable security definer set search_path = '' as
$$
declare v text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then return null; end if;
  v := private.request_header('x-releve-actor');
  return case when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end;
end $$;

-- Même déclencheur d'audit qu'en migration 2 (mêmes triggers, même signature), avec l'acteur et l'identifiant de requête.
create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_session uuid := (select auth.uid());
  v_actor uuid := coalesce((select auth.uid()), private.service_actor());
begin
  insert into public.audit_logs (org_id, actor_kind, actor_id, on_behalf_of, event, subject_type, subject_id, details, request_id)
  values (
    coalesce((v_row ->> 'org_id')::uuid, (v_row ->> 'client_org_id')::uuid,
             case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid end),
    case when v_actor is null then 'service' else 'user' end,
    v_actor,
    nullif(current_setting('app.on_behalf_of', true), '')::uuid,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    jsonb_build_object(
      'old', case when tg_op <> 'INSERT' then private.redact_row(to_jsonb(old)) end,
      'new', case when tg_op <> 'DELETE' then private.redact_row(to_jsonb(new)) end,
      'via', case when v_session is null then 'edge_function' end),
    left(private.request_header('x-releve-request-id'), 100)
  );
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Accès d'un utilisateur à une organisation : rôle et voie, évalués à cet instant
-- ---------------------------------------------------------------------------------------------------------------
create function public.resolve_access(p_user uuid, p_org uuid)
returns table (org_role text, via text, org_type text, org_state text, is_frozen boolean, is_activated boolean, read_only boolean)
language plpgsql stable security definer set search_path = '' as
$$
declare
  o public.organizations%rowtype;
  v_role text;
  v_via text;
  v_ro boolean := false;
  r text;
begin
  select * into o from public.organizations where id = p_org;
  if o.id is null or o.state = 'suspended' then return; end if;      -- organisation inconnue ou suspendue : aucun accès

  -- 1. Membre direct
  select m.role into v_role
    from public.memberships m
   where m.user_id = p_user and m.org_id = p_org and m.status = 'active' and (m.ends_at is null or m.ends_at > now());
  if v_role is not null then
    v_via := 'member';
  elsif o.type = 'client' then
    -- 2. Voie ESN, du rôle le plus élevé au plus bas : relation ET (technicien) assignation actives
    foreach r in array array['partner_admin', 'partner_manager', 'partner_technician'] loop
      if private._partner_can_access(p_user, p_org, r) then v_role := r; v_via := 'partner'; exit; end if;
    end loop;
    -- 3. Accès d'assistance de la plateforme : demandé par cette personne, approuvé par le client, dans sa fenêtre. Lecture seule.
    if v_role is null and private.is_platform_staff(p_user) and exists (
         select 1 from public.support_access_grants g
          where g.client_org_id = p_org and g.requested_by = p_user and g.approved_by is not null
            and g.revoked_at is null and g.starts_at <= now() and g.ends_at > now()) then
      select m.role into v_role
        from public.memberships m join public.organizations po on po.id = m.org_id and po.type = 'platform'
       where m.user_id = p_user and m.status = 'active' and m.role in ('super_admin', 'platform_support')
       order by private.role_rank(m.role) desc limit 1;
      v_via := 'support_access'; v_ro := true;
    end if;
  end if;

  if v_role is null then return; end if;
  return query select v_role, v_via, o.type, o.state, o.frozen_at is not null, o.activated_at is not null, v_ro;
end $$;

-- Réservée au service : un navigateur ne doit pas pouvoir sonder les droits d'un autre utilisateur.
revoke all on function public.resolve_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_access(uuid, uuid) to service_role;
revoke all on function private.request_header(text), private.service_actor() from public, anon, authenticated;


-- ====================================================================================================
-- 20261106101200_droits_explicites_du_service.sql
-- ====================================================================================================
-- Relève IA : droits explicites du service sur les tables (indépendants des droits automatiques de la plateforme).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101100_contexte_de_requete.sql. Sans effet visible sur un projet où les droits
-- automatiques sont actifs (le service les avait déjà) ; indispensable sur un projet où l'option « Automatically expose new tables » est
-- désactivée, ce que la plateforme annonce comme futur défaut des nouveaux projets et recommande déjà : sans cette migration, les tables
-- y seraient créées SANS aucun droit pour le service, et toutes les fonctions échoueraient.
--
-- Règle pour les futures migrations : toute NOUVELLE table de public reçoit ses droits explicitement (select pour authenticated si le navigateur
-- la lit ; select, insert, update, delete pour service_role). Le test 80 le vérifie, en CI, sur un projet simulé SANS droits automatiques.

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- Le journal d'audit reste en INSERTION SEULE, même pour le service (menace M18) : on rétablit exactement la migration 2.
revoke all on public.audit_logs from service_role;
grant insert on public.audit_logs to service_role;
grant usage on sequence public.audit_logs_id_seq to service_role;


-- ====================================================================================================
-- 20261106101300_administration_et_debit.sql
-- ====================================================================================================
-- Migration 13 : administration atomique et limitation de débit (jalon J3, blocs 3.9 et 3.10).
--
-- Pourquoi des fonctions SQL ? Une Edge Function ne peut pas ouvrir de transaction : créer un client (organisation +
-- relation + invitation), consommer une invitation (invitation + appartenance), geler une organisation (gel + annulation
-- des demandes en attente) ou retirer un technicien se font EN UNE SEULE instruction, ou pas du tout. Ces fonctions
-- re-vérifient elles-mêmes qui agit (défense en profondeur : la fonction Edge a déjà vérifié le rôle et le second facteur)
-- et ne sont appelables que par le service (jamais par un utilisateur de l'API).
-- Les écritures simples (réduire une relation, assigner un technicien, régler l'autonomie...) restent des écritures
-- ordinaires : les verrous de la base (triggers) les contrôlent déjà.
--
-- Cette migration est à appliquer par le fondateur (éditeur SQL de Supabase), après la 12.

-- ---------------------------------------------------------------------------------------------------------------
-- Plafond de clients d'une ESN (offre partenaire). Valeur par défaut PROVISOIRE : 10, à confirmer par le fondateur.
-- Seul le service (script du super administrateur) peut la modifier : aucune opération d'administration ne la touche.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.organizations add column client_cap int check (client_cap is null or client_cap between 0 and 1000);
alter table public.organizations add constraint organizations_client_cap_only_partner check (client_cap is null or type = 'partner');

create function private.default_client_cap() returns int language sql immutable set search_path = '' as $$ select 10 $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Création d'un client par une ESN (menace M31, histoire E3) : organisation + relation active + invitation du premier
-- administrateur du client, en une transaction. Le jeton d'invitation n'arrive qu'en empreinte (jamais en clair).
-- ---------------------------------------------------------------------------------------------------------------
create function public.admin_create_client(
  p_actor uuid, p_partner_org uuid, p_name text, p_slug text, p_admin_email text, p_token_hash text, p_mfa_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_partner public.organizations%rowtype;
  v_cap int;
  v_count int;
  v_client uuid;
  v_rel uuid;
  v_inv uuid;
begin
  -- Un second facteur récent est exigé ICI AUSSI (la fonction Edge le vérifie déjà).
  if p_mfa_at is null or p_mfa_at < now() - interval '10 minutes' or p_mfa_at > now() + interval '1 minute' then
    raise exception 'Un second facteur de moins de 10 minutes est exigé'; end if;

  -- Verrou sur l'ESN : deux créations simultanées ne dépassent jamais le plafond.
  select * into v_partner from public.organizations where id = p_partner_org and type = 'partner' for update;
  if v_partner.id is null or v_partner.state = 'suspended' then raise exception 'ESN introuvable ou suspendue'; end if;
  if v_partner.frozen_at is not null then raise exception 'Organisation gelée : aucune création'; end if;
  if not private._member(p_actor, p_partner_org, array['partner_admin']) then
    raise exception 'Seul un administrateur de l''ESN peut créer un client'; end if;

  v_cap := coalesce(v_partner.client_cap, private.default_client_cap());
  select count(*) into v_count from public.organizations c where c.created_via_partner_id = p_partner_org;
  if v_count >= v_cap then raise exception 'Plafond de clients atteint (%)', v_cap; end if;

  insert into public.organizations (type, name, slug, plan, state, created_via_partner_id)
    values ('client', p_name, p_slug, 'pilot', 'pilot', p_partner_org) returning id into v_client;
  insert into public.partner_relationships (partner_org_id, client_org_id, status, approved_roles, created_by_partner,
                                            proposed_by, starts_at, expires_at)
    values (p_partner_org, v_client, 'active', array['partner_admin', 'partner_technician'], true, p_actor,
            now(), now() + interval '12 months') returning id into v_rel;
  insert into public.invitations (org_id, email, role, token_hash, invited_by, expires_at)
    values (v_client, lower(p_admin_email), 'org_admin', p_token_hash, p_actor, now() + interval '7 days') returning id into v_inv;

  return jsonb_build_object('client_org_id', v_client, 'relationship_id', v_rel, 'invitation_id', v_inv);
end $$;
revoke all on function public.admin_create_client(uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_create_client(uuid, uuid, text, text, text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Acceptation d'une invitation (menace M29) : usage unique, expirante, rôle fixé à la création, adresse vérifiée.
-- Toute cause de refus donne le MÊME message : on ne dit pas si le jeton existe, a servi ou a expiré.
-- ---------------------------------------------------------------------------------------------------------------
create function public.admin_accept_invitation(p_user uuid, p_email text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  i public.invitations%rowtype;
  v_n int;
begin
  select * into i from public.invitations where token_hash = p_token_hash for update;
  if i.id is null or i.used_at is not null or i.expires_at <= now() or i.email is distinct from lower(coalesce(p_email, ''))
     or not exists (select 1 from public.organizations o where o.id = i.org_id and o.state <> 'suspended') then
    raise exception 'Invitation invalide ou expirée'; end if;

  -- Réactive une appartenance retirée ou invitée ; une appartenance déjà active n'est jamais modifiée.
  insert into public.memberships (user_id, org_id, role, status, created_by)
    values (p_user, i.org_id, i.role, 'active', i.invited_by)
    on conflict (user_id, org_id) do update set role = excluded.role, status = 'active'
      where public.memberships.status in ('invited', 'removed', 'suspended');
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Vous êtes déjà membre de cette organisation'; end if;

  update public.invitations set used_at = now(), used_by = p_user where id = i.id;
  return jsonb_build_object('org_id', i.org_id, 'role', i.role);
end $$;
revoke all on function public.admin_accept_invitation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_accept_invitation(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Arrêt d'urgence (ANSSI, principe 6 ; spec § 9.7). Geler = marquer l'organisation ET annuler les demandes en attente
-- ou approuvées non exécutées ; dégeler = lever le gel (les demandes annulées ne reviennent jamais).
-- Gèle : administrateur du client, administrateur de l'ESN (voie ESN) ou super administrateur. Dégèle : administrateur
-- du client (ou de l'ESN pour sa propre organisation) ou super administrateur ; le second facteur est exigé côté fonction Edge.
-- ---------------------------------------------------------------------------------------------------------------
create function public.admin_set_freeze(p_actor uuid, p_org uuid, p_frozen boolean) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  o public.organizations%rowtype;
  v_super boolean;
  v_allowed boolean;
  v_cancelled int := 0;
begin
  select * into o from public.organizations where id = p_org for update;
  if o.id is null or o.type = 'platform' then raise exception 'Organisation introuvable'; end if;

  select exists (select 1 from public.memberships m join public.organizations pl on pl.id = m.org_id and pl.type = 'platform'
                  where m.user_id = p_actor and m.role = 'super_admin' and m.status = 'active') into v_super;
  v_allowed := v_super
    or private._member(p_actor, p_org, array['org_admin', 'partner_admin'])
    or (p_frozen and o.type = 'client' and private._partner_can_access(p_actor, p_org, 'partner_admin'));
  if not v_allowed then raise exception 'Droits insuffisants pour cette organisation'; end if;

  if p_frozen then
    update public.organizations set frozen_at = coalesce(frozen_at, now()), frozen_by = coalesce(frozen_by, p_actor) where id = p_org;
    update public.action_requests set status = 'cancelled', reason = 'Arrêt d''urgence de l''organisation'
      where org_id = p_org and status in ('pending_approval', 'approved');
    get diagnostics v_cancelled = row_count;
  else
    update public.organizations set frozen_at = null, frozen_by = null where id = p_org;
  end if;
  return jsonb_build_object('frozen', p_frozen, 'cancelled_actions', v_cancelled);
end $$;
revoke all on function public.admin_set_freeze(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_freeze(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Départ d'un technicien de l'ESN (invariant R7) : assignations, délégations, places de valideur, compte Microsoft lié
-- et appartenance sont révoqués ensemble (private.offboard_technician) ; un administrateur ne se retire pas lui-même ici.
-- ---------------------------------------------------------------------------------------------------------------
create function public.admin_offboard_technician(p_actor uuid, p_partner_org uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
begin
  if p_actor = p_user then raise exception 'On ne se retire pas soi-même'; end if;
  if not private._member(p_actor, p_partner_org, array['partner_admin']) then
    raise exception 'Seul un administrateur de l''ESN peut retirer un technicien'; end if;
  if not exists (select 1 from public.memberships m where m.user_id = p_user and m.org_id = p_partner_org
                   and m.role in ('partner_technician', 'partner_manager') and m.status = 'active') then
    raise exception 'Ce technicien n''appartient pas à l''ESN'; end if;
  return private.offboard_technician(p_partner_org, p_user);
end $$;
revoke all on function public.admin_offboard_technician(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_offboard_technician(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Limitation de débit (menace M10, SEC-24). Fenêtre fixe : au plus p_limit appels par clé et par fenêtre. La clé est
-- posée par la fonction Edge (« utilisateur:... », « organisation:... »), jamais fournie par le client. Les lignes
-- de plus d'un jour sont purgées au passage (1 appel sur 100), sans tâche planifiée supplémentaire.
-- ---------------------------------------------------------------------------------------------------------------
create table public.rate_limits (
  key text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;       -- aucune policy : personne, sauf le service
revoke all on public.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

create function public.rate_limit_hit(p_key text, p_window_seconds int, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as
$$
declare
  v_window timestamptz;
  v_hits int;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 or p_window_seconds not between 1 and 86400 or p_limit not between 1 and 100000 then
    raise exception 'Paramètres de limitation invalides'; end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, v_window, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning r.hits into v_hits;
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  return v_hits <= p_limit;
end $$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;


-- ====================================================================================================
-- 20261106101400_secrets_et_webhooks.sql
-- ====================================================================================================
-- Migration 14 : accès du SERVICE aux secrets (connecteurs, sources d'alertes) et protection contre le rejeu des webhooks (jalon J4).
--
-- Pourquoi ? Les fonctions de lecture et d'écriture des secrets (coffre Vault) vivent dans le schéma « private », que l'API n'expose pas :
-- une Edge Function ne peut pas les appeler. On ajoute des fonctions PUBLIQUES minces, réservées au service (jamais au navigateur ni
-- à l'anonyme), qui re-vérifient que le secret demandé appartient bien à l'organisation indiquée. Aucune ne renvoie un secret à un
-- utilisateur de l'API ; aucun secret n'est jamais écrit dans le journal d'audit.
--
-- Cette migration est à appliquer par le fondateur (éditeur SQL de Supabase), après la 13.

-- ---------------------------------------------------------------------------------------------------------------
-- Secrets des connecteurs (GLPI : jeton utilisateur et jeton d'application ; Microsoft 365 n'en a pas : flux délégué)
-- ---------------------------------------------------------------------------------------------------------------
create function public.connector_secret_get(p_org uuid, p_connector uuid) returns text
language plpgsql security definer set search_path = '' as
$$
begin
  if not exists (select 1 from public.connectors c where c.id = p_connector and c.org_id = p_org and c.status <> 'disabled') then
    raise exception 'Connecteur introuvable'; end if;
  return private.read_connector_secret(p_connector);
end $$;
revoke all on function public.connector_secret_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connector_secret_get(uuid, uuid) to service_role;

create function public.connector_secret_set(p_org uuid, p_connector uuid, p_secret text) returns boolean
language plpgsql security definer set search_path = '' as
$$
begin
  if not exists (select 1 from public.connectors c where c.id = p_connector and c.org_id = p_org and c.status <> 'disabled') then
    raise exception 'Connecteur introuvable'; end if;
  perform private.store_connector_secret(p_connector, p_secret);   -- refuse un secret vide ou trop court
  return true;
end $$;
revoke all on function public.connector_secret_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.connector_secret_set(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Secrets des sources d'alertes (secret HMAC du webhook)
-- ---------------------------------------------------------------------------------------------------------------
create function public.alert_source_secret_set(p_org uuid, p_source uuid, p_secret text) returns boolean
language plpgsql security definer set search_path = '' as
$$
begin
  if not exists (select 1 from public.alert_sources a where a.id = p_source and a.org_id = p_org) then
    raise exception 'Source introuvable'; end if;
  perform private.store_alert_source_secret(p_source, p_secret);   -- refuse un secret de moins de 32 caractères
  return true;
end $$;
revoke all on function public.alert_source_secret_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.alert_source_secret_set(uuid, uuid, text) to service_role;

-- Réception d'un webhook : AVANT de savoir qui appelle, la fonction `alerts-ingest` doit retrouver le secret de la source désignée dans
-- l'adresse pour vérifier la signature. Cette fonction ne renvoie des informations que pour une source ACTIVE qui a un secret, et rien
-- d'autre : une source inconnue, désactivée ou sans secret donne le même résultat vide.
create function public.alert_source_for_webhook(p_source uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  a public.alert_sources%rowtype;
  o public.organizations%rowtype;
begin
  select * into a from public.alert_sources where id = p_source and status = 'active' and vault_secret_id is not null;
  if a.id is null then return null; end if;
  select * into o from public.organizations where id = a.org_id and state <> 'suspended';
  if o.id is null then return null; end if;
  -- frozen / activated : l'état de l'organisation, pour le contexte de la requête (arrêt d'urgence : alertes conservées, aucune automatisation).
  return jsonb_build_object('org_id', a.org_id, 'secret', private.read_alert_source_secret(a.id),
                            'severity_map', a.severity_map, 'field_mapping', a.field_mapping,
                            'frozen', o.frozen_at is not null, 'activated', o.activated_at is not null);
end $$;
revoke all on function public.alert_source_for_webhook(uuid) from public, anon, authenticated;
grant execute on function public.alert_source_for_webhook(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Rejeu d'un webhook (SEC-17) : une livraison (empreinte de la signature et de l'horodatage) ne se présente qu'UNE fois dans sa
-- fenêtre de validité. Les empreintes de plus d'une heure sont purgées au passage (1 appel sur 50).
-- ---------------------------------------------------------------------------------------------------------------
create table public.webhook_deliveries (
  source_id uuid not null references public.alert_sources (id) on delete cascade,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  primary key (source_id, digest)
);
alter table public.webhook_deliveries enable row level security;   -- aucune policy : personne, sauf le service
revoke all on public.webhook_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.webhook_deliveries to service_role;

-- Renvoie vrai la PREMIÈRE fois qu'une livraison est présentée, faux ensuite (rejeu).
create function public.webhook_first_delivery(p_source uuid, p_digest text) returns boolean
language plpgsql security definer set search_path = '' as
$$
declare v_n int;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte invalide'; end if;
  insert into public.webhook_deliveries (source_id, digest) values (p_source, p_digest) on conflict do nothing;
  get diagnostics v_n = row_count;
  if random() < 0.02 then delete from public.webhook_deliveries where received_at < now() - interval '1 hour'; end if;
  return v_n = 1;
end $$;
revoke all on function public.webhook_first_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.webhook_first_delivery(uuid, text) to service_role;


-- ====================================================================================================
-- 20261106101500_ingestion_des_alertes.sql
-- ====================================================================================================
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


-- ====================================================================================================
-- 20261106101600_second_facteur_obligatoire.sql
-- ====================================================================================================
-- Relève IA : le second facteur est exigé pour TOUTE lecture ou écriture directe de la base par le navigateur.
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101500_ingestion_des_alertes.sql.
--
-- Pourquoi (revue de sécurité de J5, SEC-33, menace M15) : Supabase envoie un code de connexion à usage unique à toute adresse
-- DÉJÀ CONNUE qui le demande (point d'accès public de connexion par e-mail). Une personne qui lit la boîte mail d'un technicien
-- obtiendrait donc une session SANS second facteur (aal1) et, jusqu'ici, la sécurité par ligne la laissait lire les conversations,
-- tickets et alertes des clients de ce technicien. Désormais :
--   - chaque table de public reçoit une politique RESTRICTIVE qui exige une session avec second facteur (aal2). Une politique
--     restrictive s'ajoute aux autres (ET logique) : aucune politique existante ne peut l'élargir ;
--   - le salarié, qui se connecte par code (aal1), ne lit plus rien directement : tout passe par la fonction `chat`, qui le borne
--     à ses propres demandes et ne lui montre que les messages publics (ce qu'elle faisait déjà pour l'écriture) ;
--   - côté fonctions, `requireOrgMember` refuse tout rôle autre que salarié sans second facteur (même défense, deuxième couche).
-- Règle pour les futures migrations : toute nouvelle table de public reçoit la même politique (le test 93 le vérifie).

create function private.session_has_second_factor() returns boolean
language sql stable set search_path = '' as
$$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
           order by c.relname loop
    -- « (select …) » : évaluée une fois par requête, pas une fois par ligne.
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select private.session_has_second_factor())) with check ((select private.session_has_second_factor()))',
      t || '_second_facteur', t);
  end loop;
end $$;


-- ====================================================================================================
-- 20261106101700_widget_salarie.sql
-- ====================================================================================================
-- Relève IA : lectures du widget salarié, et rattachement du salarié à sa première connexion (jalon J5).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101600_second_facteur_obligatoire.sql.
--
-- Depuis la migration 16, le salarié (connexion par code, sans second facteur) ne lit plus rien directement : la fonction `chat`
-- lit pour lui avec les fonctions ci-dessous. Toutes sont RÉSERVÉES AU SERVICE (ni le navigateur ni l'anonyme ne peuvent les
-- appeler) et toutes sont bornées au couple (organisation, demandeur) que le code tire du contexte vérifié, jamais de la requête.
-- Elles ne renvoient JAMAIS : un message réservé aux techniciens (mode ombre, notes internes), le titre ou le texte d'une alerte,
-- l'adresse e-mail d'un technicien. Chacune revérifie que le demandeur est bien salarié actif de l'organisation.

-- Prénom affichable d'une personne : premier mot de son nom, sans ce qui suivrait un « @ », sans caractère de contrôle, 40 au plus.
create function private.first_name(p_full text) returns text
language sql immutable set search_path = '' as
$$ select nullif(left(regexp_replace(split_part(split_part(btrim(coalesce(p_full, '')), ' ', 1), '@', 1), '[[:cntrl:]]', '', 'g'), 40), '') $$;

-- Couleur d'accent d'une marque : « #RRGGBB » seulement ; toute autre valeur est ignorée.
create function private.valid_accent(p text) returns text
language sql immutable set search_path = '' as
$$ select case when p ~ '^#[0-9A-Fa-f]{6}$' then lower(p) end $$;

-- Organisation désignée par l'adresse du widget (/w/<organisation>) : un client activé, non suspendu. Sinon : rien.
create function private.widget_org(p_slug text) returns public.organizations
language sql stable security definer set search_path = '' as
$$ select o.* from public.organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.type = 'client' and o.activated_at is not null and o.state <> 'suspended' $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Avant connexion : nom et couleur de l'organisation (pour l'écran de connexion), et rien d'autre.
-- ---------------------------------------------------------------------------------------------------------------
create function public.widget_public_org(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare v_org public.organizations%rowtype;
begin
  v_org := private.widget_org(p_slug);
  if v_org.id is null then return null; end if;
  return jsonb_build_object('name', v_org.name, 'accent', coalesce(private.valid_accent(v_org.branding ->> 'accent'),
    (select private.valid_accent(p.branding ->> 'accent') from public.organizations p where p.id = v_org.created_via_partner_id)));
end $$;

-- Un code de connexion peut-il partir vers cette adresse ? Seulement si elle figure, active, dans la liste des salariés importée
-- par le client (vérifié AVANT l'envoi, spec § 5.3), et si cette personne n'a pas dans cette organisation un rôle du personnel
-- (elle passe par la console, avec second facteur) ni un accès suspendu ou retiré. Renvoie l'organisation, sinon null.
-- La fonction répond pareil, du point de vue de l'appelant, que l'adresse soit inconnue ou refusée : la fonction Edge renvoie
-- toujours la même réponse au navigateur.
create function public.widget_code_allowed(p_slug text, p_email text) returns uuid
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  v_org := private.widget_org(p_slug);
  if v_org.id is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  if not exists (select 1 from public.directory_users d where d.org_id = v_org.id and d.email = v_email and d.active) then return null; end if;
  if exists (select 1 from auth.users u join public.memberships m on m.user_id = u.id and m.org_id = v_org.id
             where lower(u.email) = v_email and (m.role <> 'end_user' or m.status <> 'active')) then return null; end if;
  return v_org.id;
end $$;

-- Première connexion (et suivantes) : rattache le compte qui vient de prouver son adresse à la ligne de l'annuaire et lui donne le
-- rôle salarié dans CETTE organisation. L'adresse est lue dans le compte (auth.users), jamais reçue de la requête. Idempotent.
-- Renvoie l'organisation, ou null (adresse absente ou inactive dans l'annuaire, ligne déjà rattachée à un AUTRE compte, rôle du
-- personnel dans cette organisation, accès retiré).
create function public.widget_employee_link(p_slug text, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_email text;
  v_dir public.directory_users%rowtype;
  v_member public.memberships%rowtype;
begin
  v_org := private.widget_org(p_slug);
  if v_org.id is null or p_user is null then return null; end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is null then return null; end if;
  select * into v_dir from public.directory_users d where d.org_id = v_org.id and d.email = v_email and d.active for update;
  if v_dir.id is null or (v_dir.linked_user_id is not null and v_dir.linked_user_id <> p_user) then return null; end if;
  select * into v_member from public.memberships m where m.user_id = p_user and m.org_id = v_org.id for update;
  if v_member.id is not null then
    if v_member.role <> 'end_user' or v_member.status = 'removed' then return null; end if;
    -- Un salarié suspendu parce qu'il avait disparu de l'annuaire, puis réimporté actif, retrouve son accès.
    if v_member.status <> 'active' then update public.memberships set status = 'active' where id = v_member.id; end if;
  else
    insert into public.memberships (user_id, org_id, role, status) values (p_user, v_org.id, 'end_user', 'active');
  end if;
  if v_dir.linked_user_id is null then update public.directory_users set linked_user_id = p_user where id = v_dir.id; end if;
  return v_org.id;
end $$;

-- Un salarié retiré de l'annuaire (ou désactivé) perd aussitôt l'accès au widget : son appartenance « salarié » est suspendue.
create function private.directory_users_offboard() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare v_user uuid := case when tg_op = 'DELETE' then old.linked_user_id else coalesce(old.linked_user_id, new.linked_user_id) end;
begin
  if v_user is not null and (tg_op = 'DELETE' or (old.active and not new.active)) then
    update public.memberships set status = 'suspended'
     where user_id = v_user and org_id = old.org_id and role = 'end_user' and status = 'active';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger directory_users_offboard after update or delete on public.directory_users
  for each row execute function private.directory_users_offboard();

-- ---------------------------------------------------------------------------------------------------------------
-- Après connexion : ce que le widget montre au salarié.
-- ---------------------------------------------------------------------------------------------------------------
-- Contexte : nom de l'organisation et couleur, prénom du salarié, fin de la relève en cours (créneaux enchaînés), incidents
-- MAJEURS ou CRITIQUES en cours (identifiant, catégorie, heure : jamais leur titre, qui peut reprendre le texte d'une alerte).
create function public.widget_context(p_org uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_until timestamptz;
  v_next timestamptz;
begin
  if not private._member(p_user, p_org, array['end_user']) then return null; end if;
  select * into v_org from public.organizations o where o.id = p_org and o.type = 'client';
  if v_org.id is null then return null; end if;
  select max(s.ends_at) into v_until from public.relief_schedules s
   where s.org_id = p_org and s.kind in ('absence', 'night', 'leave') and s.starts_at <= now() and s.ends_at > now();
  for i in 1..10 loop                     -- créneaux qui se suivent ou se chevauchent : la relève dure jusqu'au dernier
    exit when v_until is null;
    select max(s.ends_at) into v_next from public.relief_schedules s
     where s.org_id = p_org and s.kind in ('absence', 'night', 'leave') and s.starts_at <= v_until and s.ends_at > v_until;
    exit when v_next is null;
    v_until := v_next;
  end loop;
  return jsonb_build_object(
    'org_name', v_org.name,
    'accent', coalesce(private.valid_accent(v_org.branding ->> 'accent'),
                       (select private.valid_accent(p.branding ->> 'accent') from public.organizations p where p.id = v_org.created_via_partner_id)),
    'first_name', (select private.first_name(d.display_name) from public.directory_users d
                    where d.org_id = p_org and d.linked_user_id = p_user and d.active limit 1),
    'relief_until', v_until,
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'category', coalesce(i.category, 'other'), 'since', i.opened_at)
                                            order by i.opened_at desc)
                           from (select * from public.incidents x
                                  where x.org_id = p_org and x.state in ('open', 'mitigated') and x.severity in ('major', 'critical')
                                  order by x.opened_at desc limit 5) i), '[]'::jsonb));
end $$;

-- Ses demandes, les plus récentes d'abord : premier message du salarié (titre), dernier message PUBLIC (aperçu).
create function public.widget_requests(p_org uuid, p_user uuid, p_limit int default 30)
returns table (id uuid, state text, category text, updated_at timestamptz, title text, last_line text)
language sql stable security definer set search_path = '' as
$$
  select c.id, c.state, c.category, greatest(c.updated_at, coalesce(l.created_at, c.updated_at)),
         (select left(regexp_replace(f.content, '\s+', ' ', 'g'), 120) from public.messages f
           where f.conversation_id = c.id and f.org_id = p_org and f.visibility = 'public' and f.role = 'user'
           order by f.created_at, f.id limit 1),
         left(regexp_replace(l.content, '\s+', ' ', 'g'), 200)
  from public.conversations c
  left join lateral (select m.content, m.created_at from public.messages m
                      where m.conversation_id = c.id and m.org_id = p_org and m.visibility = 'public'
                      order by m.created_at desc, m.id desc limit 1) l on true
  where c.org_id = p_org and c.requester_user_id = p_user and private._member(p_user, p_org, array['end_user'])
  order by 4 desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- Une demande : ses messages PUBLICS (les 200 derniers, dans l'ordre), avec le prénom du technicien pour un message humain.
create function public.widget_conversation(p_org uuid, p_user uuid, p_conversation uuid) returns jsonb
language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object(
    'id', c.id, 'state', c.state, 'category', c.category, 'satisfaction', c.satisfaction, 'resolution', c.resolution,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'role', m.role, 'content', m.content, 'at', m.created_at,
               'author', case when m.role = 'technician'
                              then (select private.first_name(u.raw_user_meta_data ->> 'full_name') from auth.users u where u.id = m.author_id) end)
             order by m.created_at, m.id)
      from (select * from public.messages x
             where x.conversation_id = c.id and x.org_id = p_org and x.visibility = 'public'
             order by x.created_at desc, x.id desc limit 200) m), '[]'::jsonb))
  from public.conversations c
  where c.id = p_conversation and c.org_id = p_org and c.requester_user_id = p_user and private._member(p_user, p_org, array['end_user'])
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Droits : le service seulement.
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.widget_public_org(text), public.widget_code_allowed(text, text), public.widget_employee_link(text, uuid),
  public.widget_context(uuid, uuid), public.widget_requests(uuid, uuid, int), public.widget_conversation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.widget_public_org(text), public.widget_code_allowed(text, text), public.widget_employee_link(text, uuid),
  public.widget_context(uuid, uuid), public.widget_requests(uuid, uuid, int), public.widget_conversation(uuid, uuid, uuid)
  to service_role;
revoke all on function private.first_name(text), private.valid_accent(text), private.widget_org(text), private.directory_users_offboard()
  from public, anon, authenticated;


-- ====================================================================================================
-- 20261106101800_tableaux_de_bord.sql
-- ====================================================================================================
-- Relève IA : chiffres des tableaux de bord (jalon J5) : état du support et « Qualité de Relève » d'un client, tableau des
-- clients d'une ESN. MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101700_widget_salarie.sql.
--
-- Règle (SEC-26, menace M33) : ces fonctions ne renvoient QUE des comptes, des médianes, des moyennes et des états. Jamais un
-- texte de demande, de réponse, de note ou d'alerte, jamais une adresse. Un administrateur d'ESN pilote ses clients sans lire
-- leurs conversations (il n'en a pas le droit : can_read_support_data ne le lui donne pas).
-- Appelées par le navigateur : second facteur exigé (comme toute lecture depuis la migration 16) et droit vérifié à l'intérieur.

create function private.dashboard_denied() returns void
language plpgsql set search_path = '' as
$$ begin raise exception 'Accès refusé' using errcode = '42501'; end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Un client : état du support (fenêtre de p_days jours) et qualité par catégorie (notes des 90 derniers jours).
-- Lisible par qui lit la configuration du client : son administrateur, ses techniciens, l'ESN en relation (administrateur,
-- responsable de compte, technicien assigné). Pas par un accès d'assistance : il sert à enquêter, pas à piloter.
-- ---------------------------------------------------------------------------------------------------------------
create function public.dashboard_org_summary(p_org uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := now() - least(greatest(coalesce(p_days, 30), 1), 365) * interval '1 day';
  v_support jsonb;
  v_categories jsonb;
begin
  if not (private.session_has_second_factor() and private.can_read_org_config(p_org)) then perform private.dashboard_denied(); end if;

  with c as (
    select x.*, (select min(m.created_at) from public.messages m
                  where m.conversation_id = x.id and m.org_id = p_org and m.visibility = 'public' and m.role in ('assistant', 'technician')) as first_answer_at
    from public.conversations x where x.org_id = p_org and x.created_at >= v_since)
  select jsonb_build_object(
    'conversations', count(*),
    'resolved_by_releve', count(*) filter (where resolution = 'ai_confirmed'),
    'resolved_by_team', count(*) filter (where state in ('resolved', 'closed') and resolution is distinct from 'ai_confirmed'),
    'waiting_technician', count(*) filter (where state = 'waiting_technician'),
    'waiting_user', count(*) filter (where state = 'waiting_user'),
    'escalated', count(*) filter (where escalated_at is not null),
    'during_relief', count(*) filter (where relief_active),
    'first_answer_median_seconds', round((percentile_cont(0.5) within group (order by extract(epoch from first_answer_at - created_at)))::numeric),
    'first_answer_n', count(first_answer_at),
    'resolution_median_minutes', round((percentile_cont(0.5) within group (order by extract(epoch from resolved_at - created_at) / 60))::numeric),
    'resolution_n', count(resolved_at),
    'satisfaction_avg', round(avg(satisfaction)::numeric, 2),
    'satisfaction_n', count(satisfaction))
  into v_support from c;

  select coalesce(jsonb_agg(jsonb_build_object(
           'category', k.category,
           'gate', coalesce((select g.state from public.category_gates g where g.org_id = p_org and g.category = k.category), 'shadow'),
           'stats', private.category_stats(p_org, k.category, 90),
           'bars_met', private.category_bars_met(p_org, k.category),
           'conversations', (select count(*) from public.conversations x where x.org_id = p_org and x.category = k.category and x.created_at >= v_since))
         order by k.ord), '[]'::jsonb)
  into v_categories
  from unnest(private.categories()) with ordinality as k(category, ord);

  return jsonb_build_object('days', v_days, 'support', v_support, 'categories', v_categories);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Une ESN : une ligne par client en relation vivante, triable par urgence. Réservé à l'administrateur et au responsable de
-- compte de CETTE ESN, et seulement pour les clients dont la relation approuve son rôle.
-- ---------------------------------------------------------------------------------------------------------------
create function public.dashboard_partner_clients(p_partner uuid)
returns table (
  org_id uuid, name text, slug text, labels text[], org_state text, frozen boolean, activated boolean,
  relationship_status text, relationship_expires_at timestamptz,
  relief_active boolean, relief_until timestamptz, absences_90d int,
  open_incidents int, major_incidents int, pending_actions int, waiting_technician int, sla_at_risk int, connectors_in_error int,
  conversations_30d int, resolved_by_releve_30d int, satisfaction_avg_30d numeric, satisfaction_n_30d int,
  assigned_technicians int, client_price_cents int, partner_price_cents int)
language plpgsql stable security definer set search_path = '' as
$$
declare v_role text;
begin
  select m.role into v_role from public.memberships m
   where m.user_id = (select auth.uid()) and m.org_id = p_partner and m.status = 'active' and (m.ends_at is null or m.ends_at > now())
     and m.role in ('partner_admin', 'partner_manager');
  if not private.session_has_second_factor() or v_role is null then perform private.dashboard_denied(); end if;

  return query
  select o.id, o.name, o.slug, o.labels, o.state, o.frozen_at is not null, o.activated_at is not null,
         r.status, r.expires_at,
         private.relief_active(o.id),
         (select max(s.ends_at) from public.relief_schedules s where s.org_id = o.id and s.kind in ('absence', 'night', 'leave')
            and s.starts_at <= now() and s.ends_at > now()),
         (select count(*)::int from public.relief_schedules s where s.org_id = o.id and s.kind in ('absence', 'leave')
            and s.starts_at >= now() - interval '90 days'),
         (select count(*)::int from public.incidents i where i.org_id = o.id and i.state in ('open', 'mitigated')),
         (select count(*)::int from public.incidents i where i.org_id = o.id and i.state in ('open', 'mitigated') and i.severity in ('major', 'critical')),
         (select count(*)::int from public.action_requests a where a.org_id = o.id and a.status = 'pending_approval' and a.expires_at > now()),
         (select count(*)::int from public.conversations c where c.org_id = o.id and c.state = 'waiting_technician'),
         (select count(*)::int from public.tickets t where t.org_id = o.id and t.status in ('new', 'open', 'pending')
            and t.sla_due_at is not null and t.sla_due_at < now() + interval '2 hours'),
         (select count(*)::int from public.connectors k where k.org_id = o.id and k.status = 'error'),
         (select count(*)::int from public.conversations c where c.org_id = o.id and c.created_at >= now() - interval '30 days'),
         (select count(*)::int from public.conversations c where c.org_id = o.id and c.created_at >= now() - interval '30 days' and c.resolution = 'ai_confirmed'),
         (select round(avg(c.satisfaction)::numeric, 2) from public.conversations c where c.org_id = o.id and c.created_at >= now() - interval '30 days'),
         (select count(c.satisfaction)::int from public.conversations c where c.org_id = o.id and c.created_at >= now() - interval '30 days'),
         (select count(distinct a.user_id)::int from public.partner_assignments a where a.relationship_id = r.id and a.revoked_at is null
            and a.starts_at <= now() and a.ends_at > now()),
         p.client_price_cents, p.partner_price_cents
  from public.partner_relationships r
  join public.organizations o on o.id = r.client_org_id
  left join public.partner_pricing p on p.partner_org_id = p_partner and p.client_org_id = o.id and p.ends_at is null
  where r.partner_org_id = p_partner and r.status in ('active', 'reduced') and r.revoked_at is null
    and r.starts_at <= now() and r.expires_at > now()
    and v_role = any (r.approved_roles)
  order by o.name;
end $$;

revoke all on function public.dashboard_org_summary(uuid, int), public.dashboard_partner_clients(uuid) from public, anon;
grant execute on function public.dashboard_org_summary(uuid, int), public.dashboard_partner_clients(uuid) to authenticated, service_role;
revoke all on function private.dashboard_denied() from public, anon;

commit;
