-- Lot 9 (roadmap section 11) - dedupe key segment for in-app notifications.
-- The dedupe rule is (user, type, url, dedupeKey, channel, unread, window):
-- alerts that share (type, url) but concern different entities (one broker
-- connection per SYNC_STALE / SYNC_MISMATCH alert) need a distinct key,
-- otherwise the second alert is wrongly suppressed. Nullable: existing rows
-- keep NULL, which only matches other NULL keys.
ALTER TABLE "notification_logs" ADD COLUMN "dedupe_key" TEXT;
