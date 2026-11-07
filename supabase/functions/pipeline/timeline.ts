/**
 * Script timeline helpers.
 *
 * The language model writes the narration, camera cues and B-roll ideas, but it cannot know how long
 * the spoken audio will be, so we never ask it for timestamps. Instead:
 *   1. buildTimeline()   estimates each segment's duration from its word count (~150 words/minute).
 *   2. rescaleTimeline() stretches/shrinks those estimates to the real voiceover length once
 *      ElevenLabs has produced the audio, so the final timestamps line up with the actual audio.
 */

export const CAMERA_ANGLES = [
  "wide",
  "medium",
  "close-up",
  "over-the-shoulder",
  "split-screen",
  "full-screen-broll",
] as const;
export type CameraAngle = (typeof CAMERA_ANGLES)[number];

export type RawSegment = {
  label: string;
  narration: string;
  camera_angle: CameraAngle;
  broll: string;
  on_screen_text: string | null;
  visual_type?: "video" | "image";
  /** Optional: short Pixabay queries (most specific first) written by the script model. */
  search_queries?: string[];
  /** Optional: nouns a matching stock clip must actually be about. */
  subject_keywords?: string[];
};

export type ScriptSegment = RawSegment & {
  index: number;
  start_sec: number;
  end_sec: number;
};

const WORDS_PER_SECOND = 2.5;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function buildTimeline(segments: RawSegment[]): ScriptSegment[] {
  let cursor = 0;
  return segments.map((segment, index) => {
    const duration = Math.max(2, wordCount(segment.narration) / WORDS_PER_SECOND);
    const start = cursor;
    cursor += duration;
    return { ...segment, index, start_sec: round1(start), end_sec: round1(cursor) };
  });
}

export function rescaleTimeline(segments: ScriptSegment[], totalSeconds: number): ScriptSegment[] {
  const last = segments[segments.length - 1];
  if (!last || last.end_sec <= 0 || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return segments;
  const factor = totalSeconds / last.end_sec;
  return segments.map((segment) => ({
    ...segment,
    start_sec: round1(segment.start_sec * factor),
    end_sec: round1(segment.end_sec * factor),
  }));
}

/** Duration of a constant-bitrate MP3 (ElevenLabs mp3_44100_128 is 128 kbps CBR). */
export function estimateMp3Seconds(byteLength: number, kbps = 128): number {
  return (byteLength * 8) / (kbps * 1000);
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function narrationFromSegments(segments: { narration: string }[]): string {
  return segments.map((segment) => segment.narration.trim()).join("\n\n");
}
