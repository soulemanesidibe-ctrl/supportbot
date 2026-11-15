-- Active l'extension pg_cron puis planifie les deux tâches de Relève :
--   releve-purge  : chaque jour à 03 h 17 (UTC), supprime les conversations échues et minimise les charges d'alerte anciennes ;
--   releve-expire : toutes les 10 minutes, met à jour l'état des demandes, relations et accès échus (cosmétique : les droits,
--                   eux, sont évalués à chaque lecture et n'attendent pas cette tâche).
-- À coller dans « SQL Editor » APRÈS appliquer-les-migrations.sql. Sans risque à rejouer : les tâches portent un nom, elles sont
-- remplacées et jamais dupliquées. Résultat attendu : un tableau de deux lignes (releve-expire, releve-purge), active = true.
-- Source : documentation Supabase, « Cron » (https://supabase.com/docs/guides/cron/install). Non testé sur la base locale de
-- test, qui n'a pas pg_cron : le premier essai réel est le vôtre.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule('releve-purge', '17 3 * * *', 'select private.purge_expired()');
select cron.schedule('releve-expire', '*/10 * * * *', 'select private.expire_stale()');

select jobid, jobname, schedule, command, active from cron.job where jobname like 'releve-%' order by jobname;
