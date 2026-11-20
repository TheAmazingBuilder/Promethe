-- Promethe — database access model for Supabase PostgreSQL.
--
-- IMPORTANT ARCHITECTURE DECISION
-- The application uses its own authentication system (scrypt passwords,
-- opaque httpOnly session cookie, AuthSession table). It does NOT authenticate
-- application users with Supabase Auth. Prisma user IDs are CUID strings,
-- whereas auth.uid() is a Supabase Auth UUID. Therefore auth.uid() policies
-- cannot identify Promethe users and must not be presented as tenant isolation.
--
-- Prisma connects server-side with the database owner role. PostgreSQL table
-- owners bypass RLS unless FORCE ROW LEVEL SECURITY is enabled; forcing RLS
-- without setting a trusted per-transaction user context would break the app
-- and is not a safe substitute for application authorization.
--
-- Current security boundary:
--   1. Browser -> authenticated Promethe API (session cookie).
--   2. API resolves the session with src/server/session.ts.
--   3. Data-access functions must scope every tenant-owned query by userId.
--   4. Supabase anon/authenticated roles receive no direct access to public
--      application tables. The server-only Prisma connection is the data path.
--
-- This script reconciles the Supabase grants with that custom-auth model.
-- It does NOT create per-user RLS. Do not execute it if the project has any
-- separate Supabase Auth / PostgREST client that requires direct public-table
-- access. It does not alter data or table definitions.

BEGIN;

DO $$
DECLARE
  target_table record;
  target_policy record;
BEGIN
  FOR target_table IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    FOR target_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = target_table.schemaname
        AND tablename = target_table.tablename
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON %I.%I',
        target_policy.policyname,
        target_table.schemaname,
        target_table.tablename
      );
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY',
      target_table.schemaname,
      target_table.tablename
    );
  END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

COMMIT;
