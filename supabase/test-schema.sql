-- Dedicated integration-test schema in the SAME Supabase project.
-- Run once in the Supabase SQL Editor as the postgres/database owner.
-- Automated tests and prisma db push must use schema=promethe_test, never public.

CREATE SCHEMA IF NOT EXISTS promethe_test AUTHORIZATION postgres;
GRANT USAGE, CREATE ON SCHEMA promethe_test TO postgres;
