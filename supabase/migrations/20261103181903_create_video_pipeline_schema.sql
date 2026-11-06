/*
# Create video pipeline schema (single-owner dashboard)

Plain-English summary
This migration sets up everything the private YouTube automation dashboard needs:
the owner lock, encrypted-at-rest style API key storage (readable only by server code),
the live pipeline status row, the video history table, and a private file bucket for
generated voiceovers, thumbnails and videos.

1. New Tables
- `app_owner`: a single-row table holding the one user allowed to use the dashboard.
- `api_settings`: a single-row table with the API keys, YouTube OAuth credentials,
  avatar/voice IDs, publish privacy and the two daily schedule times.
- `pipeline_state`: a single-row table with the live status text, whether a job is running,
  and when each job last ran.
- `video_packages`: one row per generated video (topic, title, description, tags, script,
  file locations, status, YouTube link, errors).
- `cron_config`: a single-row table holding the shared secret and public function URL that
  the scheduler uses to call the pipeline. Not readable by the browser.

2. Functions
- `is_owner()`: true when the signed-in user is the registered owner.
- `claim_owner()`: lets the first signed-in account become the owner. Once an owner exists,
  nobody else can claim it.
- `get_settings_status()`: tells the dashboard which keys are saved, without ever returning them.

3. Storage
- Private bucket `video-assets` for voiceovers, thumbnails and final videos. No public access.

4. Security
- Row Level Security is enabled on every table.
- Browsers can only read non-secret settings, never the API key columns.
- Browsers can only update settings and read status/history, and only when they are the owner.
- Only server-side code (service role) can write pipeline state and video history.

5. Important Notes
- All statements are idempotent and safe to re-run.
- Seed rows are inserted for the single-row tables so updates always have a target.
*/

CREATE TABLE IF NOT EXISTS app_owner (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  openai_api_key text,
  youtube_client_id text,
  youtube_client_secret text,
  youtube_refresh_token text,
  heygen_api_key text,
  elevenlabs_api_key text,
  heygen_avatar_id text,
  elevenlabs_voice_id text,
  youtube_privacy text NOT NULL DEFAULT 'public' CHECK (youtube_privacy IN ('public', 'unlisted', 'private')),
  prepare_time text NOT NULL DEFAULT '09:00' CHECK (prepare_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  publish_time text NOT NULL DEFAULT '15:00' CHECK (publish_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  running boolean NOT NULL DEFAULT false,
  activity text NOT NULL DEFAULT 'Idle',
  activity_updated_at timestamptz NOT NULL DEFAULT now(),
  last_prepare_at timestamptz,
  last_publish_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS video_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'voicing', 'thumbnail', 'render_submit', 'rendering', 'ready', 'uploading', 'published', 'failed')),
  topic text,
  title text,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  script text,
  thumbnail_prompt text,
  voice_path text,
  thumbnail_path text,
  video_path text,
  heygen_video_id text,
  youtube_video_id text,
  youtube_url text,
  error_message text
);

CREATE INDEX IF NOT EXISTS video_packages_status_idx ON video_packages (status);
CREATE INDEX IF NOT EXISTS video_packages_created_idx ON video_packages (created_at DESC);

CREATE TABLE IF NOT EXISTS cron_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  function_url text
);

INSERT INTO app_owner (id, user_id) SELECT true, NULL WHERE false ON CONFLICT DO NOTHING;
INSERT INTO api_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO pipeline_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO cron_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON app_owner, api_settings, pipeline_state, video_packages, cron_config FROM anon, authenticated;

CREATE OR REPLACE FUNCTION is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM app_owner WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION claim_owner()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO app_owner (id, user_id)
  SELECT true, auth.uid()
  WHERE NOT EXISTS (SELECT 1 FROM app_owner);
  RETURN is_owner();
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
    'openai_api_key', s.openai_api_key IS NOT NULL AND s.openai_api_key <> '',
    'youtube_client_id', s.youtube_client_id IS NOT NULL AND s.youtube_client_id <> '',
    'youtube_client_secret', s.youtube_client_secret IS NOT NULL AND s.youtube_client_secret <> '',
    'youtube_refresh_token', s.youtube_refresh_token IS NOT NULL AND s.youtube_refresh_token <> '',
    'heygen_api_key', s.heygen_api_key IS NOT NULL AND s.heygen_api_key <> '',
    'elevenlabs_api_key', s.elevenlabs_api_key IS NOT NULL AND s.elevenlabs_api_key <> '',
    'heygen_avatar_id', s.heygen_avatar_id,
    'elevenlabs_voice_id', s.elevenlabs_voice_id,
    'youtube_privacy', s.youtube_privacy,
    'prepare_time', s.prepare_time,
    'publish_time', s.publish_time,
    'timezone', s.timezone
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION is_owner() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION claim_owner() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_settings_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION claim_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION get_settings_status() TO authenticated;

GRANT SELECT ON app_owner TO authenticated;
DROP POLICY IF EXISTS "owner_select_self" ON app_owner;
CREATE POLICY "owner_select_self" ON app_owner FOR SELECT
TO authenticated USING (user_id = auth.uid());

GRANT SELECT (id, updated_at, youtube_privacy, prepare_time, publish_time, timezone, heygen_avatar_id, elevenlabs_voice_id),
      UPDATE (openai_api_key, youtube_client_id, youtube_client_secret, youtube_refresh_token, heygen_api_key, elevenlabs_api_key, heygen_avatar_id, elevenlabs_voice_id, youtube_privacy, prepare_time, publish_time, timezone, updated_at)
ON api_settings TO authenticated;

DROP POLICY IF EXISTS "owner_select_settings" ON api_settings;
CREATE POLICY "owner_select_settings" ON api_settings FOR SELECT
TO authenticated USING (is_owner());

DROP POLICY IF EXISTS "owner_update_settings" ON api_settings;
CREATE POLICY "owner_update_settings" ON api_settings FOR UPDATE
TO authenticated USING (is_owner()) WITH CHECK (is_owner());

GRANT SELECT ON pipeline_state TO authenticated;
DROP POLICY IF EXISTS "owner_select_pipeline_state" ON pipeline_state;
CREATE POLICY "owner_select_pipeline_state" ON pipeline_state FOR SELECT
TO authenticated USING (is_owner());

GRANT SELECT ON video_packages TO authenticated;
DROP POLICY IF EXISTS "owner_select_video_packages" ON video_packages;
CREATE POLICY "owner_select_video_packages" ON video_packages FOR SELECT
TO authenticated USING (is_owner());

GRANT ALL ON app_owner, api_settings, pipeline_state, video_packages, cron_config TO service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('video-assets', 'video-assets', false)
ON CONFLICT (id) DO NOTHING;
