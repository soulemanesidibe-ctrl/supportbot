-- Relève IA : « qui a accès à quoi » pour l'administrateur du client (docs/10 § 5.4, jalon J5).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101800_tableaux_de_bord.sql.
--
-- L'administrateur du client doit voir, et pouvoir révoquer, tout ce qui ouvre un accès à son organisation : la relation avec
-- l'ESN et les rôles qu'il a approuvés, les techniciens assignés, les délégations de validation (suppléance), les accès
-- d'assistance, les connecteurs, les niveaux d'autonomie et les plannings de relève. Les NOMS des personnes vivent dans les comptes
-- (schéma auth), que le navigateur ne lit pas : cette fonction les donne, pour CETTE organisation seulement, à son administrateur
-- seulement, avec second facteur. Aucun texte de conversation, aucun secret (ni jeton ni référence du coffre).

create function private.person_label(p_user uuid) returns text
language sql stable security definer set search_path = '' as
$$ select coalesce(nullif(left(btrim(u.raw_user_meta_data ->> 'full_name'), 80), ''), u.email) from auth.users u where u.id = p_user $$;

create function public.dashboard_org_access(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare v_rel public.partner_relationships%rowtype;
begin
  if not (private.session_has_second_factor() and private.is_member_of(p_org, array['org_admin'])) then perform private.dashboard_denied(); end if;
  select * into v_rel from public.partner_relationships r
   where r.client_org_id = p_org and r.status in ('proposed', 'active', 'reduced', 'suspended') order by r.created_at desc limit 1;
  return jsonb_build_object(
    'relationship', case when v_rel.id is null then null else jsonb_build_object(
      'partner_name', (select o.name from public.organizations o where o.id = v_rel.partner_org_id),
      'status', v_rel.status, 'approved_roles', to_jsonb(v_rel.approved_roles), 'expires_at', v_rel.expires_at) end,
    'technicians', coalesce((select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'name', private.person_label(a.user_id), 'until', a.ends_at) order by a.ends_at)
                             from public.partner_assignments a
                             where v_rel.id is not null and a.relationship_id = v_rel.id and a.revoked_at is null and a.ends_at > now()), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'from', private.person_label(d.delegator_id), 'to', private.person_label(d.delegate_id),
                                                                 'until', d.ends_at, 'categories', to_jsonb(d.categories)) order by d.ends_at)
                             from public.approval_delegations d
                             where d.org_id = p_org and d.revoked_at is null and d.ends_at > now()), '[]'::jsonb),
    'support_access', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'reason', g.reason, 'approved', g.approved_by is not null, 'until', g.ends_at,
                                                                    'requested_by', private.person_label(g.requested_by)) order by g.created_at)
                                from public.support_access_grants g
                                where g.client_org_id = p_org and g.revoked_at is null and (g.ends_at is null or g.ends_at > now())), '[]'::jsonb),
    'connectors', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'type', k.type, 'status', k.status, 'last_sync_at', k.last_sync_at) order by k.name)
                            from public.connectors k where k.org_id = p_org), '[]'::jsonb),
    'autonomy', coalesce((select jsonb_agg(jsonb_build_object('category', s.category, 'level', s.level) order by s.category)
                          from public.autonomy_settings s where s.org_id = p_org), '[]'::jsonb),
    'relief', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                                                            'who', case when s.technician_user_id is not null then private.person_label(s.technician_user_id) end) order by s.starts_at)
                        from public.relief_schedules s where s.org_id = p_org and s.ends_at > now() and s.starts_at < now() + interval '30 days'), '[]'::jsonb));
end $$;

revoke all on function public.dashboard_org_access(uuid) from public, anon;
grant execute on function public.dashboard_org_access(uuid) to authenticated, service_role;
revoke all on function private.person_label(uuid) from public, anon, authenticated;
