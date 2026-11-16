-- Migration 14 : accès du SERVICE aux secrets (connecteurs, sources d'alertes) et protection contre le rejeu des webhooks (jalon J4).
--
-- Pourquoi ? Les fonctions de lecture et d'écriture des secrets (coffre Vault) vivent dans le schéma « private », que l'API n'expose pas :
-- une Edge Function ne peut pas les appeler. On ajoute des fonctions PUBLIQUES minces, réservées au service (jamais au navigateur ni
-- à l'anonyme), qui re-vérifient que le secret demandé appartient bien à l'organisation indiquée. Aucune ne renvoie un secret à un
-- utilisateur de l'API ; aucun secret n'est jamais écrit dans le journal d'audit.
--
-- Cette migration est à appliquer par le fondateur (éditeur SQL de Supabase), après la 13.

-- ---------------------------------------------------------------------------------------------------------------
-- Secrets des connecteurs (GLPI : jeton utilisateur et jeton d'application ; Microsoft 365 n'en a pas : flux délégué)
-- ---------------------------------------------------------------------------------------------------------------
create function public.connector_secret_get(p_org uuid, p_connector uuid) returns text
language plpgsql security definer set search_path = '' as
$$
begin
  if not exists (select 1 from public.connectors c where c.id = p_connector and c.org_id = p_org and c.status <> 'disabled') then
    raise exception 'Connecteur introuvable'; end if;
  return private.read_connector_secret(p_connector);
end $$;
revoke all on function public.connector_secret_get(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connector_secret_get(uuid, uuid) to service_role;

create function public.connector_secret_set(p_org uuid, p_connector uuid, p_secret text) returns boolean
language plpgsql security definer set search_path = '' as
$$
begin
  if not exists (select 1 from public.connectors c where c.id = p_connector and c.org_id = p_org and c.status <> 'disabled') then
    raise exception 'Connecteur introuvable'; end if;
  perform private.store_connector_secret(p_connector, p_secret);   -- refuse un secret vide ou trop court
  return true;
end $$;
revoke all on function public.connector_secret_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.connector_secret_set(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Secrets des sources d'alertes (secret HMAC du webhook)
-- ---------------------------------------------------------------------------------------------------------------
create function public.alert_source_secret_set(p_org uuid, p_source uuid, p_secret text) returns boolean
language plpgsql security definer set search_path = '' as
$$
begin
  if not exists (select 1 from public.alert_sources a where a.id = p_source and a.org_id = p_org) then
    raise exception 'Source introuvable'; end if;
  perform private.store_alert_source_secret(p_source, p_secret);   -- refuse un secret de moins de 32 caractères
  return true;
end $$;
revoke all on function public.alert_source_secret_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.alert_source_secret_set(uuid, uuid, text) to service_role;

-- Réception d'un webhook : AVANT de savoir qui appelle, la fonction `alerts-ingest` doit retrouver le secret de la source désignée dans
-- l'adresse pour vérifier la signature. Cette fonction ne renvoie des informations que pour une source ACTIVE qui a un secret, et rien
-- d'autre : une source inconnue, désactivée ou sans secret donne le même résultat vide.
create function public.alert_source_for_webhook(p_source uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare a public.alert_sources%rowtype;
begin
  select * into a from public.alert_sources where id = p_source and status = 'active' and vault_secret_id is not null;
  if a.id is null then return null; end if;
  if not exists (select 1 from public.organizations o where o.id = a.org_id and o.state <> 'suspended') then return null; end if;
  return jsonb_build_object('org_id', a.org_id, 'secret', private.read_alert_source_secret(a.id),
                            'severity_map', a.severity_map, 'field_mapping', a.field_mapping);
end $$;
revoke all on function public.alert_source_for_webhook(uuid) from public, anon, authenticated;
grant execute on function public.alert_source_for_webhook(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Rejeu d'un webhook (SEC-17) : une livraison (empreinte de la signature et de l'horodatage) ne se présente qu'UNE fois dans sa
-- fenêtre de validité. Les empreintes de plus d'une heure sont purgées au passage (1 appel sur 50).
-- ---------------------------------------------------------------------------------------------------------------
create table public.webhook_deliveries (
  source_id uuid not null references public.alert_sources (id) on delete cascade,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  primary key (source_id, digest)
);
alter table public.webhook_deliveries enable row level security;   -- aucune policy : personne, sauf le service
revoke all on public.webhook_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.webhook_deliveries to service_role;

-- Renvoie vrai la PREMIÈRE fois qu'une livraison est présentée, faux ensuite (rejeu).
create function public.webhook_first_delivery(p_source uuid, p_digest text) returns boolean
language plpgsql security definer set search_path = '' as
$$
declare v_n int;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise exception 'Empreinte invalide'; end if;
  insert into public.webhook_deliveries (source_id, digest) values (p_source, p_digest) on conflict do nothing;
  get diagnostics v_n = row_count;
  if random() < 0.02 then delete from public.webhook_deliveries where received_at < now() - interval '1 hour'; end if;
  return v_n = 1;
end $$;
revoke all on function public.webhook_first_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.webhook_first_delivery(uuid, text) to service_role;
