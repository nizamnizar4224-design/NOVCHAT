import { assertOk, fetchWithRetry, PermanentError } from "./retry.ts";
import { nicheGuidance } from "./niches.ts";
import {
  buildTimeline,
  CAMERA_ANGLES,
  type CameraAngle,
  narrationFromSegments,
  type RawSegment,
  type ScriptSegment,
} from "./timeline.ts";

export const SCRIPT_SYSTEM_PROMPT = `You are a YouTube strategist, scriptwriter and video director who produces high-retention, high-CTR video packages.
You always answer with a single JSON object and nothing else.`;

export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-6-luna";
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare";

const OPENAI_BASE = "https://api.openai.com/v1";

export type ScriptPackage = {
  topic: string;
  title: string;
  description: string;
  tags: string[];
  script: string;
  script_segments: ScriptSegment[];
  thumbnail_prompt: string;
};

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

export async function fetchTrendingTopics(region = "India", country = "India"): Promise<string[]> {
  const geoByCountry: Record<string, string> = { India: "IN", "United States": "US", USA: "US", "United Kingdom": "GB", Canada: "CA", Australia: "AU", UAE: "AE", "Saudi Arabia": "SA", Qatar: "QA", Kuwait: "KW", Bahrain: "BH", Oman: "OM" };
  const geo = geoByCountry[country] ?? (region === "GCC" ? "AE" : "IN");
  try {
    const res = await fetchWithRetry(`https://trends.google.com/trending/rss?geo=${geo}`, {}, { retries: 1, timeoutMs: 15_000 });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
      .map((match) => stripCdata(match[1]))
      .filter((title) => title.length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim().slice(0, maxLen))
    .slice(0, max);
}

function parseSegments(value: unknown): RawSegment[] {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error("OpenAI returned too few script segments");
  }
  const segments = value.map((item, i): RawSegment => {
    const row = (item ?? {}) as Record<string, unknown>;
    const narration = asText(row.narration);
    if (narration === "") throw new Error(`OpenAI returned an empty narration in segment ${i + 1}`);
    const angle = asText(row.camera_angle).toLowerCase() as CameraAngle;
    const onScreen = asText(row.on_screen_text);
    return {
      label: asText(row.label).slice(0, 60) || `Part ${i + 1}`,
      narration,
      camera_angle: CAMERA_ANGLES.includes(angle) ? angle : "medium",
      broll: asText(row.broll).slice(0, 300),
      on_screen_text: onScreen === "" ? null : onScreen.slice(0, 80),
      visual_type: asText(row.visual_type).toLowerCase() === "image" ? "image" : "video",
      search_queries: asStringList(row.search_queries, 5, 60),
      subject_keywords: asStringList(row.subject_keywords, 4, 30),
    };
  });
  return segments;
}

function parseScriptPackage(raw: string): ScriptPackage {
  const data = JSON.parse(raw) as Record<string, unknown>;
  for (const key of ["topic", "title", "description", "thumbnail_prompt"] as const) {
    if (asText(data[key]) === "") throw new Error(`OpenAI returned an incomplete script (missing ${key})`);
  }
  const segments = buildTimeline(parseSegments(data.segments));
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "").slice(0, 15)
    : [];
  return {
    topic: asText(data.topic),
    title: asText(data.title).slice(0, 100),
    description: asText(data.description).slice(0, 4500),
    tags,
    script: narrationFromSegments(segments),
    script_segments: segments,
    thumbnail_prompt: asText(data.thumbnail_prompt),
  };
}

