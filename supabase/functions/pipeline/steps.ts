import {
  type Channel,
  createSignedFileUrl,
  cleanupTemporaryStockAssets,
  db,
  downloadFile,
  loadChannel,
  loadChannels,
  type PackageStatus,
  requireFields,
  setActivity,
  type Settings,
  updatePackage,
  uploadFile,
  type VideoPackage,
} from "./db.ts";
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_TEXT_MODEL,
  downloadRemoteFile,
  fetchTrendingTopics,
  generateThumbnailImage,
  synthesizeVoiceover,
  writeScriptPackage,
} from "./providers.ts";
import { getYouTubeAccessToken, setYouTubeThumbnail, uploadYouTubeVideo } from "./youtube.ts";
import { isRetryableError, PermanentError, stepBackoffMs } from "./retry.ts";
import { estimateMp3Seconds, rescaleTimeline, splitIntoVisualBeats } from "./timeline.ts";
import { type AssemblyJob, type BrollClip, buildAssemblyJob, getAssemblyProvider } from "./assembly.ts";
import { PixabayClient } from "./pixabay.ts";
import { createLedger, DEFAULT_SEARCH_BUDGET, planScene, type ScenePlan, SearchBudget } from "./stock.ts";

const IN_FLIGHT: PackageStatus[] = ["queued", "voicing", "render_submit", "rendering", "assembling", "thumbnail"];
const SIGNED_LINK_TTL_SECONDS = 6 * 3600;
const MAX_STEP_ATTEMPTS = 5;

export function requirePrepareConfig(s: Settings, channel: Channel): void {
  requireFields(s, ["openai_api_key", "elevenlabs_api_key"], "API Settings");
  requireFields(channel, ["elevenlabs_voice_id"], `the "${channel.name}" channel settings`);
}

export function requirePublishConfig(channel: Channel): void {
  requireFields(
    channel,
    ["youtube_client_id", "youtube_client_secret", "youtube_refresh_token"],
    `the "${channel.name}" channel settings`,
  );
}

export async function createPackage(channelId: string): Promise<void> {
  const { error } = await db.from("video_packages").insert({ status: "queued", channel_id: channelId });
  if (error) throw new Error(`Could not create video entry: ${error.message}`);
}

