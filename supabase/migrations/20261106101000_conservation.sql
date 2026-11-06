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
