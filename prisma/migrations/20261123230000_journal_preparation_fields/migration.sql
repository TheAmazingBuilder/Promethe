-- Structured preparation and psychology fields for the Journal.
-- Nullable columns keep all previously saved Journal entries valid.
ALTER TABLE "journal_entries"
  ADD COLUMN "key_levels" TEXT,
  ADD COLUMN "primary_scenario" TEXT,
  ADD COLUMN "alternate_scenario" TEXT,
  ADD COLUMN "invalidation_conditions" TEXT,
  ADD COLUMN "max_risk_percent" TEXT,
  ADD COLUMN "stress_level" INTEGER,
  ADD COLUMN "energy_level" INTEGER,
  ADD COLUMN "focus_level" INTEGER,
  ADD COLUMN "next_session_commitment" TEXT;

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_stress_level_check"
    CHECK ("stress_level" IS NULL OR ("stress_level" >= 1 AND "stress_level" <= 5)),
  ADD CONSTRAINT "journal_entries_energy_level_check"
    CHECK ("energy_level" IS NULL OR ("energy_level" >= 1 AND "energy_level" <= 5)),
  ADD CONSTRAINT "journal_entries_focus_level_check"
    CHECK ("focus_level" IS NULL OR ("focus_level" >= 1 AND "focus_level" <= 5));
