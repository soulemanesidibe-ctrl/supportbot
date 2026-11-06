-- Aides communes aux scripts de test. Tout se passe dans une transaction annulée à la fin de chaque script.
-- (Chargé en premier par run.sh, avant les scripts numérotés.)
create schema if not exists test;

create or replace function test.expect(p_name text, p_ok boolean) returns void language plpgsql as
$$ begin
  if p_ok is not true then raise exception 'ECHEC : %', p_name; end if;
  raise notice 'ok   %', p_name;
end $$;

-- Se connecter comme un utilisateur de l'API (rôle authenticated + jeton). p_mfa_age : ancienneté du second facteur en
-- secondes, null = connexion sans second facteur.
create or replace function test.claims(p_user uuid, p_mfa_age int default null) returns text language sql as
$$ select jsonb_build_object('sub', p_user, 'role', 'authenticated',
     'aal', case when p_mfa_age is null then 'aal1' else 'aal2' end,
     'amr', case when p_mfa_age is null
        then jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
        else jsonb_build_array(
          jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - p_mfa_age - 5),
          jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_mfa_age)) end)::text $$;

-- Nombre de lignes visibles par cet utilisateur pour cette requête (qui doit renvoyer un entier).
create or replace function test.q(p_user uuid, p_sql text, p_mfa_age int default null) returns bigint language plpgsql as
$$ declare v bigint;
begin
  perform set_config('request.jwt.claims', test.claims(p_user, p_mfa_age), true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); raise;
end $$;

-- Code d'erreur SQL si la requête échoue pour cet utilisateur, null si elle réussit.
create or replace function test.err(p_user uuid, p_sql text, p_role text default 'authenticated', p_mfa_age int default null) returns text language plpgsql as
$$ begin
  perform set_config('request.jwt.claims', test.claims(p_user, p_mfa_age), true);
  execute format('set local role %I', p_role);
  execute p_sql;
  execute 'reset role'; perform set_config('request.jwt.claims', '', true);
  return null;
exception when others then
  execute 'reset role'; perform set_config('request.jwt.claims', '', true);
  return sqlstate;
end $$;

-- Valeur booléenne d'une fonction de contrôle, vue par cet utilisateur.
create or replace function test.b(p_user uuid, p_sql text, p_mfa_age int default null) returns boolean language plpgsql as
$$ declare v boolean;
begin
  perform set_config('request.jwt.claims', test.claims(p_user, p_mfa_age), true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role'; perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); raise;
end $$;

-- Code d'erreur d'une instruction exécutée en tant que superutilisateur (pour tester les garde-fous de la base).
create or replace function test.err_admin(p_sql text) returns text language plpgsql as
$$ begin execute p_sql; return null; exception when others then return sqlstate; end $$;

-- Message d'erreur d'une instruction exécutée en tant que superutilisateur (null si elle réussit) : permet de vérifier
-- que le refus vient bien de la bonne défense et pas d'une autre.
create or replace function test.msg_admin(p_sql text) returns text language plpgsql as
$$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- Comme test.q mais sous un rôle d'API précis (par exemple service_role, qui contourne la RLS).
create or replace function test.q_role(p_role text, p_sql text) returns bigint language plpgsql as
$$ declare v bigint;
begin
  execute format('set local role %I', p_role);
  execute p_sql into v;
  execute 'reset role';
  return v;
exception when others then execute 'reset role'; raise;
end $$;
