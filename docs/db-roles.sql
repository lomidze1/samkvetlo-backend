-- ADR 0014 §9 (T5.13): least-privilege Postgres roles for prod (Neon).
--
-- Run once per database, connected as the database's owning/superuser role
-- (on Neon: the role Neon creates for the project). Idempotent — every
-- statement is safe to run again (e.g. after adding a table by hand, or to
-- re-apply this file on a fresh database).
--
-- Roles and where each connection string is used (ADR 0014 §7):
--   samkvetlo_owner   DDL only.       DATABASE_URL_MIGRATOR — `payload migrate`
--                                     in the Vercel build command only (vercel.json).
--   samkvetlo_app     CRUD, no DDL.   DATABASE_URL — the running app (runtime).
--   samkvetlo_backup  SELECT only.    BACKUP_DATABASE_URL — GitHub Actions
--                                     nightly `pg_dump` (.github/workflows/backup.yml).
--
-- Passwords are deliberately not set here — `CREATE ROLE ... LOGIN` alone
-- cannot be connected to. Set each once after running this file:
--   ALTER ROLE samkvetlo_owner  WITH PASSWORD '<generated>';
--   ALTER ROLE samkvetlo_app    WITH PASSWORD '<generated>';
--   ALTER ROLE samkvetlo_backup WITH PASSWORD '<generated>';
-- (`openssl rand -base64 32`, one value per role, never reused — ADR 0014 §7.)

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'samkvetlo_owner') THEN
    CREATE ROLE samkvetlo_owner WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'samkvetlo_app') THEN
    CREATE ROLE samkvetlo_app WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'samkvetlo_backup') THEN
    CREATE ROLE samkvetlo_backup WITH LOGIN;
  END IF;
END
$$;

-- samkvetlo_owner needs to own the schema: `ALTER DEFAULT PRIVILEGES FOR
-- ROLE samkvetlo_owner` below only covers objects *this* role creates, so
-- payload migrate (running as samkvetlo_owner) must be the one doing the
-- CREATE TABLE for a new migration to auto-grant samkvetlo_app/backup
-- access without editing this file again.
GRANT ALL ON SCHEMA public TO samkvetlo_owner;
ALTER SCHEMA public OWNER TO samkvetlo_owner;
GRANT USAGE ON SCHEMA public TO samkvetlo_app;
GRANT USAGE ON SCHEMA public TO samkvetlo_backup;

-- Existing tables/sequences (running this file after tables already exist —
-- e.g. the first time, on a database `payload migrate` already populated).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO samkvetlo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO samkvetlo_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO samkvetlo_backup;

-- Future tables/sequences: every migration samkvetlo_owner runs from now on
-- grants the same privileges automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE samkvetlo_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO samkvetlo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE samkvetlo_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO samkvetlo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE samkvetlo_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO samkvetlo_backup;

-- samkvetlo_app and samkvetlo_backup intentionally get no CREATE on the
-- schema and no ownership of anything — that absence is what makes
-- `CREATE TABLE ...` fail for them (verified in T5.13's report).
