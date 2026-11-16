-- Relève IA : le second facteur est exigé pour TOUTE lecture ou écriture directe de la base par le navigateur.
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106101500_ingestion_des_alertes.sql.
--
-- Pourquoi (revue de sécurité de J5, SEC-33, menace M15) : Supabase envoie un code de connexion à usage unique à toute adresse
-- DÉJÀ CONNUE qui le demande (point d'accès public de connexion par e-mail). Une personne qui lit la boîte mail d'un technicien
-- obtiendrait donc une session SANS second facteur (aal1) et, jusqu'ici, la sécurité par ligne la laissait lire les conversations,
-- tickets et alertes des clients de ce technicien. Désormais :
--   - chaque table de public reçoit une politique RESTRICTIVE qui exige une session avec second facteur (aal2). Une politique
--     restrictive s'ajoute aux autres (ET logique) : aucune politique existante ne peut l'élargir ;
--   - le salarié, qui se connecte par code (aal1), ne lit plus rien directement : tout passe par la fonction `chat`, qui le borne
--     à ses propres demandes et ne lui montre que les messages publics (ce qu'elle faisait déjà pour l'écriture) ;
--   - côté fonctions, `requireOrgMember` refuse tout rôle autre que salarié sans second facteur (même défense, deuxième couche).
-- Règle pour les futures migrations : toute nouvelle table de public reçoit la même politique (le test 93 le vérifie).

create function private.session_has_second_factor() returns boolean
language sql stable set search_path = '' as
$$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' $$;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
           order by c.relname loop
    -- « (select …) » : évaluée une fois par requête, pas une fois par ligne.
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select private.session_has_second_factor())) with check ((select private.session_has_second_factor()))',
      t || '_second_facteur', t);
  end loop;
end $$;
