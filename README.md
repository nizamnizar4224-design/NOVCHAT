# Studio Autopilot — OpenAI Multi-Region Edition

A Vite + React dashboard backed by Supabase Auth, Postgres, Storage and Edge Functions. It is designed for one owner managing multiple YouTube channels with independent region, country, language, voice, schedule and publishing credentials.

## What is included

- Existing dashboard pages: Overview, Channels, Videos and API Settings.
- OpenAI Responses API for script generation (model ID is editable in Settings; default `gpt-6-luna`).
- OpenAI Images API for thumbnails (editable model ID; default `gpt-image-2.5-flare`).
- Per-channel target region/country/language fields, and regional Google Trends RSS feed selection.
- Existing ElevenLabs, HeyGen, YouTube OAuth/upload and Supabase pipeline integrations retained.
- Private Supabase Storage, RLS, owner-only dashboard, retry/backoff pipeline and cron scheduler.
- Generation event table for future cost/quality monitoring.

## Important honest limits

This is a deployable source project, not a hosted turnkey service. You must create your own Supabase project, configure OAuth/API credentials and deploy the Edge Function. External services charge separately and their API access/quotas are controlled by those providers.

The existing `assembly.ts` is still an adapter interface/scaffold: Creatomate and Shotstack are not yet implemented. Until one is implemented and tested with your account, the pipeline can produce the HeyGen render but cannot promise the advanced B-roll/caption/cut assembly. The project must not be described as end-to-end fully tested before a private test-channel run.

Regional trend discovery currently uses Google Trends RSS country feeds. It is a discovery signal, not a complete real-time news research service. For production-grade factual scripts, connect a licensed news/search provider and retain source URLs, timestamps and verification in the script package. A region setting does not guarantee YouTube distribution in that region.

## Fresh setup (new GitHub + new Supabase + new Vercel)

1. Extract this ZIP and create a **new private GitHub repository**. Push the project root (the folder containing `package.json`).
2. Create a **new Supabase project**. Do not connect the old Supabase project.
3. Install Supabase CLI and run:

   ```bash
   supabase login
   supabase link --project-ref YOUR_NEW_PROJECT_REF
   supabase db push
   supabase functions deploy pipeline --no-verify-jwt
   ```

   This applies all migrations in order, including `20261105190000_openai_multiregion_fresh.sql`.
4. In Supabase → Project Settings → API, copy the Project URL and anon key. In Vercel, import the new GitHub repository and add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy from Vercel. In Supabase Auth, set the Site URL and allowed redirect URL to your Vercel domain. Disable public signups after creating your owner account (the migration also installs an owner lock trigger where permissions allow).
6. Open the site and create the first owner account.
7. In API Settings, enter OpenAI, ElevenLabs and HeyGen keys. Default model IDs: `gpt-6-luna` and `gpt-image-2.5-flare`. These are editable and must be enabled for your OpenAI account. API billing is separate from ChatGPT Free/Plus subscriptions.
8. Create a channel and choose its target region, country and language. Add its ElevenLabs voice ID, HeyGen avatar ID and YouTube OAuth credentials.
9. For YouTube, create OAuth credentials in Google Cloud, enable YouTube Data API v3, complete OAuth consent, and save the refresh token per channel. Begin with upload privacy set to `private`.
10. Run one manual generation and verify topic, script, voice, thumbnail, HeyGen render and private YouTube upload before enabling schedules.

## Vercel / Supabase secrets

Supabase Edge Function secrets (never put service-role keys in Vercel client variables):

```bash
supabase secrets set SUPABASE_URL="https://YOUR_REF.supabase.co" SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

The API keys entered in the owner-only API Settings UI are stored in the private `api_settings` row and read only by the Edge Function using the service role. The browser receives masked key hints only.

## Cost and safety controls before scale

- Set OpenAI project monthly budgets/rate limits and provider-side usage alerts.
- Use per-channel daily generation caps and a manual approval step before public uploads.
- Keep YouTube uploads private/unlisted during testing.
- Add an editorial review for finance, health, crime, cybersecurity and breaking-news topics.
- Store citations/source URLs and factual verification; do not fabricate quotes or claim unverified attacks.
- Add idempotency keys and job locks before running many channels concurrently.
- Monitor provider usage, render failures, retries, queue age and YouTube upload errors.
- Confirm rights/licensing for stock footage, music, fonts and generated assets.

## Build

```bash
npm ci
npm run typecheck
npm run build
```
