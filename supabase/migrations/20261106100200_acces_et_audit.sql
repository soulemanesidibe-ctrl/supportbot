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
