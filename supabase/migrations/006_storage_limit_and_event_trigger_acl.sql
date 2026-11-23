-- Bendor-X: align the community image bucket with the frontend upload limit
-- and keep the RLS event-trigger helper unavailable to client API roles.
-- Existing files, records, and bucket visibility are preserved.
BEGIN;

UPDATE storage.buckets
SET file_size_limit = 8388608,
    allowed_mime_types = ARRAY['image/jpeg']::text[]
WHERE id = 'community-media';

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