async function recentTopics(channelId: string): Promise<string[]> {
  const { data, error } = await db
    .from("video_packages")
    .select("topic")
    .eq("channel_id", channelId)
    .not("topic", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Could not read past topics: ${error.message}`);
  return (data ?? []).map((row) => row.topic as string);
}

async function writeScriptStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  await setActivity(`[${channel.name}] Analyzing trends`);
  const trends = await fetchTrendingTopics(channel.target_region ?? "US");
  const past = await recentTopics(channel.id);
  await setActivity(`[${channel.name}] Writing script with OpenAI`);
  const written = await writeScriptPackage(
    s.openai_api_key!,
    s.openai_text_model?.trim() || DEFAULT_OPENAI_TEXT_MODEL,
    channel,
    trends,
    past,
  );
  await updatePackage(pkg.id, { ...written, status: "voicing" });
  return "voicing";
}

async function voiceStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  await setActivity(`[${channel.name}] Generating voiceover with ElevenLabs`);
  const audio = await synthesizeVoiceover(s.elevenlabs_api_key!, channel.elevenlabs_voice_id!, pkg.script!);
  const path = `${pkg.id}/voiceover.mp3`;
  await uploadFile(path, audio, "audio/mpeg");
  // Align the estimated timestamps with the real audio length.
  const segments = pkg.script_segments
    ? rescaleTimeline(pkg.script_segments, estimateMp3Seconds(audio.byteLength))
    : null;
  await updatePackage(pkg.id, {
    voice_path: path,
    status: "assembling",
    ...(segments ? { script_segments: segments } : {}),
  });
  return "assembling";
}

async function thumbnailStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  // Thumbnail is deliberately last and non-blocking during the Creatomate testing phase.
  try {
    await setActivity(`[${channel.name}] Creating thumbnail image`);
    const image = await generateThumbnailImage(
      s.openai_api_key!,
      s.openai_image_model?.trim() || DEFAULT_OPENAI_IMAGE_MODEL,
      pkg.thumbnail_prompt ?? `Professional YouTube thumbnail for: ${pkg.title ?? pkg.topic ?? "this video"}`,
    );
    const path = `${pkg.id}/thumbnail.${image.extension}`;
    await uploadFile(path, image.bytes, image.mimeType);
    await updatePackage(pkg.id, { thumbnail_path: path, status: "ready", attempts: 0, next_attempt_at: null, error_message: null });
    await setActivity(`[${channel.name}] Creatomate video and thumbnail ready`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updatePackage(pkg.id, { status: "ready", error_message: `Thumbnail skipped: ${message}`.slice(0, 500), attempts: 0, next_attempt_at: null });
    await setActivity(`[${channel.name}] Video ready; thumbnail skipped: ${message}`.slice(0, 300));
  }
  return "ready";
}

const DOWNLOAD_CONCURRENCY = 1; // Keep external memory bounded on Supabase Edge Functions.

type SceneSelection = { clip: BrollClip; plan: ScenePlan };

/** Runs async work with a small concurrency limit (keeps memory bounded: each clip is a few MB). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Chooses relevant, de-duplicated stock media for every scene.
 *
 * Scenes are planned one after another on purpose: the ledger of already-used asset IDs must be
 * complete before the next scene searches, which is what guarantees no asset is used twice.
 * Branded backgrounds remain only for scenes (or scene time) where nothing relevant was found.
 */
async function selectStockMedia(pkg: VideoPackage, apiKey: string, job: AssemblyJob, label: string): Promise<void> {
  const client = new PixabayClient(apiKey);
  const ledger = createLedger();
  const topicText = `${pkg.topic ?? ""} ${pkg.title ?? ""}`;
  const segments = pkg.script_segments ?? [];
  const allBeats = job.broll.flatMap((clip) => {
    const parent = segments.find((seg) => seg.index === clip.scene_index);
    return parent ? splitIntoVisualBeats(parent) : [];
  });
  const selections: SceneSelection[] = [];
  let beatOrdinal = 0;
  // Fair-share budget: every scene gets its own slice of time and requests (see SearchBudget). The
  // hard limit is only a safety net for the whole video; it is not a shared per-scene deadline.
  const budget = new SearchBudget(
    { ...DEFAULT_SEARCH_BUDGET, totalRequests: client.maxRequests, sceneCount: allBeats.length },
    { now: Date.now, requestsUsed: () => client.requests },
  );

  for (const clip of job.broll) {
    const segment = segments.find((seg) => seg.index === clip.scene_index);
    if (!segment) continue;
    const beats = splitIntoVisualBeats(segment);
    for (const [beatIndex, beat] of beats.entries()) {
      await setActivity(`${label} Finding relevant shot ${beatIndex + 1}/${beats.length} for scene ${clip.scene_index + 1}`);
      const requiredSec = Math.max(1, beat.duration_sec);
      let plan: ScenePlan;
      const shouldStop = budget.startScene(beatOrdinal++);
      try {
        plan = await planScene(beat.segment, requiredSec, client, ledger, {
          topicText,
          isFinalScene: clip.scene_index === job.broll.length - 1,
          shouldStop,
          allowTopicFallback: false,
        });
      } catch (error) {
        console.warn(`Stock planning for scene ${clip.scene_index + 1}, beat ${beatIndex + 1} failed:`, error);
        plan = { sceneIndex: beat.segment.index, requiredSec, pieces: [], coveredSec: 0, status: "none", queriesTried: [],
          notes: [`planning error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160)] };
      }
      // planScene offsets are local to the beat. Shift them into the parent narration scene.
      for (const piece of plan.pieces) piece.offsetSec += beat.offset_sec;
      const existing = selections.find((selection) => selection.clip.scene_index === clip.scene_index);
      if (existing) {
        existing.plan.pieces.push(...plan.pieces);
        existing.plan.coveredSec += plan.coveredSec;
        existing.plan.queriesTried.push(...plan.queriesTried);
        existing.plan.notes.push(...plan.notes);
        existing.plan.status = existing.plan.coveredSec >= (clip.end_sec - clip.start_sec) - 0.15 ? "full" : existing.plan.coveredSec > 0 ? "partial" : "none";
      } else {
        selections.push({ clip, plan: { ...plan, sceneIndex: clip.scene_index } });
      }
    }
  }

  if (client.disabledReason) console.warn(`Pixabay searching stopped early: ${client.disabledReason}`);

  // Download + store every chosen asset (bounded concurrency), then sign URLs for Creatomate.
  const jobs = selections.flatMap(({ clip, plan }) => plan.pieces.map((piece, pieceIndex) => ({ clip, plan, piece, pieceIndex })));
  await setActivity(`${label} Downloading ${jobs.length} stock assets`);
  await mapPool(jobs, DOWNLOAD_CONCURRENCY, async ({ clip, plan, piece, pieceIndex }) => {
    const isVideo = piece.candidate.kind === "video";
    try {
      const bytes = await downloadRemoteFile(piece.candidate.downloadUrl);
      const path = `${pkg.id}/stock-scene-${clip.scene_index + 1}-${pieceIndex + 1}.${isVideo ? "mp4" : "jpg"}`;
      await uploadFile(path, bytes, isVideo ? "video/mp4" : "image/jpeg");
      clip.pieces.push({
        kind: piece.candidate.kind,
        url: await createSignedFileUrl(path, SIGNED_LINK_TTL_SECONDS),
        offset_sec: piece.offsetSec,
        duration_sec: piece.durationSec,
        trim_start_sec: piece.trimStartSec,
        source_id: piece.candidate.key,
      });
    } catch (error) {
      console.warn(`Stock asset ${piece.candidate.key} for scene ${clip.scene_index + 1} could not be stored:`, error);
      plan.notes.push(`download failed for ${piece.candidate.key}`);
      plan.status = "partial";
    }
  });
  for (const { clip } of selections) {
    clip.pieces.sort((x, y) => x.offset_sec - y.offset_sec);
    if (clip.pieces.length > 0) clip.visual_type = clip.pieces[0].kind;
  }

  const summary = selections.map(({ clip, plan }) => ({
    scene_index: clip.scene_index,
    status: plan.status,
    required_sec: plan.requiredSec,
    covered_sec: plan.coveredSec,
    uncovered_sec: Math.max(0, Math.round((plan.requiredSec - plan.coveredSec) * 100) / 100),
    visual_coverage_percent: plan.requiredSec > 0 ? Math.round((plan.coveredSec / plan.requiredSec) * 1000) / 10 : 0,
    queries: plan.queriesTried,
    notes: plan.notes,
    assets: plan.pieces.map((p) => ({
      id: p.candidate.key, kind: p.candidate.kind, tier: p.candidate.tier, score: p.candidate.score,
      query: p.candidate.query, tags: p.candidate.tags, page_url: p.candidate.pageUrl,
      offset_sec: p.offsetSec, used_sec: p.durationSec, native_sec: p.candidate.duration,
    })),
  }));
  const full = summary.filter((x) => x.status === "full").length;
  const none = summary.filter((x) => x.status === "none").length;
  console.log(`Stock media: ${full}/${summary.length} scenes fully covered, ${none} on branded background, ${client.requests} Pixabay requests`);
  // Best-effort diagnostics: needs the scene_assets column from migration 20261107120000 (already in this repo).
  const { error: assetsError } = await db.from("video_packages").update({ scene_assets: summary }).eq("id", pkg.id);
  if (assetsError) console.warn(`Could not persist scene_assets (is migration 20261107120000 applied?): ${assetsError.message}`);
}

