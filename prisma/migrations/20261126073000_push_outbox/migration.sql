-- §25.4 Web Push - durable delivery queue for push notifications.
-- Mirrors the integrations outbox (outbound_messages) in shape: claim,
-- retry with exponential backoff, DEAD after N attempts. One row per
-- (alert instance, device): dedupe_key is the in-app notification row id,
-- unique per subscription, so a re-enqueue of the same alert is a no-op
-- while a later alert instance always gets a fresh row. No data rows are
-- created by this migration.
CREATE TABLE "push_outbox" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_outbox_subscription_id_dedupe_key_key" ON "push_outbox"("subscription_id", "dedupe_key");
CREATE INDEX "push_outbox_status_next_attempt_at_idx" ON "push_outbox"("status", "next_attempt_at");
CREATE INDEX "push_outbox_user_id_created_at_idx" ON "push_outbox"("user_id", "created_at");

ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
