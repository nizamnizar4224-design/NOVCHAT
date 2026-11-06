# Studio Autopilot v2: what changed and how to deploy it

## What was added

| Request | What you get |
|---|---|
| 1. Single-user security | Login screen only offers "create owner" while **no owner exists**. After that, a database trigger blocks every new sign-up (even if public sign-ups are enabled). Master password can be changed from **API Settings > Security**. All data is behind RLS tied to the single owner row. |
| 2. In-app API keys | **API Settings** page: Gemini, ElevenLabs, HeyGen, editing-provider keys, Gemini model IDs. Stored in the database, never in `.env`. The browser shows only the last 4 characters of a saved key (see note below). |
| 3. Multi-channel | New **Channels** page. Each channel has its own niche (Finance / Education / Entertainment / General), style notes, YouTube credentials, privacy, ElevenLabs voice, HeyGen avatar, schedule and timezone. Your existing setup is migrated into a "Main channel". |
| 4. Better scripts | Gemini returns 10-14 segments, each with narration, camera angle, B-roll idea and on-screen text. Timestamps are computed from the narration and then **rescaled to the real ElevenLabs audio length**. Shown as a "Script timeline" in each video's detail panel. Niche rules are injected into the prompt (e.g. finance adds a not-financial-advice disclaimer). |
| 5. Editing pipeline | `assembly.ts` defines the provider interface, a provider-neutral edit job (avatar video + B-roll clips + caption cues), an `assembling` status and `final_video_path`. **No Creatomate/Shotstack adapter is connected yet**; see "Honest limits". |
| 6. Reliability | Every provider call has timeouts + retries with exponential backoff and jitter (honors `Retry-After`). A step that still fails is rescheduled (about 1, 2, 4, 8 min) up to 5 attempts, then marked failed with a **Retry** button. Scheduler jobs tolerate a late tick (30-minute catch-up window). The scheduler itself (pg_cron) is now actually created. |

Other fixes included: the publish queue no longer gets stuck on a video with no file; the Gemini key moved from the URL to a header; thumbnails are requested at 16:9 and uploaded with their true MIME type; stuck HeyGen renders time out after 3 hours; new channels default to **private** uploads.

## Deploy

### Option A: Bolt
1. Replace your project files with this folder (keep your existing `.env`).
2. Ask Bolt: *"Apply the new migration `20261104120000_multi_channel_reliability.sql` and redeploy the `pipeline` edge function."*
3. Open the app and sign in. On sign-in the app registers the pipeline URL for the scheduler automatically.

### Option B: Supabase CLI
```bash
supabase link --project-ref <your-project-ref>
supabase db push                         # applies the new migration
supabase functions deploy pipeline --no-verify-jwt
```
(`--no-verify-jwt` matches your existing `config.toml`; the function does its own owner / cron-secret checks.)

### After deploying
1. **API Settings**: confirm your keys show as saved; re-enter any you want to change.
2. **Channels**: open "Main channel", give it a name and niche, then **Add channel** for each extra channel. Each needs its own YouTube refresh token.
3. Use **Generate new video** on one channel, then check the Videos page: you should see the Script timeline.
4. If the sign-up trigger could not be installed (the migration prints a notice), turn off **Authentication > Providers > Email > Allow new users to sign up** in Supabase.

## Verify the scheduler is running
```sql
select jobname, schedule, active from cron.job where jobname = 'pipeline-tick';
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select function_url is not null as registered from cron_config;
```
`registered` becomes true the first time the owner opens the dashboard.

## Honest limits (please read)
- **node-cron is not used.** Supabase Edge Functions are short-lived serverless workers, so a long-running node-cron process can't live there. `pg_cron` (every minute) plus the persisted `next_attempt_at` column do the same job and survive restarts. If you ever move to your own Node server, `retry.ts` and the step logic port over unchanged.
- **Keys are "viewable" only as a masked hint.** Returning full secrets to the browser would expose them to anyone who gets into your session (or any browser extension / XSS). You can see which key is saved (`••••a1b2`) and replace it. If you really want reveal-on-click, say so and I'll add it behind a password re-prompt.
- **Editing (Creatomate/Shotstack) is scaffolding, not a working integration.** I did not write adapters I can't test against the real APIs. Selecting a provider in Settings is stored but has no effect yet. To add one: implement `AssemblyProvider` in `assembly.ts`, add its id to `IMPLEMENTED`, and register it in `getAssemblyProvider`.
- **Timestamps are estimates aligned to the audio**, not frame-accurate: they come from word counts, rescaled to the MP3 length (assumes ElevenLabs' 128 kbps CBR output).
- **Not run against your live project.** I could type-check and unit-test the pure logic (timeline, retry/backoff, captions, Gemini parsing) and syntax-check every file, but there was no network or database here. Please try one full run on a test channel with **private** visibility first.
- **Check `gemini-2.5-flash-image`.** Google's model list moves quickly; if thumbnail generation 404s, put a current image model ID in API Settings > Gemini models.
- **YouTube:** if your Google Cloud OAuth app is in "Testing" mode, refresh tokens expire after 7 days. Videos made with AI avatars/voices may need the "altered or synthetic content" disclosure toggled in YouTube Studio; the upload API call here does not set it.
- The scheduler pings the function every minute even when idle (a cheap no-op). Disable with `select cron.unschedule('pipeline-tick');`.