/** Creatomate assembly step: submit once, poll on later scheduler ticks, then persist final MP4. */
async function assemblingStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  const provider = getAssemblyProvider(s.assembly_provider, s.assembly_api_key, s.assembly_template_id);
  if (!provider || !pkg.voice_path || !pkg.script_segments) {
    throw new PermanentError("Creatomate is required for video generation. Add its API key in API Settings.");
  }

  if (!pkg.assembly_render_id) {
    await setActivity(`[${channel.name}] Submitting script and voiceover to Creatomate`);
    const job = buildAssemblyJob({
      packageId: pkg.id,
      title: pkg.title ?? "",
      voiceUrl: await createSignedFileUrl(pkg.voice_path, SIGNED_LINK_TTL_SECONDS),
      segments: pkg.script_segments,
    });
    if (s.pixabay_api_key?.trim()) {
      await selectStockMedia(pkg, s.pixabay_api_key.trim(), job, `[${channel.name}]`);
    }
    const renderId = await provider.submit(job);
    await updatePackage(pkg.id, { assembly_render_id: renderId });
    return "assembling";
  }

  await setActivity(`[${channel.name}] Checking Creatomate render ${pkg.assembly_render_id}`);
  const result = await provider.poll(pkg.assembly_render_id);
  if (result.status === "failed") throw new PermanentError(result.error ?? "Creatomate could not render the video");
  if (result.status !== "completed") {
    await setActivity(`[${channel.name}] Creatomate render is still processing`);
    return "assembling";
  }
  if (!result.videoUrl) throw new Error(`Creatomate render ${pkg.assembly_render_id} completed without a video URL`);

  await setActivity(`[${channel.name}] Downloading completed Creatomate MP4`);
  const bytes = await downloadRemoteFile(result.videoUrl);
  if (bytes.byteLength < 1024) throw new Error("Creatomate returned an empty or incomplete MP4 file");

  const path = `${pkg.id}/final.mp4`;
  await setActivity(`[${channel.name}] Saving MP4 to Supabase Storage (${bytes.byteLength} bytes)`);
  await uploadFile(path, bytes, "video/mp4");

  // Keep both fields populated: final_video_path is the new assembly field,
  // while video_path is retained for older UI components and integrations.
  await updatePackage(pkg.id, {
    final_video_path: path,
    video_path: path,
    status: "thumbnail",
    attempts: 0,
    next_attempt_at: null,
    error_message: null,
  });

  // The final MP4 is now safely stored. Temporary Pixabay downloads are no longer needed.
  // Cleanup is best-effort: never fail a completed render because temporary-file deletion failed.
  try {
    await setActivity(`[${channel.name}] Cleaning temporary stock footage`);
    const removed = await cleanupTemporaryStockAssets(pkg.id);
    console.log(`Removed ${removed} temporary stock assets for package ${pkg.id}`);
  } catch (cleanupError) {
    console.warn(`Temporary stock cleanup failed for package ${pkg.id}:`, cleanupError);
  }
  await setActivity(`[${channel.name}] MP4 saved successfully; moving to thumbnail`);
  return "thumbnail";
}

