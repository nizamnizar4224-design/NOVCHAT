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
  getAvatarRenderStatus,
  startAvatarRender,
  synthesizeVoiceover,
  writeScriptPackage,
} from "./providers.ts";
import { getYouTubeAccessToken, setYouTubeThumbnail, uploadYouTubeVideo } from "./youtube.ts";
import { isRetryableError, PermanentError, stepBackoffMs } from "./retry.ts";
import { estimateMp3Seconds, rescaleTimeline } from "./timeline.ts";
import { buildAssemblyJob, getAssemblyProvider } from "./assembly.ts";

const IN_FLIGHT: PackageStatus[] = ["queued", "voicing", "thumbnail", "render_submit", "rendering", "assembling"];
const SIGNED_LINK_TTL_SECONDS = 6 * 3600;
const MAX_STEP_ATTEMPTS = 5;
const MAX_RENDER_AGE_MS = 3 * 3600_000;

function filled(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

function hasHeygen(s: Settings, channel: Channel): boolean {
  return filled(s.heygen_api_key) && filled(channel.heygen_avatar_id);
}

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
  const trends = await fetchTrendingTopics(channel.target_region, channel.target_country);
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
    status: "thumbnail",
    ...(segments ? { script_segments: segments } : {}),
  });
  return "thumbnail";
}

async function thumbnailStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  await setActivity(`[${channel.name}] Creating thumbnail image`);
  const image = await generateThumbnailImage(
    s.openai_api_key!,
    s.openai_image_model?.trim() || DEFAULT_OPENAI_IMAGE_MODEL,
    pkg.thumbnail_prompt!,
  );
  const path = `${pkg.id}/thumbnail.${image.extension}`;
  await uploadFile(path, image.bytes, image.mimeType);
  const nextStatus: PackageStatus = hasHeygen(s, channel) ? "render_submit" : "ready";
  await updatePackage(pkg.id, { thumbnail_path: path, status: nextStatus });
  if (nextStatus === "ready") {
    await setActivity(`[${channel.name}] Voiceover ready - add HeyGen key and avatar to render the video`);
  }
  return nextStatus;
}

async function renderSubmitStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  await setActivity(`[${channel.name}] Submitting avatar video to HeyGen`);
  const audioUrl = await createSignedFileUrl(pkg.voice_path!, SIGNED_LINK_TTL_SECONDS);
  const videoId = await startAvatarRender(s.heygen_api_key!, channel.heygen_avatar_id!, audioUrl);
  await updatePackage(pkg.id, { heygen_video_id: videoId, status: "rendering" });
  return "rendering";
}

async function renderPollStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  if (Date.now() - Date.parse(pkg.created_at) > MAX_RENDER_AGE_MS) {
    throw new PermanentError("HeyGen did not finish rendering within 3 hours");
  }
  const render = await getAvatarRenderStatus(s.heygen_api_key!, pkg.heygen_video_id!);
  if (render.status === "failed") throw new PermanentError(render.error ?? "HeyGen could not render the video");
  if (render.status !== "completed") {
    await setActivity(`[${channel.name}] Rendering avatar video with HeyGen`);
    return "rendering";
  }
  if (!render.videoUrl) throw new Error("HeyGen finished without a video file");
  await setActivity(`[${channel.name}] Saving rendered video`);
  const bytes = await downloadRemoteFile(render.videoUrl);
  const path = `${pkg.id}/video.mp4`;
  await uploadFile(path, bytes, "video/mp4");
  const needsAssembly = getAssemblyProvider(s.assembly_provider, s.assembly_api_key) !== null && pkg.script_segments;
  const next: PackageStatus = needsAssembly ? "assembling" : "ready";
  await updatePackage(pkg.id, { video_path: path, status: next });
  await setActivity(next === "ready" ? `[${channel.name}] Video ready for publishing` : `[${channel.name}] Editing video`);
  return next;
}

/**
 * Future editing step (Creatomate / Shotstack). Inactive today: getAssemblyProvider() returns null
 * until an adapter is implemented, so videos go straight from `rendering` to `ready`.
 */
async function assemblingStep(pkg: VideoPackage, s: Settings, channel: Channel): Promise<PackageStatus> {
  const provider = getAssemblyProvider(s.assembly_provider, s.assembly_api_key);
  if (!provider || !pkg.video_path || !pkg.script_segments) {
    await updatePackage(pkg.id, { status: "ready" });
    return "ready";
  }

  if (!pkg.assembly_render_id) {
    await setActivity(`[${channel.name}] Submitting edit job to ${provider.id}`);
    const job = buildAssemblyJob({
      packageId: pkg.id,
      title: pkg.title ?? "",
      avatarVideoUrl: await createSignedFileUrl(pkg.video_path, SIGNED_LINK_TTL_SECONDS),
      voiceUrl: pkg.voice_path ? await createSignedFileUrl(pkg.voice_path, SIGNED_LINK_TTL_SECONDS) : null,
      segments: pkg.script_segments,
    });
    const renderId = await provider.submit(job);
    await updatePackage(pkg.id, { assembly_render_id: renderId });
    return "assembling";
  }

  const result = await provider.poll(pkg.assembly_render_id);
  if (result.status === "failed") throw new PermanentError(result.error ?? `${provider.id} could not edit the video`);
  if (result.status !== "completed" || !result.videoUrl) {
    await setActivity(`[${channel.name}] Editing video with ${provider.id}`);
    return "assembling";
  }
  const bytes = await downloadRemoteFile(result.videoUrl);
  const path = `${pkg.id}/final.mp4`;
  await uploadFile(path, bytes, "video/mp4");
  await updatePackage(pkg.id, { final_video_path: path, status: "ready" });
  await setActivity(`[${channel.name}] Edited video ready for publishing`);
  return "ready";
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
      return await renderSubmitStep(pkg, s, channel);
    case "rendering":
      return await renderPollStep(pkg, s, channel);
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
    if (pkg.status === "thumbnail") requireFields(s, ["openai_api_key"], "API Settings");
    if (pkg.status === "render_submit" || pkg.status === "rendering") {
      requireFields(s, ["heygen_api_key"], "API Settings");
    }

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
