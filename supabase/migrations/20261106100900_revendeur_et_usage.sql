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