export async function writeScriptPackage(
  apiKey: string,
  model: string,
  channel: { name: string; niche: string; style_notes: string | null; target_region?: string; target_country?: string; primary_language?: string; audience_profile?: string | null; voice_accent?: string | null },
  trends: string[],
  recentTopics: string[],
): Promise<ScriptPackage> {
  const userPrompt = [
    `Channel: ${channel.name}`,
    `Target region: ${channel.target_region ?? "India"}`,
    `Target country: ${channel.target_country ?? "India"}`,
    `Primary output language: ${channel.primary_language ?? "English"}`,
    `Target audience: ${channel.audience_profile ?? "General viewers in the target country"}`,
    `Voice/accent guidance: ${channel.voice_accent ?? "Natural native-sounding delivery for the selected language"}`,
    nicheGuidance(channel.niche, channel.style_notes),
    "",
    "Current trending searches for the channel target region:",
    trends.length > 0 ? trends.map((t) => `- ${t}`).join("\n") : "- (trend feed unavailable)",
    "Use a trend only if it genuinely fits this channel's niche; otherwise choose a strong evergreen topic for the niche.",
    "",
    "Topics already covered recently (do not repeat):",
    recentTopics.length > 0 ? recentTopics.map((t) => `- ${t}`).join("\n") : "- none",
    "",
    "Create one YouTube video of about 4 minutes (roughly 500 to 600 spoken words in total).",
    "Structure the video as 10 to 14 segments of roughly 12 to 25 seconds each. Keep narration concise, natural and easy to understand; remove filler, repeated ideas and generic introductions.",
    "OPENING HOOK: the first segment must start immediately with the exact topic and a compelling, specific question, surprising fact or useful promise. No greeting, channel intro, vague teaser or unrelated stock visual. The first 5-10 seconds must make the viewer want the answer.",
    "VISUAL STORYTELLING: every segment must describe one concrete visual that directly illustrates the exact claim in its narration. Identify the main subject/entity and the action or evidence being discussed. Preserve proper names, film titles, people, products, places, dates and named concepts when they are spoken. Do not replace a named subject with a loosely related generic object. Prefer specific real-world actions, authentic environments, relevant documents/screens and recognizable subject matter. Never use generic scenery, random nature, decorative objects, unrelated people or generic finance imagery as substitutes. Avoid repeating the same visual idea in adjacent scenes.",
    "VISUAL ACCURACY: the broll description must be a literal camera-visible depiction of this segment, not a mood, metaphor or broad category. If narration discusses a specific person, movie, award, company, product or event, search for that exact entity plus a directly relevant visual context. If an exact stock asset is unlikely to exist, choose a clearly relevant explanatory graphic rather than pretending an unrelated stock clip is relevant.",
    "TOPIC TRANSITIONS: when the narration changes to a new person, title, event, calculation or concept, change the visual subject accordingly. Do not keep showing the previous subject merely because both belong to the same broad topic.",
    "STOCK SEARCH: search_queries and subject_keywords must describe what the camera sees for THIS segment (the thing being discussed), never the video's general mood. In the final Like and Subscribe segment base them on the recap subject, not on subscribe buttons.",
    "For every segment, choose visual_type (video or image). Prefer video when a relevant action is available; use an image only when no suitable video is likely. Keep the visual useful for the full segment duration. The editor will reject stock video shorter than the scene rather than stretch or loop it.",
    "ON-SCREEN TEXT: write a short, readable phrase of at most 5 words. It must summarize the key idea, not repeat the full narration. Use centered placement in the video editor.",
    "ENDING: the final segment must deliver a brief recap and clearly say Like and Subscribe. Set on_screen_text to LIKE AND SUBSCRIBE or another concise CTA so matching icons can be displayed. Do not add a generic subscribe message earlier.",
    "Retention rules: change the visual at every segment boundary; plant an open loop early and pay it off later; keep all footage tightly relevant to the exact topic.",
    "",
    "Return JSON with exactly these keys:",
    "topic (string),",
    "title (string, under 70 characters, curiosity-driven),",
    "description (string, 2-3 short paragraphs with a call to action),",
    "tags (array of up to 15 short strings),",
    "thumbnail_prompt (string, a bold 16:9 thumbnail with a human face reacting, high contrast, at most 4 words of large text),",
    "segments (array, in playback order, each an object with:",
    "  label (string, 2-4 word name of this beat),",
    "  narration (string, spoken words only: no stage directions, no timestamps, no speaker names),",
    `  camera_angle (one of: ${CAMERA_ANGLES.join(", ")}),`,
    "  broll (string, a concrete stock visual to show during this segment, specific enough to search Pixabay; never empty because this channel uses stock footage and text, not an avatar),",
    "  on_screen_text (string, at most 5 words of overlay text, or empty string),",
    "  visual_type (string: video or image),",
    "  search_queries (array of 3 to 4 short Pixabay search queries for this segment, each 1 to 3 plain words, most specific first, ending with one broader single-word query; concrete visible nouns only, e.g. [\"smartphone banking app\", \"person using smartphone\", \"smartphone\"]; no verbs like showing, no abstract words),",
    "  subject_keywords (array of 1 to 3 concrete nouns or exact named entities that a matching stock clip must actually show, e.g. [\"smartphone\", \"bank\"])).",
    "Do not include start or end times; they are calculated from the narration afterwards.",
  ].join("\n");

  const res = await fetchWithRetry(
    `${OPENAI_BASE}/responses`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        instructions: `${SCRIPT_SYSTEM_PROMPT} Preserve detailed documentary storytelling, scene-by-scene camera direction, B-roll, overlays and pacing. Return valid JSON only.`,
        input: userPrompt,
        text: { format: { type: "json_object" } },
      }),
    },
    { timeoutMs: 120_000 },
  );
  await assertOk(res, "OpenAI script generation");
  const json = await res.json();
  const content = typeof json?.output_text === "string"
    ? json.output_text
    : json?.output?.flatMap((item: { content?: { type?: string; text?: string }[] }) => item.content ?? [])
        .find((part: { type?: string; text?: string }) => part.type === "output_text" && typeof part.text === "string")?.text;
  if (typeof content !== "string") throw new Error("OpenAI returned an empty script");
  return parseScriptPackage(content);
}

