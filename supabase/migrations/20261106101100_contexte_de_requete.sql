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
