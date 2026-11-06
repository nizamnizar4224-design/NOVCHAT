/*
# Multi-channel support, reliability, assembly scaffolding, auth hardening

Plain-English summary
Adds everything the second phase of the dashboard needs. Nothing existing is dropped, so
this is safe to apply on top of a working deployment.

1. New table `channels`
   One row per YouTube channel (Finance, Education, Entertainment, ...). Each channel has its
   own YouTube OAuth credentials, privacy, schedule, timezone, ElevenLabs voice, HeyGen avatar
   and niche/style notes. Your existing single-channel configuration is copied into a
   "Main channel" row automatically, and all existing videos are attached to it.

2. `video_packages` additions
   - `channel_id` (which channel owns the video)
   - `script_segments` (timestamped script: narration, camera angle, B-roll, on-screen text)
   - `attempts`, `next_attempt_at`, `failed_from` (retry with exponential backoff + manual retry)
   - `final_video_path`, `assembly_render_id` (future Creatomate / Shotstack assembly step)
   - new status `assembling`

3. `api_settings` additions
   Gemini model IDs (editable in the UI), `assembly_provider` and `assembly_api_key`.
   The old per-channel columns stay in place but are no longer used.

4. Functions
   - `get_settings_status()` now returns masked hints (last 4 characters) instead of booleans.
   - `get_channels()` returns every channel with masked secret hints, never the secrets.
   - `owner_exists()` lets the login screen hide "create owner" once an owner exists.
   - `ensure_scheduler(url)` lets the signed-in owner register the pipeline URL.
   - `invoke_pipeline_tick()` + a pg_cron job calling it every minute (this was missing before,
     so scheduled runs never fired).

5. Security
   - RLS + column-level grants on `channels` (secrets are write-only for browsers).
   - A trigger on `auth.users` blocks any new sign-up once an owner exists, so even with
     public sign-ups enabled nobody else can create an account.

All statements are idempotent.
*/

-- ---------------------------------------------------------------------------
-- 1. channels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  niche text NOT NULL DEFAULT 'general' CHECK (niche IN ('finance', 'education', 'entertainment', 'general')),
  style_notes text CHECK (style_notes IS NULL OR char_length(style_notes) <= 1500),
  enabled boolean NOT NULL DEFAULT true,
  youtube_client_id text,
  youtube_client_secret text,
  youtube_refresh_token text,
  heygen_avatar_id text,
  elevenlabs_voice_id text,
  youtube_privacy text NOT NULL DEFAULT 'private' CHECK (youtube_privacy IN ('public', 'unlisted', 'private')),
  prepare_time text NOT NULL DEFAULT '09:00' CHECK (prepare_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  publish_time text NOT NULL DEFAULT '15:00' CHECK (publish_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text NOT NULL DEFAULT 'UTC',
  last_prepare_at timestamptz,
  last_publish_at timestamptz
);

-- Copy the existing single-channel configuration into a first channel (only when none exist yet).
INSERT INTO channels (
  name, niche, youtube_client_id, youtube_client_secret, youtube_refresh_token,
  heygen_avatar_id, elevenlabs_voice_id, youtube_privacy, prepare_time, publish_time, timezone,
  last_prepare_at, last_publish_at
)
SELECT
  'Main channel', 'general', s.youtube_client_id, s.youtube_client_secret, s.youtube_refresh_token,
  s.heygen_avatar_id, s.elevenlabs_voice_id, s.youtube_privacy, s.prepare_time, s.publish_time, s.timezone,
  p.last_prepare_at, p.last_publish_at
FROM api_settings s
CROSS JOIN pipeline_state p
WHERE s.id = 1 AND p.id = 1
  AND NOT EXISTS (SELECT 1 FROM channels);

-- ---------------------------------------------------------------------------
-- 2. video_packages additions
-- ---------------------------------------------------------------------------
ALTER TABLE video_packages ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE video_packages ADD COLUMN IF NOT EXISTS script_segments jsonb;
ALTER TABLE video_packages ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE video_packages ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE video_packages ADD COLUMN IF NOT EXISTS failed_from text;
ALTER TABLE video_packages ADD COLUMN IF NOT EXISTS final_video_path text;
ALTER TABLE video_packages ADD COLUMN IF NOT EXISTS assembly_render_id text;

UPDATE video_packages
SET channel_id = (SELECT id FROM channels ORDER BY created_at LIMIT 1)
WHERE channel_id IS NULL
  AND EXISTS (SELECT 1 FROM channels);

ALTER TABLE video_packages DROP CONSTRAINT IF EXISTS video_packages_status_check;
ALTER TABLE video_packages ADD CONSTRAINT video_packages_status_check CHECK (
  status IN ('queued', 'voicing', 'thumbnail', 'render_submit', 'rendering', 'assembling', 'ready', 'uploading', 'published', 'failed')
);

CREATE INDEX IF NOT EXISTS video_packages_channel_idx ON video_packages (channel_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. api_settings additions (global, shared by every channel)
-- ---------------------------------------------------------------------------
ALTER TABLE api_settings ADD COLUMN IF NOT EXISTS gemini_text_model text;
ALTER TABLE api_settings ADD COLUMN IF NOT EXISTS gemini_image_model text;
ALTER TABLE api_settings ADD COLUMN IF NOT EXISTS assembly_provider text NOT NULL DEFAULT 'none';
ALTER TABLE api_settings ADD COLUMN IF NOT EXISTS assembly_api_key text;

ALTER TABLE api_settings DROP CONSTRAINT IF EXISTS api_settings_assembly_provider_check;
ALTER TABLE api_settings ADD CONSTRAINT api_settings_assembly_provider_check
  CHECK (assembly_provider IN ('none', 'creatomate', 'shotstack'));

GRANT UPDATE (gemini_text_model, gemini_image_model, assembly_provider, assembly_api_key) ON api_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS, grants and policies for channels
-- ---------------------------------------------------------------------------
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON channels FROM anon, authenticated;

-- Browsers can read only non-secret columns directly (secrets come back as masked hints via get_channels()).
GRANT SELECT (id, created_at, updated_at, name, niche, style_notes, enabled, youtube_privacy,
              prepare_time, publish_time, timezone, heygen_avatar_id, elevenlabs_voice_id,
              last_prepare_at, last_publish_at)
  ON channels TO authenticated;

GRANT INSERT (name, niche, style_notes, enabled, youtube_client_id, youtube_client_secret, youtube_refresh_token,
              heygen_avatar_id, elevenlabs_voice_id, youtube_privacy, prepare_time, publish_time, timezone)
  ON channels TO authenticated;

GRANT UPDATE (name, niche, style_notes, enabled, youtube_client_id, youtube_client_secret, youtube_refresh_token,
              heygen_avatar_id, elevenlabs_voice_id, youtube_privacy, prepare_time, publish_time, timezone, updated_at)
  ON channels TO authenticated;

GRANT DELETE ON channels TO authenticated;
GRANT ALL ON channels TO service_role;

DROP POLICY IF EXISTS "owner_select_channels" ON channels;
CREATE POLICY "owner_select_channels" ON channels FOR SELECT TO authenticated USING (is_owner());

DROP POLICY IF EXISTS "owner_insert_channels" ON channels;
CREATE POLICY "owner_insert_channels" ON channels FOR INSERT TO authenticated WITH CHECK (is_owner());

DROP POLICY IF EXISTS "owner_update_channels" ON channels;
CREATE POLICY "owner_update_channels" ON channels FOR UPDATE TO authenticated USING (is_owner()) WITH CHECK (is_owner());

DROP POLICY IF EXISTS "owner_delete_channels" ON channels;
CREATE POLICY "owner_delete_channels" ON channels FOR DELETE TO authenticated USING (is_owner());

-- ---------------------------------------------------------------------------
-- 5. Functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mask_secret(v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN v IS NULL OR btrim(v) = '' THEN NULL
    WHEN char_length(v) <= 8 THEN '••••'
    ELSE '••••' || right(v, 4)
  END;
$$;

CREATE OR REPLACE FUNCTION get_settings_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s api_settings%ROWTYPE;
BEGIN
  IF NOT is_owner() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO s FROM api_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'gemini_api_key', mask_secret(s.gemini_api_key),
    'elevenlabs_api_key', mask_secret(s.elevenlabs_api_key),
    'heygen_api_key', mask_secret(s.heygen_api_key),
    'assembly_api_key', mask_secret(s.assembly_api_key),
    'gemini_text_model', s.gemini_text_model,
    'gemini_image_model', s.gemini_image_model,
    'assembly_provider', s.assembly_provider
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_channels()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_owner() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'niche', c.niche,
        'style_notes', c.style_notes,
        'enabled', c.enabled,
        'youtube_privacy', c.youtube_privacy,
        'prepare_time', c.prepare_time,
        'publish_time', c.publish_time,
        'timezone', c.timezone,
        'heygen_avatar_id', c.heygen_avatar_id,
        'elevenlabs_voice_id', c.elevenlabs_voice_id,
        'last_prepare_at', c.last_prepare_at,
        'last_publish_at', c.last_publish_at,
        'secrets', jsonb_build_object(
          'youtube_client_id', mask_secret(c.youtube_client_id),
          'youtube_client_secret', mask_secret(c.youtube_client_secret),
          'youtube_refresh_token', mask_secret(c.youtube_refresh_token)
        )
      )
      ORDER BY c.created_at
    )
    FROM channels c
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION owner_exists()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM app_owner);
$$;

