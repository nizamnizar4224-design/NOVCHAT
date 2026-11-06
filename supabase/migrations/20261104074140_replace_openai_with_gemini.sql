/*
# Replace OpenAI with Google Gemini

Plain-English summary
Adds a new column for the Google Gemini API key, updates the settings status function to
report on the Gemini key instead of the OpenAI key, and grants the owner permission to
update it. The old openai_api_key column is left in place but no longer used.

1. Modified Tables
- `api_settings`: added `gemini_api_key` (text, nullable).

2. Modified Functions
- `get_settings_status()`: now returns `gemini_api_key` (boolean: set/not set) instead of
  `openai_api_key`.

3. Security
- Grants UPDATE on the new `gemini_api_key` column to `authenticated` (owner only, via RLS).

4. Important Notes
- The old `openai_api_key` column is not dropped or modified, preserving any existing data.
- Safe to re-run.
*/

ALTER TABLE api_settings ADD COLUMN IF NOT EXISTS gemini_api_key text;

GRANT UPDATE (gemini_api_key) ON api_settings TO authenticated;

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
    'gemini_api_key', s.gemini_api_key IS NOT NULL AND s.gemini_api_key <> '',
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

REVOKE EXECUTE ON FUNCTION get_settings_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_settings_status() TO authenticated;
