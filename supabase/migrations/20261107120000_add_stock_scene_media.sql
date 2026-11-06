-- Persist selected Pixabay assets for each scene and cache search results for 24 hours.
ALTER TABLE public.video_packages
  ADD COLUMN IF NOT EXISTS scene_assets jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.stock_media_cache (
  query_key text PRIMARY KEY,
  query text NOT NULL,
  storage_path text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  source_url text NOT NULL,
  contributor text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_media_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_media_cache FROM anon, authenticated;
