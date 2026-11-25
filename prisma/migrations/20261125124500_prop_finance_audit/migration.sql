-- §13 (Prop Firm, gestion financiere) - soft delete + audit trail for
-- payouts and expenses. A money movement must never disappear without a
-- trace: deletes become logical (deleted_at) and every create / update /
-- delete / restore writes a permanent PropFinanceAudit row with a
-- before/after snapshot. Totals always read live (non-deleted) rows only.
-- createdAt/updatedAt are backfilled from the business date (requested_at
-- for payouts, date for expenses): no earlier timestamp exists for legacy
-- rows.
ALTER TABLE "prop_payouts" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "prop_payouts" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "prop_payouts" ADD COLUMN "deleted_at" TIMESTAMP(3);
UPDATE "prop_payouts" SET "created_at" = "requested_at", "updated_at" = "requested_at";
ALTER TABLE "prop_expenses" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "prop_expenses" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "prop_expenses" ADD COLUMN "deleted_at" TIMESTAMP(3);
UPDATE "prop_expenses" SET "created_at" = "date", "updated_at" = "date";
CREATE TABLE "prop_finance_audits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "challenge_id" TEXT,
    "kind" TEXT NOT NULL,
    "movement_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before_json" TEXT,
    "after_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prop_finance_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "prop_finance_audits_user_id_challenge_id_created_at_idx" ON "prop_finance_audits"("user_id", "challenge_id", "created_at");
CREATE INDEX "prop_finance_audits_challenge_id_created_at_idx" ON "prop_finance_audits"("challenge_id", "created_at");
ALTER TABLE "prop_finance_audits" ADD CONSTRAINT "prop_finance_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prop_finance_audits" ADD CONSTRAINT "prop_finance_audits_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "prop_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
