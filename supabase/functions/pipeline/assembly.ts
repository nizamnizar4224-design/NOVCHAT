/** Template-free Creatomate rendering adapter. Builds RenderScript per video. */
import { assertOk, fetchWithRetry, PermanentError } from "./retry.ts";
import type { ScriptSegment } from "./timeline.ts";

export type AssemblyProviderId = "none" | "creatomate" | "shotstack";
export type CaptionCue = { start_sec: number; end_sec: number; text: string };
/** One stock asset placed inside a scene. Pieces are contiguous and never exceed the clip's native length. */
export type MediaPiece = { kind: "video" | "image"; url: string; offset_sec: number; duration_sec: number; trim_start_sec: number; source_id: string };
export type BrollClip = { scene_index: number; start_sec: number; end_sec: number; query: string; visual_type: "video" | "image"; pieces: MediaPiece[] };
export type AssemblyJob = {
  packageId: string; title: string; width: number; height: number;
  voiceUrl: string; segments: ScriptSegment[];
  broll: BrollClip[]; captions: CaptionCue[];
};
export type AssemblyStatus = { status: "pending" | "processing" | "completed" | "failed"; videoUrl: string | null; error: string | null };
export interface AssemblyProvider { readonly id: AssemblyProviderId; submit(job: AssemblyJob): Promise<string>; poll(renderId: string): Promise<AssemblyStatus>; }

const MAX_WORDS_PER_CAPTION = 7;
export function buildCaptionCues(segments: ScriptSegment[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const segment of segments) {
    const words = segment.narration.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += MAX_WORDS_PER_CAPTION) chunks.push(words.slice(i, i + MAX_WORDS_PER_CAPTION).join(" "));
    const span = segment.end_sec - segment.start_sec;
    chunks.forEach((text, i) => cues.push({
      start_sec: Math.round((segment.start_sec + span * i / chunks.length) * 10) / 10,
      end_sec: Math.round((segment.start_sec + span * (i + 1) / chunks.length) * 10) / 10, text,
    }));
  }
  return cues;
}
export function buildAssemblyJob(input: { packageId: string; title: string; voiceUrl: string; segments: ScriptSegment[] }): AssemblyJob {
  return { packageId: input.packageId, title: input.title, width: 1920, height: 1080,
    voiceUrl: input.voiceUrl, segments: input.segments,
    broll: input.segments.map(s => ({ scene_index: s.index, start_sec: s.start_sec, end_sec: s.end_sec, query: s.broll.trim() || s.label, visual_type: s.visual_type ?? "video", pieces: [] })),
    captions: buildCaptionCues(input.segments) };
}


// Creatomate positions an element by its ANCHOR point (default 50%/50%), so x:"10%" put the centre of an
// 80%-wide text at 10% of the width (clipped/off-centre). Every element now states its centre explicitly.
const CENTER = { x: "50%", y: "50%", x_anchor: "50%", y_anchor: "50%" } as const;
const FULL_FRAME = { ...CENTER, width: "100%", height: "100%" } as const;
const CTA_PATTERN = /(subscribe|like|bell)/i;

/**
 * When no genuinely relevant media exists, show an animated information card derived from the
 * current narration beat instead of leaving a long, empty branded background. This is an honest
 * graphic fallback, not fabricated stock footage.
 */
function buildNarrationCard(segment: ScriptSegment, start: number, duration: number, ordinal: number): Record<string, unknown>[] {
  const rawTitle = (segment.on_screen_text || segment.label || "Key point").trim();
  const title = rawTitle.replace(/\s+/g, " ").slice(0, 54).toUpperCase();
  const subline = segment.narration.replace(/\s+/g, " ").trim().slice(0, 105);
  const pop = { time: 0, duration: Math.min(0.45, duration * 0.2), type: "scale", easing: "quadratic-out", fade: true, start_scale: "94%", end_scale: "100%" };
  const track = 8 + ordinal * 4;
  return [
    { type: "shape", track, time: start, duration, ...CENTER, x: "50%", y: "50%", width: "86%", height: "36%", fill_color: "#10213d", opacity: "92%", animations: [pop] },
    { type: "shape", track: track + 1, time: start + Math.min(0.18, duration * 0.08), duration: Math.max(0.3, duration - 0.18), ...CENTER, x: "50%", y: "34%", width: "20%", height: "1.2%", fill_color: "#38bdf8", animations: [{ time: 0, duration: Math.min(0.35, duration * 0.15), type: "scale", easing: "quadratic-out", fade: true, start_scale: "0%", end_scale: "100%" }] },
    { type: "text", track: track + 2, time: start + Math.min(0.12, duration * 0.06), duration: Math.max(0.3, duration - 0.12), ...CENTER, x: "50%", y: "46%", width: "76%", text: title, font_family: "Montserrat", font_weight: "800", font_size: "6 vmin", fill_color: "#ffffff", x_alignment: "50%", y_alignment: "50%", animations: [{ ...pop, type: "text-slide", direction: "up" }] },
    { type: "text", track: track + 3, time: start + Math.min(0.28, duration * 0.12), duration: Math.max(0.25, duration - 0.28), ...CENTER, x: "50%", y: "59%", width: "76%", text: subline, font_family: "Montserrat", font_weight: "500", font_size: "3.1 vmin", fill_color: "#dbeafe", x_alignment: "50%", y_alignment: "50%" },
  ];
}