export async function synthesizeVoiceover(apiKey: string, voiceId: string, text: string): Promise<Uint8Array> {
  const res = await fetchWithRetry(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    },
    { timeoutMs: 100_000 },
  );
  await assertOk(res, "ElevenLabs voiceover");
  return new Uint8Array(await res.arrayBuffer());
}

export type ThumbnailImage = { bytes: Uint8Array; mimeType: string; extension: string };

export async function generateThumbnailImage(apiKey: string, model: string, prompt: string): Promise<ThumbnailImage> {
  const res = await fetchWithRetry(
    `${OPENAI_BASE}/images/generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt: `Create a professional 16:9 YouTube thumbnail. ${prompt}. Strong focal point, cinematic lighting, high contrast, readable composition, no misleading claims.`, size: "1536x864", quality: "high", output_format: "png", n: 1 }),
    },
    { timeoutMs: 150_000 },
  );
  await assertOk(res, "OpenAI thumbnail generation");
  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 !== "string") throw new Error("OpenAI returned no thumbnail image");
  const mimeType = "image/png";
  return { bytes: Uint8Array.from(atob(b64), (char) => char.charCodeAt(0)), mimeType, extension: "png" };
}

export async function startAvatarRender(apiKey: string, avatarId: string, audioUrl: string): Promise<string> {
  const res = await fetchWithRetry(
    "https://api.heygen.com/v2/video/generate",
    {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        video_inputs: [
          {
            character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
            voice: { type: "audio", audio_url: audioUrl },
          },
        ],
        dimension: { width: 1280, height: 720 },
      }),
    },
    // Not retried in-request: a retry after a lost response could start a second paid render.
    { retries: 0, timeoutMs: 45_000 },
  );
  await assertOk(res, "HeyGen render request");
  const json = await res.json();
  const videoId = json?.data?.video_id;
  if (json?.error || typeof videoId !== "string") {
    throw new PermanentError(`HeyGen did not accept the render: ${JSON.stringify(json?.error ?? json)}`.slice(0, 300));
  }
  return videoId;
}

export type AvatarRenderStatus = {
  status: "pending" | "processing" | "completed" | "failed" | string;
  videoUrl: string | null;
  error: string | null;
};

export async function getAvatarRenderStatus(apiKey: string, videoId: string): Promise<AvatarRenderStatus> {
  const res = await fetchWithRetry(
    `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    { headers: { "X-Api-Key": apiKey } },
    { timeoutMs: 30_000 },
  );
  await assertOk(res, "HeyGen status check");
  const json = await res.json();
  const data = json?.data ?? {};
  const error = typeof data.error === "string" ? data.error : data.error?.message ?? null;
  return { status: String(data.status ?? "pending"), videoUrl: data.video_url ?? null, error };
}

export async function downloadRemoteFile(url: string): Promise<Uint8Array> {
  const res = await fetchWithRetry(url, {}, { timeoutMs: 100_000 });
  await assertOk(res, "Video download");
  return new Uint8Array(await res.arrayBuffer());
}
