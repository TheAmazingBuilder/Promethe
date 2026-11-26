-- §25.5 Offline write queue - idempotency key for offline note creates,
-- mirroring Trade.clientMutationId (v2 §4.2). A replayed create with the
-- same key returns the stored note instead of creating a duplicate.
-- The key is scoped per user (composite unique). NULL keys never
-- collide (Postgres treats NULLs as distinct), so online creates
-- without a key are unaffected. No data rows are created by this
-- migration.
ALTER TABLE "gaia_notes" ADD COLUMN "client_mutation_id" TEXT;

CREATE UNIQUE INDEX "gaia_notes_user_id_client_mutation_id_key" ON "gaia_notes"("user_id", "client_mutation_id");
