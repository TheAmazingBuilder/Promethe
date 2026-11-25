-- Lot 12 (roadmap section 16) - optimistic-concurrency version on
-- dashboard widgets. Every widget PATCH must send the version it last
-- saw; a stale version is rejected with 409 STALE_LAYOUT, so an old
-- autosave can never overwrite a newer layout. Existing rows start at 0.
ALTER TABLE "dashboard_widgets" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
