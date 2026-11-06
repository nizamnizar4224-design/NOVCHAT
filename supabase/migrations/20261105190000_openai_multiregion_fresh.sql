-- Fresh-project upgrade: OpenAI provider + channel-specific regional configuration.
-- Safe to apply after the existing migrations; no legacy columns are dropped.
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS openai_api_key text;
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS openai_text_model text NOT NULL DEFAULT 'gpt-6-luna';
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS openai_image_model text NOT NULL DEFAULT 'gpt-image-2.5-flare';
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS openai_research_model text NOT NULL DEFAULT 'gpt-6-luna';
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS default_research_provider text NOT NULL DEFAULT 'google_trends_rss';

-- Keep any legacy Gemini key isolated; never copy it into the OpenAI key field.
GRANT UPDATE (openai_api_key, openai_text_model, openai_image_model, openai_research_model, default_research_provider)
ON public.api_settings TO authenticated;

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS target_region text NOT NULL DEFAULT 'India';
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS target_country text NOT NULL DEFAULT 'India';
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS primary_language text NOT NULL DEFAULT 'English';
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS secondary_language text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS voice_accent text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS audience_profile text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS research_sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS content_pillars jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS brand_voice text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS upload_days jsonb NOT NULL DEFAULT '[]'::jsonb;
GRANT SELECT (target_region,target_country,primary_language,secondary_language,voice_accent,audience_profile,research_sources,content_pillars,brand_voice,upload_days)
ON public.channels TO authenticated;
GRANT INSERT (target_region,target_country,primary_language,secondary_language,voice_accent,audience_profile,research_sources,content_pillars,brand_voice,upload_days)
ON public.channels TO authenticated;
GRANT UPDATE (target_region,target_country,primary_language,secondary_language,voice_accent,audience_profile,research_sources,content_pillars,brand_voice,upload_days)
ON public.channels TO authenticated;

-- Expose only safe metadata and masked key status to the browser.
CREATE OR REPLACE FUNCTION public.get_settings_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.api_settings%ROWTYPE;
BEGIN
 IF NOT public.is_owner() THEN RAISE EXCEPTION 'not authorized'; END IF;
 SELECT * INTO s FROM public.api_settings WHERE id=1;
 RETURN jsonb_build_object(
  'openai_api_key', public.mask_secret(s.openai_api_key),
  'elevenlabs_api_key', public.mask_secret(s.elevenlabs_api_key),
  'heygen_api_key', public.mask_secret(s.heygen_api_key),
  'assembly_api_key', public.mask_secret(s.assembly_api_key),
  'openai_text_model', s.openai_text_model,
  'openai_image_model', s.openai_image_model,
  'openai_research_model', s.openai_research_model,
  'assembly_provider', s.assembly_provider
 );
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_settings_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_settings_status() TO authenticated;

-- Track each production job and provider spend for operational visibility.
CREATE TABLE IF NOT EXISTS public.generation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 channel_id uuid REFERENCES public.channels(id) ON DELETE CASCADE,
 package_id uuid REFERENCES public.video_packages(id) ON DELETE SET NULL,
 stage text NOT NULL,
 provider text NOT NULL,
 model text,
 status text NOT NULL CHECK (status IN ('started','succeeded','failed')),
 duration_ms integer,
 estimated_cost_usd numeric(12,6),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generation_events_channel_created_idx ON public.generation_events(channel_id,created_at DESC);
ALTER TABLE public.generation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.generation_events FROM anon, authenticated;
GRANT SELECT ON public.generation_events TO authenticated;
CREATE POLICY generation_events_owner_read ON public.generation_events FOR SELECT TO authenticated USING (public.is_owner());
GRANT ALL ON public.generation_events TO service_role;

CREATE OR REPLACE FUNCTION public.get_channels()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_owner() THEN RAISE EXCEPTION 'not authorized'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'id',c.id,'name',c.name,'niche',c.niche,'style_notes',c.style_notes,'enabled',c.enabled,
  'target_region',c.target_region,'target_country',c.target_country,'primary_language',c.primary_language,
  'secondary_language',c.secondary_language,'voice_accent',c.voice_accent,'audience_profile',c.audience_profile,
  'research_sources',c.research_sources,'content_pillars',c.content_pillars,'brand_voice',c.brand_voice,'upload_days',c.upload_days,
  'youtube_privacy',c.youtube_privacy,'prepare_time',c.prepare_time,'publish_time',c.publish_time,'timezone',c.timezone,
  'heygen_avatar_id',c.heygen_avatar_id,'elevenlabs_voice_id',c.elevenlabs_voice_id,
  'last_prepare_at',c.last_prepare_at,'last_publish_at',c.last_publish_at,
  'secrets',jsonb_build_object('youtube_client_id',public.mask_secret(c.youtube_client_id),
  'youtube_client_secret',public.mask_secret(c.youtube_client_secret),'youtube_refresh_token',public.mask_secret(c.youtube_refresh_token))
 ) ORDER BY c.created_at) FROM public.channels c),'[]'::jsonb);
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_channels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channels() TO authenticated;
