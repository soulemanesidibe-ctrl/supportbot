-- Les données de démonstration (supabase/seed/) respectent les règles d'isolation qu'elles sont censées illustrer.
-- Un jeu de démonstration qui laisserait voir un client chez l'autre serait pire que pas de démonstration.
begin;

create function pg_temp.u(p text) returns uuid language sql as
$$ select id from auth.users where email = p $$;
create function pg_temp.o(p text) returns uuid language sql as
$$ select id from public.organizations where slug = p $$;

select test.expect('graine : 1 ESN et 2 clients créés par cette ESN, relations actives',
  (select count(*) from public.organizations where type = 'partner' and slug = 'esn-demo') = 1
  and (select count(*) from public.organizations where type = 'client' and created_via_partner_id = pg_temp.o('esn-demo')) = 2
  and (select count(*) from public.partner_relationships where partner_org_id = pg_temp.o('esn-demo') and status = 'active') = 2);

select test.expect('graine : 20 fiches pour Alpha, 2 pour Bêta, toutes validées par un humain nommé',
  (select count(*) from public.kb_documents where org_id = pg_temp.o('client-alpha')) = 20
  and (select count(*) from public.kb_documents where org_id = pg_temp.o('client-beta')) = 2
  and (select count(*) from public.kb_documents where source = 'seed' and (status <> 'validated' or validated_by is null)) = 0);

select test.expect('graine : les 11 catégories du périmètre sont couvertes pour Alpha',
  (select count(distinct category) from public.kb_documents where org_id = pg_temp.o('client-alpha')) = 11);

select test.expect('graine : chaque fiche a son morceau, sans vecteur (calculé par la tâche d''indexation du jalon J3)',
  (select count(*) from public.kb_chunks) = (select count(*) from public.kb_documents where source = 'seed')
  and (select count(*) from public.kb_chunks where embedding is not null) = 0);

select test.expect('graine : le technicien 1 lit les 20 fiches d''Alpha et AUCUNE de Bêta',
  test.q(pg_temp.u('tech1@esn-demo.test'), format('select count(*) from public.kb_chunks where org_id = %L', pg_temp.o('client-alpha'))) = 20
  and test.q(pg_temp.u('tech1@esn-demo.test'), format('select count(*) from public.kb_chunks where org_id = %L', pg_temp.o('client-beta'))) = 0);

select test.expect('graine : le technicien 2 lit les 2 fiches de Bêta et AUCUNE d''Alpha',
  test.q(pg_temp.u('tech2@esn-demo.test'), format('select count(*) from public.kb_chunks where org_id = %L', pg_temp.o('client-beta'))) = 2
  and test.q(pg_temp.u('tech2@esn-demo.test'), format('select count(*) from public.kb_chunks where org_id = %L', pg_temp.o('client-alpha'))) = 0);

select test.expect('graine : l''administrateur du client Alpha ne voit ni l''organisation Bêta ni ses fiches',
  test.q(pg_temp.u('admin@client-alpha.test'), format('select count(*) from public.organizations where id = %L', pg_temp.o('client-beta'))) = 0
  and test.q(pg_temp.u('admin@client-alpha.test'), format('select count(*) from public.kb_documents where org_id = %L', pg_temp.o('client-beta'))) = 0);

select test.expect('graine : un salarié ne lit pas la base de connaissance brute',
  test.q(pg_temp.u('salarie1@client-alpha.test'), 'select count(*) from public.kb_chunks') = 0);

select test.expect('graine : l''administrateur de l''ESN voit ses deux clients',
  test.q(pg_temp.u('admin@esn-demo.test'),
    format('select count(*) from public.organizations where id in (%L, %L)', pg_temp.o('client-alpha'), pg_temp.o('client-beta'))) = 2);

select test.expect('graine : le super administrateur ne lit AUCUNE donnée client sans accès d''assistance approuvé',
  test.q(pg_temp.u('fondateur@releve-demo.test'), 'select count(*) from public.kb_documents') = 0
  and test.q(pg_temp.u('fondateur@releve-demo.test'), 'select count(*) from public.conversations') = 0);

select test.expect('graine : tous les rôles sont présents une fois (super_admin, partner_admin, 2 partner_technician, 2 org_admin, 4 end_user)',
  (select count(*) from public.memberships m join auth.users u on u.id = m.user_id where u.email like '%.test' and m.role = 'partner_technician') = 2
  and (select count(*) from public.memberships m join auth.users u on u.id = m.user_id where u.email like '%.test' and m.role = 'org_admin') = 2
  and (select count(*) from public.memberships m join auth.users u on u.id = m.user_id where u.email like '%.test' and m.role = 'end_user') = 4
  and (select count(*) from public.memberships where role = 'super_admin') = 1);

rollback;
