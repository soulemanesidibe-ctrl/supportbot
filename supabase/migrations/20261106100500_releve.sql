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
