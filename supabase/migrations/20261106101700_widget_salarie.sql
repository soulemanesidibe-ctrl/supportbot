-- Relève IA : lectures du widget salarié, et rattachement du salarié à sa première connexion (jalon J5).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101600_second_facteur_obligatoire.sql.
--
-- Depuis la migration 16, le salarié (connexion par code, sans second facteur) ne lit plus rien directement : la fonction `chat`
-- lit pour lui avec les fonctions ci-dessous. Toutes sont RÉSERVÉES AU SERVICE (ni le navigateur ni l'anonyme ne peuvent les
-- appeler) et toutes sont bornées au couple (organisation, demandeur) que le code tire du contexte vérifié, jamais de la requête.
-- Elles ne renvoient JAMAIS : un message réservé aux techniciens (mode ombre, notes internes), le titre ou le texte d'une alerte,
-- l'adresse e-mail d'un technicien. Chacune revérifie que le demandeur est bien salarié actif de l'organisation.

-- Prénom affichable d'une personne : premier mot de son nom, sans ce qui suivrait un « @ », sans caractère de contrôle, 40 au plus.
create function private.first_name(p_full text) returns text
language sql immutable set search_path = '' as
$$ select nullif(left(regexp_replace(split_part(split_part(btrim(coalesce(p_full, '')), ' ', 1), '@', 1), '[[:cntrl:]]', '', 'g'), 40), '') $$;

-- Couleur d'accent d'une marque : « #RRGGBB » seulement ; toute autre valeur est ignorée.
create function private.valid_accent(p text) returns text
language sql immutable set search_path = '' as
$$ select case when p ~ '^#[0-9A-Fa-f]{6}$' then lower(p) end $$;

-- Organisation désignée par l'adresse du widget (/w/<organisation>) : un client activé, non suspendu. Sinon : rien.
create function private.widget_org(p_slug text) returns public.organizations
language sql stable security definer set search_path = '' as
$$ select o.* from public.organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.type = 'client' and o.activated_at is not null and o.state <> 'suspended' $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Avant connexion : nom et couleur de l'organisation (pour l'écran de connexion), et rien d'autre.
-- ---------------------------------------------------------------------------------------------------------------
create function public.widget_public_org(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare v_org public.organizations%rowtype;
begin
  v_org := private.widget_org(p_slug);
  if v_org.id is null then return null; end if;
  return jsonb_build_object('name', v_org.name, 'accent', coalesce(private.valid_accent(v_org.branding ->> 'accent'),
    (select private.valid_accent(p.branding ->> 'accent') from public.organizations p where p.id = v_org.created_via_partner_id)));
end $$;

-- Un code de connexion peut-il partir vers cette adresse ? Seulement si elle figure, active, dans la liste des salariés importée
-- par le client (vérifié AVANT l'envoi, spec § 5.3), et si cette personne n'a pas dans cette organisation un rôle du personnel
-- (elle passe par la console, avec second facteur) ni un accès suspendu ou retiré. Renvoie l'organisation, sinon null.
-- La fonction répond pareil, du point de vue de l'appelant, que l'adresse soit inconnue ou refusée : la fonction Edge renvoie
-- toujours la même réponse au navigateur.
create function public.widget_code_allowed(p_slug text, p_email text) returns uuid
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  v_org := private.widget_org(p_slug);
  if v_org.id is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  if not exists (select 1 from public.directory_users d where d.org_id = v_org.id and d.email = v_email and d.active) then return null; end if;
  if exists (select 1 from auth.users u join public.memberships m on m.user_id = u.id and m.org_id = v_org.id
             where lower(u.email) = v_email and (m.role <> 'end_user' or m.status <> 'active')) then return null; end if;
  return v_org.id;
end $$;

-- Première connexion (et suivantes) : rattache le compte qui vient de prouver son adresse à la ligne de l'annuaire et lui donne le
-- rôle salarié dans CETTE organisation. L'adresse est lue dans le compte (auth.users), jamais reçue de la requête. Idempotent.
-- Renvoie l'organisation, ou null (adresse absente ou inactive dans l'annuaire, ligne déjà rattachée à un AUTRE compte, rôle du
-- personnel dans cette organisation, accès retiré).
create function public.widget_employee_link(p_slug text, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_email text;
  v_dir public.directory_users%rowtype;
  v_member public.memberships%rowtype;
begin
  v_org := private.widget_org(p_slug);
  if v_org.id is null or p_user is null then return null; end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if v_email is null then return null; end if;
  select * into v_dir from public.directory_users d where d.org_id = v_org.id and d.email = v_email and d.active for update;
  if v_dir.id is null or (v_dir.linked_user_id is not null and v_dir.linked_user_id <> p_user) then return null; end if;
  select * into v_member from public.memberships m where m.user_id = p_user and m.org_id = v_org.id for update;
  if v_member.id is not null then
    if v_member.role <> 'end_user' or v_member.status = 'removed' then return null; end if;
    -- Un salarié suspendu parce qu'il avait disparu de l'annuaire, puis réimporté actif, retrouve son accès.
    if v_member.status <> 'active' then update public.memberships set status = 'active' where id = v_member.id; end if;
  else
    insert into public.memberships (user_id, org_id, role, status) values (p_user, v_org.id, 'end_user', 'active');
  end if;
  if v_dir.linked_user_id is null then update public.directory_users set linked_user_id = p_user where id = v_dir.id; end if;
  return v_org.id;
end $$;

-- Un salarié retiré de l'annuaire (ou désactivé) perd aussitôt l'accès au widget : son appartenance « salarié » est suspendue.
create function private.directory_users_offboard() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare v_user uuid := case when tg_op = 'DELETE' then old.linked_user_id else coalesce(old.linked_user_id, new.linked_user_id) end;
begin
  if v_user is not null and (tg_op = 'DELETE' or (old.active and not new.active)) then
    update public.memberships set status = 'suspended'
     where user_id = v_user and org_id = old.org_id and role = 'end_user' and status = 'active';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger directory_users_offboard after update or delete on public.directory_users
  for each row execute function private.directory_users_offboard();

-- ---------------------------------------------------------------------------------------------------------------
-- Après connexion : ce que le widget montre au salarié.
-- ---------------------------------------------------------------------------------------------------------------
-- Contexte : nom de l'organisation et couleur, prénom du salarié, fin de la relève en cours (créneaux enchaînés), incidents
-- MAJEURS ou CRITIQUES en cours (identifiant, catégorie, heure : jamais leur titre, qui peut reprendre le texte d'une alerte).
create function public.widget_context(p_org uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_org public.organizations%rowtype;
  v_until timestamptz;
  v_next timestamptz;
begin
  if not private._member(p_user, p_org, array['end_user']) then return null; end if;
  select * into v_org from public.organizations o where o.id = p_org and o.type = 'client';
  if v_org.id is null then return null; end if;
  select max(s.ends_at) into v_until from public.relief_schedules s
   where s.org_id = p_org and s.kind in ('absence', 'night', 'leave') and s.starts_at <= now() and s.ends_at > now();
  for i in 1..10 loop                     -- créneaux qui se suivent ou se chevauchent : la relève dure jusqu'au dernier
    exit when v_until is null;
    select max(s.ends_at) into v_next from public.relief_schedules s
     where s.org_id = p_org and s.kind in ('absence', 'night', 'leave') and s.starts_at <= v_until and s.ends_at > v_until;
    exit when v_next is null;
    v_until := v_next;
  end loop;
  return jsonb_build_object(
    'org_name', v_org.name,
    'accent', coalesce(private.valid_accent(v_org.branding ->> 'accent'),
                       (select private.valid_accent(p.branding ->> 'accent') from public.organizations p where p.id = v_org.created_via_partner_id)),
    'first_name', (select private.first_name(d.display_name) from public.directory_users d
                    where d.org_id = p_org and d.linked_user_id = p_user and d.active limit 1),
    'relief_until', v_until,
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'category', coalesce(i.category, 'other'), 'since', i.opened_at)
                                            order by i.opened_at desc)
                           from (select * from public.incidents x
                                  where x.org_id = p_org and x.state in ('open', 'mitigated') and x.severity in ('major', 'critical')
                                  order by x.opened_at desc limit 5) i), '[]'::jsonb));
