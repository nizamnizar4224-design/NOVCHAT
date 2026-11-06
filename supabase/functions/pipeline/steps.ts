import {
  type Channel,
  createSignedFileUrl,
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
import { estimateMp3Seconds, rescaleTimeline } from "./timeline.ts";
import { buildAssemblyJob, getAssemblyProvider } from "./assembly.ts";

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

/** Search Pixabay for a scene-matching stock clip, cache the file in private Supabase Storage, and return a short-lived URL. */
async function findPixabayClip(apiKey: string, query: string, packageId: string, sceneIndex: number): Promise<string | null> {
  const endpoint = new URL("https://pixabay.com/api/videos/");
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("q", query.slice(0, 100));
  endpoint.searchParams.set("per_page", "3");
  endpoint.searchParams.set("safesearch", "true");
  const response = await fetch(endpoint.toString());
  if (!response.ok) throw new Error(`Pixabay search failed (${response.status})`);
  const payload = await response.json();
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  const hit = hits.find((item: any) => item?.videos?.medium?.url || item?.videos?.small?.url);
  const remoteUrl = hit?.videos?.medium?.url ?? hit?.videos?.small?.url;
  if (typeof remoteUrl !== "string") return null;
  const bytes = await downloadRemoteFile(remoteUrl);
  const path = `${packageId}/stock-scene-${sceneIndex + 1}.mp4`;
  await uploadFile(path, bytes, "video/mp4");
  return await createSignedFileUrl(path, SIGNED_LINK_TTL_SECONDS);
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
      for (const [index, clip] of job.broll.entries()) {
        try {
          clip.sourceUrl = await findPixabayClip(s.pixabay_api_key.trim(), clip.query, pkg.id, index);
        } catch (error) {
          // Stock footage is optional: keep the video renderable if one Pixabay search/download fails.
          console.warn(`Pixabay scene ${index + 1} skipped:`, error);
        }
      }
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