/** Time (seconds, relative to the scene) at which the narration reaches the first matching word. */
export function cueTimeInScene(segment: ScriptSegment, pattern: RegExp): number | null {
  const words = segment.narration.split(/\s+/).filter(Boolean);
  const at = words.findIndex((w) => pattern.test(w));
  if (at < 0 || words.length === 0) return null;
  return ((segment.end_sec - segment.start_sec) * at) / words.length;
}

/** Final CTA: like icon, subscribe button (clicks to "SUBSCRIBED"), bell. Timed to the voiceover words. */
export function buildCtaElements(segment: ScriptSegment, sceneDuration: number): Record<string, unknown>[] {
  const latest = Math.max(0, sceneDuration - 3.5);
  const likeAt = Math.min(latest, Math.max(0, cueTimeInScene(segment, /^like/i) ?? sceneDuration - 6));
  const subRaw = cueTimeInScene(segment, /^subscrib/i);
  const subAt = Math.min(sceneDuration - 2.5, Math.max(likeAt + 0.8, subRaw ?? likeAt + 1.2));
  const bellAt = Math.min(sceneDuration - 1.5, subAt + 1.4);
  const clickAt = Math.min(sceneDuration - 0.8, subAt + 1.0);
  const until = (t: number) => Math.max(0.3, sceneDuration - t);
  const pop = (from = "0%", to = "100%") => ({ time: 0, duration: 0.4, type: "scale", easing: "quadratic-out", fade: true, start_scale: from, end_scale: to });
  const pulse = (at: number) => ({ time: at, duration: 0.25, type: "scale", easing: "quadratic-in-out", fade: false, start_scale: "100%", end_scale: "115%" });
  const label = (text: string, x: string, t: number) => ({
    type: "text", track: 7, time: t, duration: until(t), ...CENTER, x, y: "64%", width: "24%", text,
    font_family: "Montserrat", font_weight: "800", font_size: "3.4 vmin", fill_color: "#ffffff",
    stroke_color: "#000000", stroke_width: "0.25 vmin", x_alignment: "50%", y_alignment: "50%",
    animations: [pop()],
  });
  const items: Record<string, unknown>[] = [
    { type: "text", track: 4, time: likeAt, duration: until(likeAt), ...CENTER, y: "30%", width: "80%",
      text: "LIKE & SUBSCRIBE", font_family: "Montserrat", font_weight: "800", font_size: "8 vmin",
      fill_color: "#ffffff", stroke_color: "#000000", stroke_width: "0.3 vmin", x_alignment: "50%", y_alignment: "50%",
      animations: [pop("80%", "100%")] },
    // Like
    { type: "text", track: 5, time: likeAt, duration: until(likeAt), ...CENTER, x: "27%", y: "50%", width: "24%",
      text: "\u{1F44D}", font_size: "16 vmin", x_alignment: "50%", y_alignment: "50%", animations: [pop("0%", "100%"), pulse(0.6)] },
    label("LIKE", "27%", likeAt),
    // Subscribe button: red, then a "click" pulse and a grey SUBSCRIBED state
    { type: "shape", track: 5, time: subAt, duration: until(subAt), ...CENTER, x: "50%", y: "50%", width: "26%", height: "12%",
      fill_color: "#ff0000", animations: [pop("0%", "100%"), pulse(clickAt - subAt)] },
    { type: "text", track: 6, time: subAt, duration: Math.max(0.3, clickAt - subAt), ...CENTER, x: "50%", y: "50%", width: "24%",
      text: "SUBSCRIBE", font_family: "Montserrat", font_weight: "800", font_size: "4.2 vmin", fill_color: "#ffffff",
      x_alignment: "50%", y_alignment: "50%", animations: [pop()] },
    { type: "shape", track: 6, time: clickAt + 0.25, duration: until(clickAt + 0.25), ...CENTER, x: "50%", y: "50%", width: "26%", height: "12%", fill_color: "#4b5563" },
    { type: "text", track: 7, time: clickAt + 0.25, duration: until(clickAt + 0.25), ...CENTER, x: "50%", y: "50%", width: "24%",
      text: "SUBSCRIBED", font_family: "Montserrat", font_weight: "800", font_size: "3.8 vmin", fill_color: "#ffffff",
      x_alignment: "50%", y_alignment: "50%" },
    // Bell: pops in, then rings (repeated scale pulses)
    { type: "text", track: 5, time: bellAt, duration: until(bellAt), ...CENTER, x: "73%", y: "50%", width: "24%",
      text: "\u{1F514}", font_size: "16 vmin", x_alignment: "50%", y_alignment: "50%",
      animations: [pop("0%", "100%"), pulse(0.6), pulse(1.0), pulse(1.4)] },
    label("TURN ON THE BELL", "73%", bellAt),
  ];
  // Every element gets its own track (elements that overlap in time must not share one).
  return items.map((item, i) => ({ ...item, track: 4 + i }));
}