end $$;

-- Ses demandes, les plus récentes d'abord : premier message du salarié (titre), dernier message PUBLIC (aperçu).
create function public.widget_requests(p_org uuid, p_user uuid, p_limit int default 30)
returns table (id uuid, state text, category text, updated_at timestamptz, title text, last_line text)
language sql stable security definer set search_path = '' as
$$
  select c.id, c.state, c.category, greatest(c.updated_at, coalesce(l.created_at, c.updated_at)),
         (select left(regexp_replace(f.content, '\s+', ' ', 'g'), 120) from public.messages f
           where f.conversation_id = c.id and f.org_id = p_org and f.visibility = 'public' and f.role = 'user'
           order by f.created_at, f.id limit 1),
         left(regexp_replace(l.content, '\s+', ' ', 'g'), 200)
  from public.conversations c
  left join lateral (select m.content, m.created_at from public.messages m
                      where m.conversation_id = c.id and m.org_id = p_org and m.visibility = 'public'
                      order by m.created_at desc, m.id desc limit 1) l on true
  where c.org_id = p_org and c.requester_user_id = p_user and private._member(p_user, p_org, array['end_user'])
  order by 4 desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- Une demande : ses messages PUBLICS (les 200 derniers, dans l'ordre), avec le prénom du technicien pour un message humain.
create function public.widget_conversation(p_org uuid, p_user uuid, p_conversation uuid) returns jsonb
language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object(
    'id', c.id, 'state', c.state, 'category', c.category, 'satisfaction', c.satisfaction, 'resolution', c.resolution,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'role', m.role, 'content', m.content, 'at', m.created_at,
               'author', case when m.role = 'technician'
                              then (select private.first_name(u.raw_user_meta_data ->> 'full_name') from auth.users u where u.id = m.author_id) end)
             order by m.created_at, m.id)
      from (select * from public.messages x
             where x.conversation_id = c.id and x.org_id = p_org and x.visibility = 'public'
             order by x.created_at desc, x.id desc limit 200) m), '[]'::jsonb))
  from public.conversations c
  where c.id = p_conversation and c.org_id = p_org and c.requester_user_id = p_user and private._member(p_user, p_org, array['end_user'])
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Droits : le service seulement.
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.widget_public_org(text), public.widget_code_allowed(text, text), public.widget_employee_link(text, uuid),
  public.widget_context(uuid, uuid), public.widget_requests(uuid, uuid, int), public.widget_conversation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.widget_public_org(text), public.widget_code_allowed(text, text), public.widget_employee_link(text, uuid),
  public.widget_context(uuid, uuid), public.widget_requests(uuid, uuid, int), public.widget_conversation(uuid, uuid, uuid)
  to service_role;
revoke all on function private.first_name(text), private.valid_accent(text), private.widget_org(text), private.directory_users_offboard()
  from public, anon, authenticated;
