/**
 * Video assembly (editing) layer - scaffold for Creatomate / Shotstack.
 *
 * Today the pipeline publishes the HeyGen avatar video as-is. This file defines the seam where an
 * editing API will plug in later to merge B-roll, captions and the avatar footage into a final cut:
 *
 *   avatar video + timestamped script segments --> buildAssemblyJob() --> provider.submit()
 *                                                          provider.poll() --> final_video_path
 *
 * The pipeline already has an `assembling` status and the columns `assembly_render_id` and
 * `final_video_path`, and the publish step prefers `final_video_path` over `video_path`.
 *
 * TO ADD A PROVIDER: implement AssemblyProvider below, set `implemented = true`, and register it in
 * getAssemblyProvider(). Nothing else in the pipeline needs to change.
 */
import { PermanentError } from "./retry.ts";
import type { ScriptSegment } from "./timeline.ts";

export type AssemblyProviderId = "none" | "creatomate" | "shotstack";

export type CaptionCue = { start_sec: number; end_sec: number; text: string };

export type BrollClip = {
  start_sec: number;
  end_sec: number;
  /** Free-text description from the script; a provider adapter turns it into a stock-footage query. */
  query: string;
};

export type AssemblyJob = {
  packageId: string;
  title: string;
  width: number;
  height: number;
  /** Short-lived signed URL of the HeyGen avatar render. */
  avatarVideoUrl: string;
  /** Short-lived signed URL of the narration audio. */
  voiceUrl: string | null;
  segments: ScriptSegment[];
  broll: BrollClip[];
  captions: CaptionCue[];
};

export type AssemblyStatus = {
  status: "pending" | "processing" | "completed" | "failed";
  videoUrl: string | null;
  error: string | null;
};

export interface AssemblyProvider {
  readonly id: AssemblyProviderId;
  submit(job: AssemblyJob): Promise<string>;
  poll(renderId: string): Promise<AssemblyStatus>;
}

const MAX_WORDS_PER_CAPTION = 7;

/** Splits each segment's narration into short caption cues, spread evenly across the segment. */
export function buildCaptionCues(segments: ScriptSegment[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const segment of segments) {
    const words = segment.narration.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += MAX_WORDS_PER_CAPTION) {
      chunks.push(words.slice(i, i + MAX_WORDS_PER_CAPTION).join(" "));
    }
    const span = segment.end_sec - segment.start_sec;
    chunks.forEach((text, i) => {
      cues.push({
        start_sec: Math.round((segment.start_sec + (span * i) / chunks.length) * 10) / 10,
        end_sec: Math.round((segment.start_sec + (span * (i + 1)) / chunks.length) * 10) / 10,
        text,
      });
    });
  }
  return cues;
}

export function buildAssemblyJob(input: {
  packageId: string;
  title: string;
  avatarVideoUrl: string;
  voiceUrl: string | null;
  segments: ScriptSegment[];
}): AssemblyJob {
  return {
    packageId: input.packageId,
    title: input.title,
    width: 1280,
    height: 720,
    avatarVideoUrl: input.avatarVideoUrl,
    voiceUrl: input.voiceUrl,
    segments: input.segments,
    broll: input.segments
      .filter((segment) => segment.broll.trim() !== "")
      .map((segment) => ({ start_sec: segment.start_sec, end_sec: segment.end_sec, query: segment.broll })),
    captions: buildCaptionCues(input.segments),
  };
}

/** Placeholder adapters: they exist so the settings value is valid, but are not wired to an API yet. */
class NotImplementedProvider implements AssemblyProvider {
  readonly id: AssemblyProviderId;
  constructor(id: AssemblyProviderId) {
    this.id = id;
  }
  submit(_job: AssemblyJob): Promise<string> {
    return Promise.reject(new PermanentError(`The ${this.id} adapter is not implemented yet.`));
  }
  poll(_renderId: string): Promise<AssemblyStatus> {
    return Promise.reject(new PermanentError(`The ${this.id} adapter is not implemented yet.`));
  }
}

const IMPLEMENTED: AssemblyProviderId[] = [];

/** Returns null when no usable provider is configured, so the pipeline skips assembly. */
export function getAssemblyProvider(id: string | null, apiKey: string | null): AssemblyProvider | null {
  if (!id || id === "none" || !apiKey || apiKey.trim() === "") return null;
  if (!IMPLEMENTED.includes(id as AssemblyProviderId)) return null;
  switch (id) {
    case "creatomate":
    case "shotstack":
      return new NotImplementedProvider(id);
    default:
      return null;
  }
}