class CreatomateProvider implements AssemblyProvider {
  readonly id = "creatomate" as const;
  constructor(private apiKey: string) {}

  /** Build a complete, template-free Creatomate RenderScript from the actual script timeline. */
  private buildRenderScript(job: AssemblyJob): Record<string, unknown> {
    const duration = Math.max(1, job.segments[job.segments.length - 1]?.end_sec ?? 1);
    // Branded backdrop colours: only visible where a scene has no relevant stock media.
    const palette = ["#101827", "#172554", "#1f2937", "#27213d", "#102a2a"];
    const elements: Record<string, unknown>[] = [
      { type: "audio", track: 1, time: 0, duration: null, source: job.voiceUrl, audio_fade_out: 0.6 },
    ];
    const lastIndex = job.segments.length - 1;

    for (const [index, segment] of job.segments.entries()) {
      const sceneDuration = Math.max(0.5, segment.end_sec - segment.start_sec);
      const clip = job.broll.find((c) => c.scene_index === segment.index);
      const isHook = index === 0;
      const isLast = index === lastIndex;
      const sceneElements: Record<string, unknown>[] = [];

      // Stock media: each piece plays at native speed (videos are trimmed, never looped or stretched).
      const pieces = clip?.pieces ?? [];
      for (const [pieceIndex, piece] of pieces.entries()) {
        const nextOffset = pieces[pieceIndex + 1]?.offset_sec ?? sceneDuration;
        const pieceDuration = Math.max(0.2, Math.min(piece.duration_sec, nextOffset - piece.offset_sec, sceneDuration - piece.offset_sec));
        if (piece.kind === "image") {
          const zoomIn = pieceIndex % 2 === 0;
          sceneElements.push({
            type: "image", track: 1, time: piece.offset_sec, duration: pieceDuration, source: piece.url,
            ...FULL_FRAME, fit: "cover",
            animations: [{ time: 0, duration: pieceDuration, type: "scale", easing: "linear", fade: false,
              start_scale: zoomIn ? "100%" : "110%", end_scale: zoomIn ? "110%" : "100%" }],
          });
        } else {
          sceneElements.push({
            type: "video", track: 1, time: piece.offset_sec, duration: pieceDuration, source: piece.url,
            ...FULL_FRAME, fit: "cover", volume: "0%", trim_start: piece.trim_start_sec,
          });
        }
      }

      // Light dim for text contrast (full frame, centre-anchored).
      sceneElements.push({ type: "shape", track: 2, time: 0, duration: sceneDuration, ...FULL_FRAME,
        fill_color: "#000000", opacity: isLast ? "40%" : "30%" });

      // Fill only uncovered timeline gaps with narration-specific animated information cards.
      // This prevents long empty branded stretches without pretending unrelated footage is relevant.
      if (!isLast) {
        const sortedPieces = [...pieces].sort((a, b) => a.offset_sec - b.offset_sec);
        let gapCursor = 0;
        let cardOrdinal = 0;
        const addGapCard = (gapStart: number, gapEnd: number) => {
          const gapDuration = gapEnd - gapStart;
          if (gapDuration >= 1.25) {
            sceneElements.push(...buildNarrationCard(segment, gapStart, gapDuration, cardOrdinal++));
          }
        };
        for (const piece of sortedPieces) {
          const pieceStart = Math.max(0, piece.offset_sec);
          const pieceEnd = Math.min(sceneDuration, piece.offset_sec + piece.duration_sec);
          if (pieceStart > gapCursor) addGapCard(gapCursor, pieceStart);
          gapCursor = Math.max(gapCursor, pieceEnd);
        }
        if (gapCursor < sceneDuration) addGapCard(gapCursor, sceneDuration);
      }

      // Headline: centred horizontally and vertically, inside a 10% safe margin, shown briefly so
      // the footage stays visible. The closing scene draws its own call to action instead.
      const rawHeadline = (segment.on_screen_text || segment.label || "").trim();
      const hookFallback = isHook ? job.title.split(/\s+/).slice(0, 5).join(" ") : "";
      const headline = (rawHeadline || hookFallback).slice(0, 60);
      const sortedForCoverage = [...pieces].sort((a, b) => a.offset_sec - b.offset_sec);
      const hasFullVisualCoverage = sortedForCoverage.length > 0
        && sortedForCoverage[0].offset_sec <= 0.2
        && sortedForCoverage[sortedForCoverage.length - 1].offset_sec + sortedForCoverage[sortedForCoverage.length - 1].duration_sec >= sceneDuration - 0.2;
      // When gaps need narration cards, hide the global headline to avoid stacking two text blocks.
      const showHeadline = headline !== "" && !(isLast && CTA_PATTERN.test(headline)) && (hasFullVisualCoverage || isLast);
      if (showHeadline) {
        const shown = Math.min(sceneDuration, isHook ? 6 : 4.5);
        sceneElements.push({
          type: "text", track: 3, time: 0.15, duration: Math.max(0.4, shown - 0.15),
          ...CENTER, y: "50%", width: "80%",
          text: isHook ? headline.toUpperCase() : headline,
          font_family: "Montserrat", font_weight: "800", font_size: isHook ? "8.5 vmin" : "6.5 vmin",
          fill_color: "#ffffff", stroke_color: "#000000", stroke_width: "0.3 vmin",
          x_alignment: "50%", y_alignment: "50%",
          animations: [{ time: 0, duration: 0.45, type: "text-slide", direction: "up", scope: "split-clip", split: "line" }],
        });
      }

      if (isLast) sceneElements.push(...buildCtaElements(segment, sceneDuration));

      elements.push({ name: `Scene-${index + 1}`, type: "composition", track: 2,
        time: segment.start_sec, duration: sceneDuration, width: job.width, height: job.height,
        fill_color: palette[index % palette.length], elements: sceneElements });
    }

    // Subtitles live in their own bottom safe area (86% line), separate from headlines/CTA.
    for (const [index, cue] of job.captions.entries()) {
      elements.push({
        name: `Caption-${index + 1}`,
        type: "text", track: 3, time: cue.start_sec,
        duration: Math.max(0.2, cue.end_sec - cue.start_sec),
        ...CENTER, y: "86%", width: "80%",
        text: cue.text, font_family: "Montserrat", font_weight: "700",
        font_size: "3.2 vmin", fill_color: "#ffffff",
        stroke_color: "#000000", stroke_width: "0.4 vmin",
        x_alignment: "50%", y_alignment: "50%",
      });
    }

    return { output_format: "mp4", width: job.width, height: job.height, frame_rate: 30, duration, elements };
  }

