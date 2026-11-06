/** Template-free Creatomate rendering adapter. Builds RenderScript per video. */
import { assertOk, fetchWithRetry, PermanentError } from "./retry.ts";
import type { ScriptSegment } from "./timeline.ts";

export type AssemblyProviderId = "none" | "creatomate" | "shotstack";
export type CaptionCue = { start_sec: number; end_sec: number; text: string };
export type BrollClip = { start_sec: number; end_sec: number; query: string };
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
  return { packageId: input.packageId, title: input.title, width: 1280, height: 720,
    voiceUrl: input.voiceUrl, segments: input.segments,
    broll: input.segments.filter(s => s.broll.trim()).map(s => ({ start_sec: s.start_sec, end_sec: s.end_sec, query: s.broll })),
    captions: buildCaptionCues(input.segments) };
}

class CreatomateProvider implements AssemblyProvider {
  readonly id = "creatomate" as const;
  constructor(private apiKey: string) {}

  /** Build a complete, template-free Creatomate RenderScript from the actual script timeline. */
  private buildRenderScript(job: AssemblyJob): Record<string, unknown> {
    const duration = Math.max(1, job.segments[job.segments.length - 1]?.end_sec ?? 1);
    const palette = ["#101827", "#172554", "#1f2937", "#27213d", "#102a2a"];
    const elements: Record<string, unknown>[] = [
      { type: "audio", track: 1, time: 0, duration: null, source: job.voiceUrl, audio_fade_out: 0.6 },
    ];

    // Each script segment becomes its own designed scene. B-roll directions are shown as
    // contextual visual cues; actual stock footage requires a footage provider/source URL.
    for (const [index, segment] of job.segments.entries()) {
      const sceneDuration = Math.max(0.5, segment.end_sec - segment.start_sec);
      const headline = (segment.on_screen_text || segment.label || segment.narration).trim().slice(0, 110);
      const visualDirection = segment.broll.trim().slice(0, 180);
      elements.push({
        name: `Scene-${index + 1}`,
        type: "composition",
        track: 2,
        time: segment.start_sec,
        duration: sceneDuration,
        width: job.width,
        height: job.height,
        fill_color: palette[index % palette.length],
        elements: [
          {
            type: "text", track: 1, time: 0, duration: sceneDuration,
            x: "8%", y: "13%", width: "84%", height: "12%",
            text: `SCENE ${String(index + 1).padStart(2, "0")}`,
            font_family: "Montserrat", font_weight: "700", font_size: "2.2 vmin",
            fill_color: "#a5b4fc", x_alignment: "0%", y_alignment: "50%",
          },
          {
            type: "text", track: 2, time: 0.2, duration: Math.max(0.3, sceneDuration - 0.2),
            x: "8%", y: "31%", width: "84%", height: "35%",
            text: headline,
            font_family: "Montserrat", font_weight: "800", font_size: "5.2 vmin",
            fill_color: "#ffffff", x_alignment: "0%", y_alignment: "50%",
            animations: [{ time: 0, duration: 0.55, type: "text-slide", direction: "up", scope: "split-clip", split: "line" }],
          },
          ...(visualDirection ? [{
            type: "text", track: 3, time: 0.35, duration: Math.max(0.3, sceneDuration - 0.35),
            x: "8%", y: "76%", width: "84%", height: "12%",
            text: `VISUAL: ${visualDirection}`,
            font_family: "Montserrat", font_weight: "500", font_size: "2.1 vmin",
            fill_color: "#cbd5e1", x_alignment: "0%", y_alignment: "50%",
          }] : []),
        ],
      });
    }

    for (const [index, cue] of job.captions.entries()) {
      elements.push({
        name: `Caption-${index + 1}`,
        type: "text", track: 3, time: cue.start_sec,
        duration: Math.max(0.2, cue.end_sec - cue.start_sec),
        x: "8%", y: "86%", width: "84%", height: "9%",
        text: cue.text, font_family: "Montserrat", font_weight: "700",
        font_size: "3 vmin", fill_color: "#ffffff",
        stroke_color: "#000000", stroke_width: "0.35 vmin",
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
    if (status === "succeeded") return { status: "completed", videoUrl: render.url ?? null, error: null };
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
