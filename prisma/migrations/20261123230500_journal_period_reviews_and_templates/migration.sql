-- Journal qualitative period reviews and reusable preparation templates.
CREATE TABLE "journal_period_reviews" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "period_type" TEXT NOT NULL,
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "what_went_well" TEXT,
  "what_to_improve" TEXT,
  "key_lesson" TEXT,
  "next_commitment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "journal_period_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_period_reviews_period_type_check"
    CHECK ("period_type" IN ('WEEKLY', 'MONTHLY')),
  CONSTRAINT "journal_period_reviews_period_range_check"
    CHECK ("period_start" <= "period_end")
);

CREATE UNIQUE INDEX "journal_period_reviews_user_id_period_type_period_start_key"
  ON "journal_period_reviews"("user_id", "period_type", "period_start");
CREATE INDEX "journal_period_reviews_user_id_period_type_idx"
  ON "journal_period_reviews"("user_id", "period_type");

ALTER TABLE "journal_period_reviews"
  ADD CONSTRAINT "journal_period_reviews_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "journal_templates" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "market_bias" TEXT,
  "pre_market_plan" TEXT,
  "key_levels" TEXT,
  "primary_scenario" TEXT,
  "alternate_scenario" TEXT,
  "invalidation_conditions" TEXT,
  "max_risk_percent" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "journal_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_templates_user_id_name_key"
  ON "journal_templates"("user_id", "name");
CREATE INDEX "journal_templates_user_id_is_default_idx"
  ON "journal_templates"("user_id", "is_default");

ALTER TABLE "journal_templates"
  ADD CONSTRAINT "journal_templates_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
