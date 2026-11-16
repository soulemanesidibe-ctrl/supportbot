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
