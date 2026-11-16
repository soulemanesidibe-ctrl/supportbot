-- Migration 16 : aucune lecture ni écriture directe sans second facteur (SEC-33). Une session aal1 (connexion par code envoyé par
-- e-mail) est ce qu'obtiendrait quelqu'un qui lit la boîte mail d'un technicien : elle ne doit plus rien voir.
-- Graine de démonstration (Alpha : tech1 assigné) ; tout est annulé à la fin.
begin;

create function pg_temp.o(p text) returns uuid language sql as $$ select id from public.organizations where slug = p $$;
create function pg_temp.u(p text) returns uuid language sql as $$ select id from auth.users where email = p $$;

-- Données de support d'Alpha : une conversation du salarié 1, deux messages, un ticket, un incident, une notification à tech1.
insert into public.conversations (id, org_id, requester_user_id, category) values
  ('00000000-0000-4000-8000-0000000093c1', pg_temp.o('client-alpha'), pg_temp.u('salarie1@client-alpha.test'), 'printer');
insert into public.messages (id, conversation_id, org_id, role, visibility, content) values
  ('00000000-0000-4000-8000-0000000093d1', '00000000-0000-4000-8000-0000000093c1', pg_temp.o('client-alpha'), 'user', 'public', 'L''imprimante ne répond plus'),
  ('00000000-0000-4000-8000-0000000093d2', '00000000-0000-4000-8000-0000000093c1', pg_temp.o('client-alpha'), 'assistant', 'technician', 'Redémarrez-la.');   -- mode ombre
insert into public.tickets (org_id, conversation_id, title, category) values
  (pg_temp.o('client-alpha'), '00000000-0000-4000-8000-0000000093c1', 'Imprimante : ne répond plus', 'printer');
insert into public.incidents (id, org_id, title, category, severity) values
  ('00000000-0000-4000-8000-0000000093e1', pg_temp.o('client-alpha'), 'VPN indisponible', 'vpn', 'major');
insert into public.notifications (org_id, recipient_user_id, kind, subject_type, subject_id) values
  (pg_temp.o('client-alpha'), pg_temp.u('tech1@esn-demo.test'), 'incident_opened', 'incident', '00000000-0000-4000-8000-0000000093e1');

-- Lignes visibles, toutes tables lisibles par le navigateur confondues, pour un utilisateur et une ancienneté de second facteur.
create function pg_temp.visible(p_user uuid, p_mfa_age int) returns bigint language plpgsql as
$$ declare t text; n bigint := 0;
begin
  for t in select table_name from information_schema.role_table_grants
           where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'SELECT' order by table_name loop
    n := n + test.q(p_user, format('select count(*) from public.%I', t), p_mfa_age);
  end loop;
  return n;
end $$;

-- 1. La politique existe partout, telle qu'attendue.
select test.expect('SEC-33 chaque table de public sous RLS a sa politique restrictive « second facteur » (pour tout, rôle authenticated)',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = c.relname || '_second_facteur'
                        and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL' and p.roles = '{authenticated}'
                        and p.qual like '%session_has_second_factor%' and p.with_check like '%session_has_second_factor%')));
select test.expect('SEC-33 la fonction de contrôle lit bien aal2 dans le jeton',
  test.b(pg_temp.u('tech1@esn-demo.test'), 'select private.session_has_second_factor()')
  and not test.b(pg_temp.u('tech1@esn-demo.test'), 'select private.session_has_second_factor()', -1));

-- 2. Technicien assigné : tout avec second facteur, rien sans.
select test.expect('SEC-33 témoin : avec second facteur, le technicien assigné lit conversation, messages, ticket, incident, notification',
  test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.conversations where id = ''00000000-0000-4000-8000-0000000093c1''') = 1
  and test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.messages where conversation_id = ''00000000-0000-4000-8000-0000000093c1''') = 2
  and test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.tickets where conversation_id = ''00000000-0000-4000-8000-0000000093c1''') = 1
  and test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.incidents where id = ''00000000-0000-4000-8000-0000000093e1''') = 1
  and test.q(pg_temp.u('tech1@esn-demo.test'), 'select count(*) from public.notifications') = 1);
select test.expect('SEC-33 sans second facteur (boîte mail compromise), le technicien assigné ne lit RIEN, dans aucune table',
  pg_temp.visible(pg_temp.u('tech1@esn-demo.test'), -1) = 0);
select test.expect('SEC-33 sans second facteur, l''administrateur du client et celui de l''ESN ne lisent rien non plus',
  pg_temp.visible(pg_temp.u('admin@client-alpha.test'), -1) = 0
  and pg_temp.visible(pg_temp.u('admin@esn-demo.test'), -1) = 0
  and pg_temp.visible(pg_temp.u('fondateur@releve-demo.test'), -1) = 0);
select test.expect('SEC-33 témoin : avec second facteur, ces mêmes personnes lisent bien quelque chose',
  pg_temp.visible(pg_temp.u('admin@client-alpha.test'), null) > 0
  and pg_temp.visible(pg_temp.u('admin@esn-demo.test'), null) > 0);

-- 3. Le salarié (connexion par code, aal1) ne lit plus directement ses demandes : la fonction chat le fait pour lui.
select test.expect('SEC-33 le salarié connecté par code ne lit rien directement, pas même sa propre conversation',
  pg_temp.visible(pg_temp.u('salarie1@client-alpha.test'), -1) = 0);
select test.expect('SEC-33 témoin : seule la politique restrictive le bloque (la règle « ses propres demandes » existe toujours)',
  test.q(pg_temp.u('salarie1@client-alpha.test'), 'select count(*) from public.conversations') = 1);

-- 4. Écritures du navigateur : notation d'une réponse et lecture d'une notification.
-- (Le refus peut venir du déclencheur de la table, qui ne voit plus le message noté, ou de la politique : les deux tiennent.)
select test.expect('SEC-33 sans second facteur, un technicien ne peut pas noter une réponse',
  test.err(pg_temp.u('tech1@esn-demo.test'), format(
    'insert into public.response_ratings (org_id, message_id, kind, rating, rated_by) values (%L, ''00000000-0000-4000-8000-0000000093d2'', ''answer'', ''correct'', %L)',
    pg_temp.o('client-alpha'), pg_temp.u('tech1@esn-demo.test')), 'authenticated', -1) is not null);
select test.expect('SEC-33 témoin : avec second facteur, la même notation passe',
  test.err(pg_temp.u('tech1@esn-demo.test'), format(
    'insert into public.response_ratings (org_id, message_id, kind, rating, rated_by) values (%L, ''00000000-0000-4000-8000-0000000093d2'', ''answer'', ''correct'', %L)',
    pg_temp.o('client-alpha'), pg_temp.u('tech1@esn-demo.test'))) is null);
select test.q(pg_temp.u('tech1@esn-demo.test'), 'with u as (update public.notifications set read_at = now() returning 1) select count(*) from u', -1);
select test.expect('SEC-33 sans second facteur, marquer sa notification comme lue n''a aucun effet',
  (select read_at is null from public.notifications where recipient_user_id = pg_temp.u('tech1@esn-demo.test')));

rollback;
