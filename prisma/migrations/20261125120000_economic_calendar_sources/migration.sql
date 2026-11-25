-- Lot 10 (roadmap section 12) - economic calendar sources: cross-source
-- dedupe key + per-source timestamps on economic_events, alert prefs on
-- event_watchlists, per-source sync health table.
ALTER TABLE "economic_events" ADD COLUMN "dedupe_key" TEXT;
ALTER TABLE "economic_events" ADD COLUMN "source_meta" TEXT;
ALTER TABLE "economic_events" ADD COLUMN "source_updated_at" TIMESTAMPTZ;
ALTER TABLE "economic_events" ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "economic_events" ALTER COLUMN "impact" DROP NOT NULL;
-- Backfill the dedupe key for rows that predate it. Same rule as
-- buildDedupeKey in src/lib/economic-calendar/providers.ts:
-- slug(title) | UTC date of scheduled_at | country-or-currency.
UPDATE "economic_events"
SET "dedupe_key" = btrim(regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g'), '-') || '|' || to_char("scheduled_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '|' || "currency"
WHERE "dedupe_key" IS NULL;
CREATE UNIQUE INDEX "economic_events_dedupe_key_key" ON "economic_events"("dedupe_key");
ALTER TABLE "event_watchlists" ADD COLUMN "alerts_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "event_watchlists" ADD COLUMN "alert_minutes_before" INTEGER NOT NULL DEFAULT 60;
CREATE TABLE "economic_calendar_sync_states" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "last_sync_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "event_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "economic_calendar_sync_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "economic_calendar_sync_states_source_key" ON "economic_calendar_sync_states"("source");
