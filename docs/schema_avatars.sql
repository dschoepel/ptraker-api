-- =============================================================================
-- Profile Avatars Storage Bucket
-- =============================================================================
-- Creates a public Supabase Storage bucket for user profile images.
-- The API uses the service-role key for all storage operations, so no
-- bucket RLS policies are required.
-- Run in Studio SQL Editor before deploying API changes.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;
