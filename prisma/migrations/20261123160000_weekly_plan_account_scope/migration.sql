-- Give each weekly improvement plan its own completion state per account.
ALTER TABLE "weekly_plan_actions"
  ADD COLUMN "account_id" TEXT,
  ADD COLUMN "scope_key" TEXT NOT NULL DEFAULT '__all__';

DROP INDEX "weekly_plan_actions_user_id_week_start_rule_key";
CREATE UNIQUE INDEX "weekly_plan_actions_user_id_week_start_scope_key_rule_key"
  ON "weekly_plan_actions"("user_id", "week_start", "scope_key", "rule");
CREATE INDEX "weekly_plan_actions_user_id_week_start_scope_key_idx"
  ON "weekly_plan_actions"("user_id", "week_start", "scope_key");

ALTER TABLE "weekly_plan_actions"
  ADD CONSTRAINT "weekly_plan_actions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
