-- Relève IA : fondations.
-- Extensions, schéma privé (fonctions de contrôle non exposées par l'API), utilitaires, offres et fonctionnalités.
-- MIGRATION À APPLIQUER PAR LE FONDATEUR (supabase db push), après les migrations précédentes (aucune).

-- pgvector pour la base de connaissance ; pgcrypto pour gen_random_uuid() et les empreintes.
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Vault : stockage chiffré des secrets des connecteurs. Activé par défaut sur Supabase ; ignoré s'il n'est pas disponible
-- (banc d'essai local, où un faux schéma vault est fourni).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault')
     and not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    create extension supabase_vault with schema vault;
  end if;
end $$;

-- Schéma privé : jamais listé dans les schémas exposés de l'API (config.toml). Les fonctions SECURITY DEFINER
-- de contrôle d'accès y vivent : appelables par les politiques RLS, pas par un client.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- Rôles de l'application : la liste fermée des 10 rôles (docs/10, spec § 8).
create function private.role_family(p_role text) returns text
language sql immutable parallel safe set search_path = '' as
$$ select case p_role
     when 'super_admin' then 'platform' when 'platform_support' then 'platform'
     when 'partner_admin' then 'partner' when 'partner_manager' then 'partner' when 'partner_technician' then 'partner'
     when 'org_admin' then 'client' when 'org_technician' then 'client' when 'org_viewer' then 'client'
     when 'auditor' then 'client' when 'end_user' then 'client'
     else null end $$;

-- Rang d'un rôle dans sa famille : sert à interdire qu'une invitation donne plus de droits que celui qui invite.
create function private.role_rank(p_role text) returns int
language sql immutable parallel safe set search_path = '' as
$$ select case p_role
     when 'super_admin' then 100 when 'platform_support' then 50
     when 'partner_admin' then 100 when 'partner_manager' then 60 when 'partner_technician' then 40
     when 'org_admin' then 100 when 'org_technician' then 60 when 'org_viewer' then 30
     when 'auditor' then 30 when 'end_user' then 10
     else 0 end $$;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as
$$ begin new.updated_at := now(); return new; end $$;

-- Retire d'une ligne les colonnes qui ne doivent jamais atterrir dans le journal d'audit.
create function private.redact_row(p_row jsonb) returns jsonb
language sql immutable parallel safe set search_path = '' as
$$ select coalesce(p_row, '{}'::jsonb) - 'token_hash' - 'secret' - 'vault_secret_id' - 'embedding' $$;
