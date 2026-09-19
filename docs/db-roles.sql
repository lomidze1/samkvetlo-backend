-- ADR 0014 §9 (T5.13): least-privilege Postgres roles for prod (Neon).
--
-- Run twice, once on each side of the first `payload migrate` (code review
-- m2 — required order):
--   1. BEFORE the first `payload migrate` — creates the three login roles
--      (samkvetlo_owner must already exist for DATABASE_URL_MIGRATOR to
--      connect as it) and makes samkvetlo_owner own the schema.
--   2. `payload migrate` (as samkvetlo_owner) creates the tables — the
--      ALTER DEFAULT PRIVILEGES from step 1 auto-grants samkvetlo_app/
--      backup access to every one of them as they're created.
--   3. AFTER that migrate — re-run this file. Everything above is already
--      a no-op the second time; the one exception is the guarded REVOKE on
--      `audit_events` near the bottom, which only has a table to act on
--      once step 2 has run, and RAISEs a WARNING (not silently skips) if
--      it's still missing.
-- Connected as the database's owning/superuser role (on Neon: the role
-- Neon creates for the project). Every statement is idempotent — safe to
-- re-run any number of times after that (e.g. after adding a table by
-- hand).
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

-- Code review finding (ADR 0014 §9): the blanket UPDATE/DELETE grant above
-- also covers `audit_events` (login/break-glass trail, ADR 0016), which
-- means a compromised runtime (samkvetlo_app) could erase its own login
-- history — exactly what role separation is supposed to prevent. The app
-- only ever *creates* audit rows (Users.hooks.afterLogin); it never
-- updates or deletes one (AuditEvents.access: update/delete both `() =>
-- false` at the Payload layer already, this is the same rule enforced one
-- layer down, at the database). REVOKE is a no-op (not an error) if the
-- privilege was never granted, so this is safe on a fresh database too.
-- Add the same REVOKE here for any future collection that is meant to be
-- an append-only audit trail.
--
-- Guarded (not a bare REVOKE): this file is meant to be runnable *before*
-- the first `payload migrate` too (a truly fresh database), when
-- `audit_events` doesn't exist yet — a bare `REVOKE ... ON audit_events`
-- would error in that case instead of being the no-op every other
-- statement in this file is when its target doesn't exist yet. Code
-- review m2: a silent skip here is easy to miss (this file's other
-- statements all silently no-op on a fresh database, so nothing about the
-- output looks different) — RAISE WARNING instead, so it shows up in
-- whatever ran this (psql, a migration script, CI logs), and re-run this
-- file after migrating (see the RUN ORDER note at the top) to actually
-- apply the revoke.
-- Round-3 follow-up: this REVOKE is per-object, not per-name. If a future
-- migration ever DROPs and re-CREATEs `audit_events` (e.g. a breaking
-- schema change, rather than an in-place ALTER), the new table is a new
-- object that only inherits the ALTER DEFAULT PRIVILEGES grant above
-- (SELECT/INSERT/UPDATE/DELETE) — this REVOKE does not carry over and
-- must be re-run, or samkvetlo_app silently regains UPDATE/DELETE on it.
DO $$
BEGIN
  IF to_regclass('public.audit_events') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_events FROM samkvetlo_app';
  ELSE
    RAISE WARNING 'db-roles.sql: audit_events does not exist yet — REVOKE UPDATE, DELETE ON audit_events FROM samkvetlo_app was SKIPPED. Run `payload migrate` first, then re-run this file to apply it.';
  END IF;
END
$$;
