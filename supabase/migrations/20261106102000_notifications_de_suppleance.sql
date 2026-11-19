-- Relève IA : la suppléance est NOTIFIÉE, pas seulement journalisée (invariants I7 et I9 du modèle de menace, jalon J6).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101900_acces_administrateur.sql.
--
-- Constat de J6 : la création, la révocation et l'usage d'une délégation étaient inscrits au journal d'audit (migration 7), mais
-- personne n'en était prévenu. Or une délégation créée par un compte volé (S2) ou une réattribution abusive par un administrateur (S8)
-- ne se voit que si les personnes concernées en sont averties. Désormais, à chaque création, révocation ou usage d'une délégation,
-- une notification part vers :
--   - chaque administrateur actif du client ;
--   - le valideur remplacé (le délégant) ;
-- sauf vers la personne qui vient de faire l'opération (elle le sait). La notification ne contient que des identifiants, des
-- catégories et des dates : ni adresse de messagerie, ni cible de l'action, ni texte de conversation. Elle est écrite par la base
-- elle-même (déclencheur), donc aucun chemin applicatif ne peut l'oublier.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'incident_opened', 'incident_resolved', 'source_silent', 'delegation_created', 'delegation_revoked', 'delegation_used'));
alter table public.notifications drop constraint notifications_subject_type_check;
alter table public.notifications add constraint notifications_subject_type_check check (subject_type in (
  'incident', 'alert', 'delegation', 'action_request'));

-- Destinataires : administrateurs actifs du client et délégant, moins l'auteur de l'opération.
create function private.delegation_recipients(p_org uuid, p_delegator uuid, p_actor uuid) returns table (user_id uuid)
language sql stable security definer set search_path = '' as
$$
  select distinct r.user_id from (
    select m.user_id from public.memberships m
     where m.org_id = p_org and m.role = 'org_admin' and m.status = 'active' and (m.ends_at is null or m.ends_at > now())
    union
    select p_delegator
  ) r
  where r.user_id is distinct from p_actor
$$;
revoke all on function private.delegation_recipients(uuid, uuid, uuid) from public, anon, authenticated;

create function private.notify_delegation_change() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare
  v_kind text;
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    v_kind := 'delegation_created'; v_actor := new.created_by;
  elsif new.revoked_at is not null and old.revoked_at is null then
    v_kind := 'delegation_revoked'; v_actor := new.revoked_by;
  else
    return new;
  end if;
  insert into public.notifications (org_id, recipient_user_id, kind, subject_type, subject_id, payload)
  select new.org_id, r.user_id, v_kind, 'delegation', new.id,
         jsonb_build_object('delegation_id', new.id, 'delegator_id', new.delegator_id, 'delegate_id', new.delegate_id,
                            'categories', to_jsonb(new.categories), 'starts_at', new.starts_at, 'ends_at', new.ends_at,
                            'by', v_actor, 'reassignment', new.created_by <> new.delegator_id)
    from private.delegation_recipients(new.org_id, new.delegator_id, v_actor) r
  on conflict (recipient_user_id, kind, subject_id) do nothing;
  return new;
end $$;
revoke all on function private.notify_delegation_change() from public, anon, authenticated;
create trigger notify_approval_delegations after insert or update of revoked_at on public.approval_delegations
  for each row execute function private.notify_delegation_change();

-- Usage : une demande validée PAR SUPPLÉANCE prévient les mêmes personnes (le délégant voit ce qui a été fait en son nom).
create function private.notify_delegation_use() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare d public.approval_delegations%rowtype;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.approved_via_delegation_id is not null then
    select * into d from public.approval_delegations where id = new.approved_via_delegation_id;
    insert into public.notifications (org_id, recipient_user_id, kind, subject_type, subject_id, payload)
    select new.org_id, r.user_id, 'delegation_used', 'action_request', new.id,
           jsonb_build_object('delegation_id', d.id, 'delegator_id', d.delegator_id, 'approver_id', new.approver_id,
                              'capability', new.capability, 'category', new.category, 'approved_at', new.approved_at)
      from private.delegation_recipients(new.org_id, d.delegator_id, new.approver_id) r
    on conflict (recipient_user_id, kind, subject_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.notify_delegation_use() from public, anon, authenticated;
create trigger notify_action_requests_delegation after update of status on public.action_requests
  for each row execute function private.notify_delegation_use();
