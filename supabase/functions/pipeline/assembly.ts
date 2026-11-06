/** Creatomate rendering adapter. Requires a Creatomate template with element names documented below. */
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
  constructor(private apiKey: string, private templateId: string) {}
  async submit(job: AssemblyJob): Promise<string> {
    // The template supplies the visual design; this pipeline supplies narration and script metadata.
    const modifications: Record<string, unknown> = {
      "Video-Title": job.title,
      "Narration-Audio": job.voiceUrl,
      "Caption-Text": job.captions.map(c => c.text).join("  •  "),
      "Scene-Plan": job.segments.map(s => `${s.start_sec}-${s.end_sec}s | ${s.camera_angle} | ${s.broll}`).join("\n"),
    };
    const res = await fetchWithRetry("https://api.creatomate.com/v2/renders", {
      method: "POST", headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: this.templateId, modifications, render_scale: 1, max_width: job.width, max_height: job.height, metadata: job.packageId }),
    }, { retries: 0, timeoutMs: 45_000 });
    await assertOk(res, "Creatomate render submission");
    const payload = await res.json();
    const render = Array.isArray(payload) ? payload[0] : payload;
    if (!render?.id) throw new PermanentError("Creatomate did not return a render ID");
    if (Array.isArray(render.errors) && render.errors.length) throw new PermanentError(`Creatomate template errors: ${render.errors.join("; ")}`);
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

export function getAssemblyProvider(id: string | null, apiKey: string | null, templateId: string | null): AssemblyProvider | null {
  if (!id || id === "none") return null;
  if (!apiKey?.trim()) throw new PermanentError("Add the editing provider API key in API Settings");
  if (id === "creatomate") {
    if (!templateId?.trim()) throw new PermanentError("Add a Creatomate Template ID in API Settings");
    return new CreatomateProvider(apiKey.trim(), templateId.trim());
  }
  if (id === "shotstack") throw new PermanentError("Shotstack is not implemented in this build. Select Creatomate.");
  throw new PermanentError(`Unsupported editing provider: ${id}`);
}
