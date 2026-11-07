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



/**
 * Split a long narration segment into short visual beats. These beats are only for visual search;
 * the original narration segment and audio timeline remain unchanged.
 */
export type VisualBeat = { segment: ScriptSegment; offset_sec: number; duration_sec: number };

const BEAT_TARGET_SECONDS = 3.8;
const BEAT_MAX_SECONDS = 5;
const BEAT_MIN_SECONDS = 2;

function sentenceChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const source = sentences.length ? sentences : [text.trim()];
  const chunks: string[] = [];
  const maxWords = 6;
  for (const sentence of source) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) { if (sentence) chunks.push(sentence); continue; }
    // Prefer clause boundaries, then cap each shot to about four seconds of speech.
    const clauses = sentence.split(/(?<=[,;:])\s+/).filter(Boolean);
    for (const clause of clauses) {
      const clauseWords = clause.split(/\s+/).filter(Boolean);
      for (let i = 0; i < clauseWords.length; i += maxWords) chunks.push(clauseWords.slice(i, i + maxWords).join(" "));
    }
  }
  return chunks.length ? chunks : [text.trim()].filter(Boolean);
}

export function splitIntoVisualBeats(segment: ScriptSegment): VisualBeat[] {
  const chunks = sentenceChunks(segment.narration);
  if (chunks.length <= 1) return [{ segment, offset_sec: 0, duration_sec: round1(segment.end_sec - segment.start_sec) }];
  const total = Math.max(0.1, segment.end_sec - segment.start_sec);
  const weights = chunks.map((chunk) => Math.max(1, wordCount(chunk)));
  const totalWords = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => total * w / totalWords);
  const groups = chunks.map((text, i) => ({ text, weight: weights[i] }));
  for (let i = 0; i < groups.length; i++) {
    const estimated = (groups[i].weight / totalWords) * total;
    if (estimated >= BEAT_MIN_SECONDS || groups.length === 1) continue;
    const neighbour = i > 0 ? i - 1 : i + 1;
    const combined = groups[neighbour].weight + groups[i].weight;
    if ((combined / totalWords) * total <= BEAT_MAX_SECONDS) {
      if (neighbour < i) {
        groups[neighbour].text += ` ${groups[i].text}`;
        groups[neighbour].weight = combined;
        groups.splice(i, 1);
        i--;
      } else {
        groups[i].text += ` ${groups[neighbour].text}`;
        groups[i].weight = combined;
        groups.splice(neighbour, 1);
      }
    }
  }
  let cursor = 0;
  return groups.map((group, i) => {
    const duration = i === groups.length - 1 ? total - cursor : total * group.weight / groups.reduce((a, b) => a + b.weight, 0);
    const beat: ScriptSegment = {
      ...segment,
      index: segment.index * 100 + i,
      label: `${segment.label} beat ${i + 1}`,
      narration: group.text,
      broll: group.text,
      on_screen_text: null,
      search_queries: [],
      subject_keywords: group.text.toLowerCase().match(/[a-z0-9]{4,}/g)?.slice(0, 5) ?? [],
      start_sec: round1(segment.start_sec + cursor),
      end_sec: round1(segment.start_sec + cursor + duration),
    };
    const result = { segment: beat, offset_sec: round1(cursor), duration_sec: round1(duration) };
    cursor += duration;
    return result;
  });
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
