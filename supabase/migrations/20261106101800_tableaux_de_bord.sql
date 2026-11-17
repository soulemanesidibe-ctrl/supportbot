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
