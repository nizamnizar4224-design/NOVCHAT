-- Add a private Pixabay API key for optional per-scene stock video search.
ALTER TABLE public.api_settings ADD COLUMN IF NOT EXISTS pixabay_api_key text;
GRANT UPDATE (pixabay_api_key) ON public.api_settings TO authenticated;

-- Expose only a masked hint; never return the actual key to the browser.
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
    'pixabay_api_key', public.mask_secret(s.pixabay_api_key),
    'openai_text_model', s.openai_text_model,
    'openai_image_model', s.openai_image_model,
    'openai_research_model', s.openai_research_model,
    'assembly_provider', s.assembly_provider
  );
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_settings_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_settings_status() TO authenticated;