CREATE OR REPLACE FUNCTION ensure_scheduler(p_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_owner() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_url IS NULL OR p_url !~ '^https://[A-Za-z0-9.-]+/functions/v1/pipeline$' THEN
    RAISE EXCEPTION 'invalid pipeline url';
  END IF;
  UPDATE cron_config SET function_url = p_url WHERE id = 1 AND function_url IS DISTINCT FROM p_url;
END;
$$;

CREATE OR REPLACE FUNCTION invoke_pipeline_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg cron_config%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM cron_config WHERE id = 1;
  IF cfg.function_url IS NULL OR cfg.function_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cfg.secret),
    body := jsonb_build_object('action', 'tick'),
    timeout_milliseconds := 5000
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_channels() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION ensure_scheduler(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION invoke_pipeline_tick() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_settings_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_channels() TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_scheduler(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_settings_status() TO authenticated;
GRANT EXECUTE ON FUNCTION owner_exists() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Scheduler: wake the pipeline every minute (the function URL is registered by the app on owner sign-in)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'pipeline-tick';
  PERFORM cron.schedule('pipeline-tick', '* * * * *', 'SELECT public.invoke_pipeline_tick()');
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Auth hardening: no new accounts once the owner exists
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_signup_after_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_owner) THEN
    RAISE EXCEPTION 'Sign-ups are closed: this dashboard already has an owner.';
  END IF;
  RETURN NEW;
END;
$$;

-- Isolated so a permissions problem on the auth schema can never abort the rest of this migration.
-- If it is skipped, turn off "Allow new users to sign up" in Supabase Auth settings instead.
DO $$
BEGIN
  DROP TRIGGER IF EXISTS block_signup_after_owner ON auth.users;
  CREATE TRIGGER block_signup_after_owner
    BEFORE INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.block_signup_after_owner();
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not install the sign-up blocking trigger. Disable public sign-ups in Supabase Auth settings instead.';
END
$$;