async function runStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  switch (pkg.status) {
    case "queued":
      return await writeScriptStep(pkg, s, channel);
    case "voicing":
      return await voiceStep(pkg, s, channel);
    case "thumbnail":
      return await thumbnailStep(pkg, s, channel);
    case "render_submit":
    case "rendering":
      // Resume legacy HeyGen-stage jobs through the new Creatomate-only path.
      await updatePackage(pkg.id, { status: "assembling", heygen_video_id: null });
      return "assembling";
    case "assembling":
      return await assemblingStep(pkg, s, channel);
    default:
      return pkg.status;
  }
}

/**
 * Runs one step. A transient failure does not fail the video: it is rescheduled with exponential
 * backoff (about 1m, 2m, 4m, 8m) and the next scheduler tick picks it up. Only permanent problems,
 * or running out of attempts, mark the video `failed` (it can then be retried from the UI).
 */
async function advancePackage(
  pkg: VideoPackage,
  s: Settings,
  channels: Map<string, Channel>,
): Promise<PackageStatus> {
  try {
    const channel = pkg.channel_id ? channels.get(pkg.channel_id) : undefined;
    if (!channel) throw new PermanentError("This video's channel was deleted");
    if (pkg.status === "queued" || pkg.status === "voicing") requirePrepareConfig(s, channel);
    if (pkg.status === "assembling") requireFields(s, ["assembly_api_key"], "API Settings");
    if (pkg.status === "thumbnail") requireFields(s, ["openai_api_key"], "API Settings");

    const next = await runStep(pkg, s, channel);
    if (pkg.attempts > 0 || pkg.next_attempt_at || pkg.error_message) {
      await updatePackage(pkg.id, { attempts: 0, next_attempt_at: null, error_message: null });
    }
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = (pkg.attempts ?? 0) + 1;
    if (isRetryableError(err) && attempts < MAX_STEP_ATTEMPTS) {
      const delay = stepBackoffMs(attempts);
      await updatePackage(pkg.id, {
        attempts,
        next_attempt_at: new Date(Date.now() + delay).toISOString(),
        error_message: `Retrying (attempt ${attempts} of ${MAX_STEP_ATTEMPTS}): ${message}`.slice(0, 500),
      });
      await setActivity(`Step failed, retrying in ${Math.round(delay / 1000)}s: ${message}`.slice(0, 300));
      return pkg.status;
    }
    await updatePackage(pkg.id, {
      status: "failed",
      failed_from: pkg.status,
      attempts,
      next_attempt_at: null,
      error_message: message.slice(0, 500),
    });
    await setActivity(`Video generation failed: ${message}`.slice(0, 300));
    return "failed";
  }
}

