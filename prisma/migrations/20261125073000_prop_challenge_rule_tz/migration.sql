-- Lot 5 (Prop Firm engine): freeze the challenge's timezone and daily
-- reset time at purchase. Later edits of the reusable rule set must never
-- move the firm-day boundary of a challenge already in progress.
-- Backwards compatible: both columns are nullable, so existing rows are
-- untouched. Legacy rows fall back to the linked rule set at evaluation
-- time (server-side), then UTC / "00:00".
ALTER TABLE "prop_challenges" ADD COLUMN "rule_timezone" TEXT;
ALTER TABLE "prop_challenges" ADD COLUMN "rule_reset_time_local" TEXT;

-- Backfill from the linked rule set where one exists.
UPDATE "prop_challenges" c
SET "rule_timezone" = r."timezone",
    "rule_reset_time_local" = r."reset_time_local"
FROM "prop_firm_rule_sets" r
WHERE c."rule_set_id" = r."id";
