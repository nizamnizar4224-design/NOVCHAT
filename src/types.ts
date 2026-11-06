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

export type CameraAngle =
  | "wide"
  | "medium"
  | "close-up"
  | "over-the-shoulder"
  | "split-screen"
  | "full-screen-broll";

export type ScriptSegment = {
  index: number;
  start_sec: number;
  end_sec: number;
  label: string;
  narration: string;
  camera_angle: CameraAngle;
  broll: string;
  on_screen_text: string | null;
};

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
  heygen_video_id: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  error_message: string | null;
};

export type PipelineState = {
  running: boolean;
  activity: string;
  activity_updated_at: string;
  last_prepare_at: string | null;
  last_publish_at: string | null;
  last_error: string | null;
};

export type YouTubePrivacy = "public" | "unlisted" | "private";

export type Niche = "finance" | "education" | "entertainment" | "general";

export const NICHES: { value: Niche; label: string; hint: string }[] = [
  { value: "finance", label: "Finance", hint: "Educational, no personal advice, adds a not-financial-advice disclaimer." },
  { value: "education", label: "Education", hint: "Clear explainers: question, intuition, example, recap." },
  { value: "entertainment", label: "Entertainment", hint: "High-energy, story-driven, pop-culture topics." },
  { value: "general", label: "General", hint: "Any broadly appealing topic." },
];

export type AssemblyProviderId = "none" | "creatomate" | "shotstack";

/** A saved secret is never sent to the browser. `null` = not set, a string = masked hint such as "••••a1b2". */
export type SecretHint = string | null;

export type SettingsStatus = {
  openai_api_key: SecretHint;
  elevenlabs_api_key: SecretHint;
  heygen_api_key: SecretHint;
  assembly_api_key: SecretHint;
  openai_text_model: string | null;
  openai_image_model: string | null;
  assembly_provider: AssemblyProviderId;
};

export type ChannelSecretKey = "youtube_client_id" | "youtube_client_secret" | "youtube_refresh_token";

export type Channel = {
  id: string;
  name: string;
  niche: Niche;
  style_notes: string | null;
  target_region: string;
  target_country: string;
  primary_language: string;
  enabled: boolean;
  youtube_privacy: YouTubePrivacy;
  prepare_time: string;
  publish_time: string;
  timezone: string;
  heygen_avatar_id: string | null;
  elevenlabs_voice_id: string | null;
  last_prepare_at: string | null;
  last_publish_at: string | null;
  secrets: Record<ChannelSecretKey, SecretHint>;
};

export type PipelineAction = "prepare" | "publish";
