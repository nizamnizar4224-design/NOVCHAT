# Pixabay relevance & scene editing upgrade

## How stock selection works now
1. **Queries** (`stock.ts → buildSearchPlan`): per scene, short subject-first queries (1-3 words) are built from the script
   model's optional `search_queries` / `subject_keywords`, the scene's B-roll text, label, on-screen text and narration. Generic words
   (person, hand), filler verbs and synonym duplicates are removed; related ideas are added (smartphone → "mobile phone",
   mutual fund → "investment", "financial planning"). The closing scene never searches for subscribe/bell/like.
2. **Scoring** (`scoreHit`): every returned hit is scored against weighted subject concepts using whole-word/stem/synonym matching
   on Pixabay's tags (+ URL slug). A hit must match a real, non-generic subject ("anchor") and reach a minimum score. Nature/abstract
   tags unrelated to the scene are penalised (ocean/storm/flowers for a phone scene). Portrait and sub-2.5s clips are rejected.
3. **Retries**: up to 5 video queries, then up to 3 image queries, then (last resort) 2 topic-level queries, all before any branded background.
4. **No duplicates**: a per-video ledger of `video:<id>` / `image:<id>` keys is checked for every scene; near-identical tag sets are penalised.
   If nothing unused and relevant remains, the scene is left to the branded backdrop rather than reusing or inventing footage.
5. **Duration**: a clip is used only up to its native length minus 0.15s (never looped/stretched). A single clip that covers the scene is
   preferred; otherwise up to 4 different relevant clips are stitched; any remainder is filled with relevant images (zoom in/out,
   ≤10s each). Only the first N seconds of a longer clip are used (Pixabay gives no per-segment metadata).
6. **Branded background** appears only for scenes/time ranges where no relevant asset was found. `video_packages.scene_assets` records,
   per scene, the status, queries tried, chosen asset IDs/pages/scores/tags, so you can audit every choice.
7. Pixabay requests are cached per video, throttled below 100/min, capped at 90 per video, and searching stops after 3 consecutive failures.
8. **Fair-share search budget** (`SearchBudget` in `stock.ts`): time and requests are divided across the scenes still waiting
   (time slice clamped to 4-10s, request allowance at least 4), so early scenes cannot starve later ones. Unspent budget carries forward.
   Every scene may always run at least one video search and one image search. A 90s hard limit for the whole video is only a safety net.
   Relevance thresholds are unchanged: a bigger budget never lowers the bar, and unmatched scenes keep the branded background.

## Rendering changes (Creatomate; same 1920x1080, same frame rate)
* Root cause of mis-positioned text: elements used `x:"10%"` with Creatomate's default centre anchor. All text/shapes are now explicitly
  centre-anchored (`x/y = 50%`, `x_anchor/y_anchor = 50%`), width 80% (10% safe margins). The old dark overlay only covered one quadrant; now full-frame.
* Headlines centred (hook larger and uppercased, shown ≤6s; other scenes ≤4.5s so footage stays visible). Subtitles sit on a separate 86% line.
* Percent-valued properties (`opacity`, `volume`, `scale`) are now strings such as `"30%"`, as Creatomate documents.
* Closing scene: "LIKE & SUBSCRIBE" title, 👍 icon, red SUBSCRIBE button that "clicks" into grey SUBSCRIBED, 🔔 bell that rings, labels, timed to the
  words "like"/"subscribe" in the final narration.

## Other fix
`retryPackage` now clears `assembly_render_id` when resuming at `assembling`; before, retrying a failed render re-polled the same failed render forever.

## Script prompt
Two optional JSON fields were added to each segment (`search_queries`, `subject_keywords`). The model, model setting and pricing tier are unchanged.
Old packages without these fields still work via the deterministic query builder.

## Deploy
1. **SQL**: no new migration. `scene_assets` comes from the existing `20261107120000_add_stock_scene_media.sql`.
   If you never applied it, run it once (SQL Editor, or `supabase db push`). Without it everything works, only the audit data isn't saved.
2. **Supabase function**: `supabase functions deploy pipeline --no-verify-jwt` (or push to `main`; the GitHub Action deploys it).
3. **Vercel**: push to GitHub. Only `src/types.ts` changed in the frontend (type-only), no env var changes.
4. Make sure the Pixabay key is saved in Settings. Then create a **new** video (existing finished videos are not re-rendered).
5. Audit: `select id, scene_assets from video_packages order by created_at desc limit 1;`

## Tests
`npm run test:pipeline` (Node 22+). 25 tests: relevance rejection (incl. the old matcher's false positives), query generation, retries, duplicates,
duration planning, image fill, fair-share search budget (including a replay of the old global deadline), CTA timing, centring/safe margins, Pixabay client budget/429/failure handling.
