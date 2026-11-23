-- Add immutable answer snapshots for user-defined trade review questions.
ALTER TABLE "trade_reviews" ADD COLUMN "custom_answers" TEXT;
