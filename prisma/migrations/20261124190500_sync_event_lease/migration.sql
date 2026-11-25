-- Lot 2 (Broker Sync, concurrent idempotence): lease + attempts on sync_event_logs.
-- Backwards compatible: both columns are nullable / defaulted, so existing rows
-- are untouched. Existing FAILED rows stay retryable; existing PROCESSED /
-- REJECTED rows stay terminal. No data migration needed.
ALTER TABLE "sync_event_logs" ADD COLUMN "lease_expires_at" TIMESTAMPTZ;
ALTER TABLE "sync_event_logs" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
