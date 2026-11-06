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
