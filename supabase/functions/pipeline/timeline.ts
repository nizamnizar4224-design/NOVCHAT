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
  const maxWords = 10;
  for (const sentence of source) {
    // Keep clauses together where possible, but never let a visual search beat become a full paragraph.
    const clauses = sentence.split(/(?<=[,;:])\s+/).filter(Boolean);
    let pending: string[] = [];
    for (const clause of clauses) {
      const words = clause.split(/\s+/).filter(Boolean);
      for (const word of words) {
        pending.push(word);
        if (pending.length >= maxWords) {
          chunks.push(pending.join(" "));
          pending = [];
        }
      }
      // Prefer a clause boundary when the current chunk is already substantial.
      if (pending.length >= 9) {
        chunks.push(pending.join(" "));
        pending = [];
      }
    }
    if (pending.length) chunks.push(pending.join(" "));
  }

  return chunks.length ? chunks : [text.trim()].filter(Boolean);
}


function visualTerms(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
}

function namedEntityTerms(values: string[] | undefined): Set<string> {
  const names = new Set<string>();
  for (const value of values ?? []) {
    // Keep capitalized proper-name tokens (e.g. Dhanush, Kerala, iPhone) available to
    // adjacent visual beats even when the narration mentions the name in a neighbouring clause.
    for (const token of value.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
      if (/^[A-Z][a-zA-Z0-9]{2,}$/.test(token) || /^[A-Z]{2,}$/.test(token)) names.add(token.toLowerCase());
    }
  }
  return names;
}

function relevantParentTerms(values: string[] | undefined, beatText: string, carry = new Set<string>()): string[] {
  const beatTerms = visualTerms(beatText);
  if (beatTerms.size === 0) return [];
  const matched: string[] = [];
  for (const value of values ?? []) {
    const terms = [...visualTerms(value)].filter((term) => carry.has(term) || beatTerms.has(term) || [...beatTerms].some((beat) =>
      (term.length >= 5 && beat.startsWith(term.slice(0, 5))) || (beat.length >= 5 && term.startsWith(beat.slice(0, 5)))
    ));
    for (const term of terms) if (!matched.includes(term)) matched.push(term);
  }
  return matched;
}

export function splitIntoVisualBeats(segment: ScriptSegment): VisualBeat[] {
  const total = Math.max(0.1, segment.end_sec - segment.start_sec);
  let chunks = sentenceChunks(segment.narration);
  const words = segment.narration.split(/\s+/).filter(Boolean);
  const carryNames = namedEntityTerms([
    segment.broll,
    ...(segment.search_queries ?? []),
    ...(segment.subject_keywords ?? []),
  ]);

  // A long spoken segment must not remain one visual shot merely because its sentence is short.
  // Estimate a practical number of shots from its actual rescaled audio duration.
  const desiredCount = Math.max(1, Math.ceil(total / BEAT_TARGET_SECONDS));
  if (chunks.length < desiredCount && words.length >= desiredCount) {
    const targetWords = Math.ceil(words.length / desiredCount);
    const split: string[] = [];
    for (let i = 0; i < words.length; i += targetWords) split.push(words.slice(i, i + targetWords).join(" "));
    chunks = split;
  }

  if (chunks.length <= 1) return [{ segment, offset_sec: 0, duration_sec: round1(total) }];

  // Allocate the real parent audio duration proportionally to spoken words. This keeps all beats
  // contiguous and preserves the exact scene duration after the original voiceover is rescaled.
  const weights = chunks.map((chunk) => Math.max(1, wordCount(chunk)));
  const totalWords = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return chunks.map((text, i) => {
    const duration = i === chunks.length - 1 ? total - cursor : total * weights[i] / totalWords;
    const beat: ScriptSegment = {
      ...segment,
      index: segment.index * 100 + i,
      label: `${segment.label} beat ${i + 1}`,
      narration: text,
      // A visual beat is a shorter shot inside the same parent scene, not a new topic.
      // Preserve the parent scene's concrete visual brief and named entities across its beats.
      // Filtering hints by literal word overlap used to drop proper nouns (e.g. a film/person
      // name) whenever that name was spoken in a neighbouring clause rather than this beat.
      broll: [
        ...relevantParentTerms([segment.broll], text, carryNames),
        text,
      ].join(" ").slice(0, 300),
      on_screen_text: null,
      search_queries: (segment.search_queries ?? []).filter((query) =>
        relevantParentTerms([query], text, carryNames).length > 0
      ).slice(0, 5),
      subject_keywords: relevantParentTerms(segment.subject_keywords, text, carryNames).slice(0, 4),
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
