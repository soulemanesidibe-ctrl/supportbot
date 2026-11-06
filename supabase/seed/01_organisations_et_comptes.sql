-- DONNÉES DE DÉMONSTRATION 100 % SYNTHÉTIQUES (jamais de donnée réelle dans ce dépôt public : scripts/check-no-real-data.sh).
-- Une plateforme, une ESN, deux clients. Adresses en .test (RFC 2606). Appliqué par « supabase db reset » en local uniquement,
-- jamais sur un projet hébergé. Les comptes n'ont PAS de mot de passe : pour se connecter en démonstration, un script
-- (jalon J8) créera de vrais comptes avec mot de passe et facteur TOTP, avec les mêmes identifiants.
--
--   Relève IA (existe déjà, migration 2)    plateforme   super_admin : fondateur@releve-demo.test
--   Nord Numérique (ESN de démonstration)  ESN          partner_admin : admin@esn-demo.test ; techniciens : tech1@, tech2@
--     ├─ Cabinet Alpha (démonstration)     client A     org_admin : admin@client-alpha.test ; salariés : salarie1@ à salarie3@  ← tech1
--     └─ Atelier Bêta (démonstration)      client B     org_admin : admin@client-beta.test ; salarié : salarie1@                ← tech2

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'fondateur@releve-demo.test',  now(), '{"full_name": "Fondateur (démo)"}'),
  ('00000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'admin@esn-demo.test',         now(), '{"full_name": "Admin ESN (démo)"}'),
  ('00000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'tech1@esn-demo.test',         now(), '{"full_name": "Technicien 1 (démo)"}'),
  ('00000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'tech2@esn-demo.test',         now(), '{"full_name": "Technicien 2 (démo)"}'),
  ('00000000-0000-4000-8000-000000000201', 'authenticated', 'authenticated', 'admin@client-alpha.test',     now(), '{"full_name": "Admin client Alpha (démo)"}'),
  ('00000000-0000-4000-8000-000000000202', 'authenticated', 'authenticated', 'salarie1@client-alpha.test',  now(), '{"full_name": "Salarié 1 Alpha (démo)"}'),
  ('00000000-0000-4000-8000-000000000203', 'authenticated', 'authenticated', 'salarie2@client-alpha.test',  now(), '{"full_name": "Salarié 2 Alpha (démo)"}'),
  ('00000000-0000-4000-8000-000000000204', 'authenticated', 'authenticated', 'salarie3@client-alpha.test',  now(), '{"full_name": "Salarié 3 Alpha (démo)"}'),
  ('00000000-0000-4000-8000-000000000301', 'authenticated', 'authenticated', 'admin@client-beta.test',      now(), '{"full_name": "Admin client Bêta (démo)"}'),
  ('00000000-0000-4000-8000-000000000302', 'authenticated', 'authenticated', 'salarie1@client-beta.test',   now(), '{"full_name": "Salarié 1 Bêta (démo)"}');

-- L'organisation « plateforme » existe déjà : la migration 2 la crée (une seule autorisée).
insert into public.organizations (id, type, name, slug, state, plan, created_via_partner_id, activated_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'partner', 'Nord Numérique (ESN de démonstration)', 'esn-demo', 'pilot', 'partner', null, now());
insert into public.organizations (id, type, name, slug, state, plan, created_via_partner_id, activated_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'client', 'Cabinet Alpha (démonstration)', 'client-alpha', 'pilot', 'pilot', '00000000-0000-4000-8000-0000000000a1', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'client', 'Atelier Bêta (démonstration)',  'client-beta',  'pilot', 'pilot', '00000000-0000-4000-8000-0000000000a1', now());

insert into public.memberships (user_id, org_id, role) values
  ('00000000-0000-4000-8000-000000000101', (select id from public.organizations where type = 'platform'), 'super_admin'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-0000000000a1', 'partner_admin'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-0000000000a1', 'partner_technician'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-0000000000a1', 'partner_technician'),
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-0000000000b1', 'org_admin'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-0000000000b1', 'end_user'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-0000000000b1', 'end_user'),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-0000000000b1', 'end_user'),
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-0000000000b2', 'org_admin'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-0000000000b2', 'end_user');

-- Les deux clients ont été créés par l'ESN : la relation est active d'emblée (décision du 5 novembre) ; chaque client
-- administrateur peut la réduire ou la révoquer seul. Chaque technicien n'est assigné qu'à UN client.
insert into public.partner_relationships (id, partner_org_id, client_org_id, status, approved_roles, created_by_partner, expires_at) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
   'active', array['partner_admin', 'partner_technician'], true, now() + interval '12 months'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2',
   'active', array['partner_admin', 'partner_technician'], true, now() + interval '12 months');

insert into public.partner_assignments (relationship_id, user_id, ends_at) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000103', now() + interval '6 months'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000104', now() + interval '6 months');
