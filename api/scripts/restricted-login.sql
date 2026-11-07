-- The restricted database login the API connects as in production (SKILL.md section 24,
-- decision 0453). The API refuses to start in production on any other.
--
-- Run it once per database, as a superuser, after the logins exist and the migrations
-- have run. Running it again changes nothing. The two names are the logins, not
-- placeholders to keep: APP_LOGIN is the one in the API's DATABASE_URL, and OWNER_LOGIN
-- owns the tables and runs the migrations.
--
--   sudo -u postgres psql -d DATABASE -v app=APP_LOGIN -v owner=OWNER_LOGIN \
--     -f api/scripts/restricted-login.sql
--
-- What it gives the API's login: SELECT, INSERT, UPDATE and DELETE on every table, and
-- the use of every sequence, and nothing else. No TRUNCATE, which empties a table
-- without firing the triggers that refuse deletion (section 5); nothing on the migration
-- runner's own history, which the API never reads; and the same, automatically, on every
-- table and sequence a later migration creates, so a new table needs no grant by hand.
--
-- It cannot make the API's login stop owning a table, the database or the schema, or stop
-- being a superuser. The API's startup check reports each, and the remedy is to connect as
-- a different login. Nor does it remove CREATE on public from PUBLIC, which a database
-- upgraded from PostgreSQL 14 or earlier may keep: REVOKE CREATE ON SCHEMA public FROM PUBLIC.

\set ON_ERROR_STOP on

BEGIN;

-- Given the owner's name for both, the rest would strip the owner of its own rights.
SELECT set_config('dfc.app_login', :'app', true), set_config('dfc.owner_login', :'owner', true);
DO $$
BEGIN
  IF current_setting('dfc.app_login') = current_setting('dfc.owner_login') THEN
    RAISE EXCEPTION 'app and owner must be two different logins';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO :"app";
REVOKE CREATE ON SCHEMA public FROM :"app";

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
REVOKE ALL ON schema_migrations FROM :"app";

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app";

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app";

COMMIT;
