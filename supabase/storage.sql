-- Promethe private screenshot bucket.
-- Run once in the Supabase SQL Editor before enabling screenshot uploads.
-- The application accesses this bucket server-side with SUPABASE_SERVICE_ROLE_KEY.
-- Do not add public read policies and never expose the service-role key to clients.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'trade-screenshots',
  'trade-screenshots',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
