# Creatomate-only testing deployment

## New pipeline
1. OpenAI creates the script and scene plan.
2. ElevenLabs creates the voiceover.
3. The pipeline sends the voiceover URL, title, captions and scene plan to Creatomate.
4. When Creatomate finishes, the MP4 is saved to `video-assets`.
5. Thumbnail generation runs last. If it fails, the finished video remains `ready` and can still be published.

HeyGen submission is no longer used. Legacy jobs in `render_submit` / `rendering` are redirected to the Creatomate stage.

## Creatomate template requirements
In Studio Autopilot > Settings > Video editing:
- Editing provider: `Creatomate`
- Editing provider API key: your Creatomate API key
- Creatomate Template ID: the template ID from Creatomate

The template needs dynamic elements with these exact names:
- `Video-Title`
- `Narration-Audio` (audio element)
- `Caption-Text`
- `Scene-Plan`

The template must include its own visual/background layers and a timeline long enough for the narration. The current integration passes each scene's B-roll description in `Scene-Plan`; it does not fetch stock footage automatically. For actual changing B-roll footage, add matching video/image layers to the Creatomate template or a stock-footage source/API in a later iteration.

## Deploy
1. Replace the changed files in the matching paths, or deploy the full project ZIP.
2. Push to GitHub / deploy the frontend to Vercel as usual.
3. Deploy the Supabase Edge Function:

```bash
supabase functions deploy pipeline
```

No new database migration is required; the existing `assembling`, `thumbnail`, `final_video_path`, and `assembly_render_id` schema is used.

## Test notes
- A successful Creatomate render has not been verified against the user's live account or template.
- Check that the template dynamic element names and types match exactly before running a paid render.