  async submit(job: AssemblyJob): Promise<string> {
    const source = this.buildRenderScript(job);
    const res = await fetchWithRetry("https://api.creatomate.com/v2/renders", {
      method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...source, metadata: job.packageId }),
    }, { retries: 0, timeoutMs: 45_000 });
    await assertOk(res, "Creatomate template-free render submission");
    const payload = await res.json();
    const render = Array.isArray(payload) ? payload[0] : payload;
    if (!render?.id) throw new PermanentError("Creatomate did not return a render ID");
    if (Array.isArray(render.errors) && render.errors.length) throw new PermanentError(`Creatomate RenderScript errors: ${render.errors.join("; ")}`);
    return String(render.id);
  }

  async poll(renderId: string): Promise<AssemblyStatus> {
    const res = await fetchWithRetry(`https://api.creatomate.com/v2/renders/${encodeURIComponent(renderId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }, { retries: 2, timeoutMs: 30_000 });
    await assertOk(res, "Creatomate render status");
    const render = await res.json();
    const status = String(render.status ?? "");
    if (status === "succeeded") {
      // Creatomate's completed render normally exposes `url`. Keep the alternate
      // output_url fallback so a response-shape variation cannot silently stall the package.
      const videoUrl = typeof render.url === "string" && render.url.trim()
        ? render.url
        : typeof render.output_url === "string" && render.output_url.trim()
          ? render.output_url
          : null;
      if (!videoUrl) {
        throw new Error(`Creatomate render ${renderId} succeeded but returned no video URL`);
      }
      return { status: "completed", videoUrl, error: null };
    }
    if (status === "failed") return { status: "failed", videoUrl: null, error: render.error_message ?? "Creatomate render failed" };
    return { status: "processing", videoUrl: null, error: null };
  }
}

export function getAssemblyProvider(id: string | null, apiKey: string | null, _templateId: string | null): AssemblyProvider | null {
  if (!id || id === "none") return null;
  if (!apiKey?.trim()) throw new PermanentError("Add the editing provider API key in API Settings");
  if (id === "creatomate") return new CreatomateProvider(apiKey.trim());
  if (id === "shotstack") throw new PermanentError("Shotstack is not implemented in this build. Select Creatomate.");
  throw new PermanentError(`Unsupported editing provider: ${id}`);
}
