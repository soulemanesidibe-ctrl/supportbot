-- Banc d'essai local : imite ce que Supabase fournit AVANT nos migrations (rôles, schéma auth, vault, extensions).
-- Ne s'applique JAMAIS à un projet Supabase : il sert uniquement à tester les migrations sur un Postgres jetable.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

create schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Schéma auth minimal, avec les mêmes fonctions que Supabase.
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as
$$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Vault minimal : même interface que supabase_vault pour ce que nos migrations utilisent.
create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now()
);
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language plpgsql as
$$ declare v uuid; begin insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id into v; return v; end $$;

create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret, created_at from vault.secrets;

-- Comme sur Supabase : le schéma public donne tous les droits aux rôles d'API par défaut.
-- C'est pourquoi chaque migration retire explicitement ces droits et active la RLS.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Publication temps réel (Supabase la fournit ; les migrations y ajoutent leurs tables).
create publication supabase_realtime;