export async function driveInFlight(s: Settings, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const channels = new Map((await loadChannels()).map((c) => [c.id, c]));
    const { data, error } = await db
      .from("video_packages")
      .select("*")
      .in("status", IN_FLIGHT)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Could not load videos in progress: ${error.message}`);
    const packages = (data ?? []) as VideoPackage[];
    if (packages.length === 0) return;

    let changed = false;
    for (const pkg of packages) {
      if (Date.now() >= deadline) return;
      const next = await advancePackage(pkg, s, channels);
      if (next !== pkg.status) changed = true;
    }
    if (!changed) return;
  }
}

/** Puts a failed video back where it stopped so it can run again. */
export async function retryPackage(packageId: string): Promise<void> {
  const { data, error } = await db
    .from("video_packages")
    .select("id, status, failed_from")
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw new Error(`Could not read video: ${error.message}`);
  if (!data) throw new PermanentError("Video not found");
  if (data.status !== "failed") throw new PermanentError("Only failed videos can be retried");
  const resumeAt = IN_FLIGHT.includes(data.failed_from as PackageStatus)
    ? (data.failed_from as PackageStatus)
    : "queued";
  await updatePackage(packageId, {
    status: resumeAt,
    attempts: 0,
    next_attempt_at: null,
    error_message: null,
    // A failed Creatomate render must be re-submitted; otherwise the retry would poll the same failed render forever.
    ...(resumeAt === "assembling" ? { assembly_render_id: null } : {}),
  });
}

function mimeFromPath(path: string): string {
  return path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png";
}

export async function publishNextVideo(channelId: string): Promise<void> {
  const channel = await loadChannel(channelId);
  requirePublishConfig(channel);

  const { data, error } = await db
    .from("video_packages")
    .select("*")
    .eq("status", "ready")
    .eq("channel_id", channel.id)
    .or("final_video_path.not.is.null,video_path.not.is.null")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read ready videos: ${error.message}`);
  if (!data) {
    await setActivity(`[${channel.name}] No finished video is waiting to publish`);
    return;
  }

  const pkg = data as VideoPackage;
  const videoPath = (pkg.final_video_path ?? pkg.video_path)!;
  await updatePackage(pkg.id, { status: "uploading" });
  try {
    await setActivity(`[${channel.name}] Uploading video to YouTube`);
    const accessToken = await getYouTubeAccessToken(
      channel.youtube_client_id!,
      channel.youtube_client_secret!,
      channel.youtube_refresh_token!,
    );
    const bytes = await downloadFile(videoPath);
    const videoId = await uploadYouTubeVideo(
      accessToken,
      { title: pkg.title!, description: pkg.description!, tags: pkg.tags, privacy: channel.youtube_privacy },
      bytes,
    );
    await updatePackage(pkg.id, {
      status: "published",
      youtube_video_id: videoId,
      youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
      error_message: null,
    });

    if (pkg.thumbnail_path) {
      try {
        await setActivity(`[${channel.name}] Setting custom thumbnail`);
        await setYouTubeThumbnail(
          accessToken,
          videoId,
          await downloadFile(pkg.thumbnail_path),
          mimeFromPath(pkg.thumbnail_path),
        );
      } catch (thumbErr) {
        const message = thumbErr instanceof Error ? thumbErr.message : String(thumbErr);
        await updatePackage(pkg.id, {
          error_message: `Published, but the custom thumbnail was not applied: ${message}`.slice(0, 500),
        });
      }
    }
    await setActivity(`[${channel.name}] Video published to YouTube`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updatePackage(pkg.id, { status: "ready", error_message: `Publish failed: ${message}`.slice(0, 500) });
    await setActivity(`[${channel.name}] Publish failed: ${message}`.slice(0, 300));
    throw err;
  }
}
