-- Remove the Mentors module (user decision, 25 Nov 2026): the module was never
-- used, no mentor was ever invited, so no data is preserved. Drops the mentor
-- tables, the comment mention rows and the per-trade comment read states, and
-- the Profile handle columns (the @handle system only existed for mentoring
-- and mentions). Trade comments themselves are kept (owner-only notes).
DROP TABLE "comment_mentions";
DROP TABLE "comment_read_states";
DROP TABLE "mentor_access_logs";
DROP TABLE "mentor_accesses";
DROP TABLE "mentor_invitations";
ALTER TABLE "profiles" DROP COLUMN "handle";
ALTER TABLE "profiles" DROP COLUMN "public_display_name";
