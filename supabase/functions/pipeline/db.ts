import { createClient } from "npm:@supabase/supabase-js@2";
import type { ScriptSegment } from "./timeline.ts";
import { PermanentError } from "./retry.ts";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const BUCKET = "video-assets";

export type PackageStatus =
  | "queued"
  | "voicing"
  | "thumbnail"
  | "render_submit"
  | "rendering"
  | "assembling"
  | "ready"
  | "uploading"
  | "published"
  | "failed";

export type VideoPackage = {
  id: string;
  created_at: string;
  updated_at: string;
  channel_id: string | null;
  status: PackageStatus;
  topic: string | null;
  title: string | null;
  description: string | null;
  tags: string[];
  script: string | null;
  thumbnail_prompt: string | null;
  voice_path: string | null;
  thumbnail_path: string | null;
  video_path: string | null;
  final_video_path: string | null;
  script_segments: ScriptSegment[] | null;
  attempts: number;
  next_attempt_at: string | null;
  failed_from: PackageStatus | null;
  assembly_render_id: string | null;
  heygen_video_id: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  error_message: string | null;
};

/** Global settings shared by every channel (API keys, model IDs, assembly provider). */
export type Settings = {
  openai_api_key: string | null;
  heygen_api_key: string | null;
  elevenlabs_api_key: string | null;
  openai_text_model: string | null;
  openai_image_model: string | null;
  assembly_provider: string;
  assembly_api_key: string | null;
  pixabay_api_key: string | null;
};

/** Per-channel configuration. */
export type Channel = {
  id: string;
  name: string;
  niche: string;
  style_notes: string | null;
  target_region: string;
  target_country: string;
  primary_language: string;
  secondary_language: string | null;
  voice_accent: string | null;
  audience_profile: string | null;
  enabled: boolean;
  youtube_client_id: string | null;
  youtube_client_secret: string | null;
  youtube_refresh_token: string | null;
  heygen_avatar_id: string | null;
  elevenlabs_voice_id: string | null;
  youtube_privacy: string;
  prepare_time: string;
  publish_time: string;
  timezone: string;
  last_prepare_at: string | null;
  last_publish_at: string | null;
};

const LABELS: Record<string, string> = {
  openai_api_key: "OpenAI API key",
  pixabay_api_key: "Pixabay API key",
  heygen_api_key: "HeyGen API key",
  elevenlabs_api_key: "ElevenLabs API key",
  youtube_client_id: "YouTube Client ID",
  youtube_client_secret: "YouTube Client Secret",
  youtube_refresh_token: "YouTube Refresh Token",
  heygen_avatar_id: "HeyGen avatar ID",
  elevenlabs_voice_id: "ElevenLabs voice ID",
};

export async function loadSettings(): Promise<Settings> {
  const { data, error } = await db.from("api_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  return data as Settings;
}

export async function loadChannels(): Promise<Channel[]> {
  const { data, error } = await db.from("channels").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load channels: ${error.message}`);
  return (data ?? []) as Channel[];
}

export async function loadChannel(id: string): Promise<Channel> {
  const { data, error } = await db.from("channels").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load channel: ${error.message}`);
  if (!data) throw new PermanentError("That channel no longer exists");
  return data as Channel;
}

/** Throws a PermanentError (retrying cannot fix missing configuration). */
export function requireFields<T extends object>(source: T, keys: (keyof T & string)[], where: string): void {
  const missing = keys
    .filter((key) => {
      const value = source[key];
      return value === null || value === undefined || String(value).trim() === "";
    })
    .map((key) => LABELS[key] ?? key);
  if (missing.length > 0) {
    throw new PermanentError(`Add these in ${where} first: ${missing.join(", ")}`);
  }
}

export async function setActivity(activity: string): Promise<void> {
  const { error } = await db
    .from("pipeline_state")
    .update({ activity, activity_updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(`Could not update live status: ${error.message}`);
}

export async function updatePackage(id: string, patch: Partial<VideoPackage>): Promise<void> {
  const { error } = await db
    .from("video_packages")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not save video progress: ${error.message}`);
}

export async function uploadFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`File storage upload failed: ${error.message}`);
}

export async function downloadFile(path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`File storage download failed: ${error?.message ?? "empty file"}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function createSignedFileUrl(path: string, expiresInSeconds: number): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error(`Could not share voiceover file: ${error?.message ?? "unknown error"}`);
  return data.signedUrl;
}
