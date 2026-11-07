// node --experimental-transform-types --test supabase/functions/pipeline/assembly.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAssemblyJob, cueTimeInScene, getAssemblyProvider } from "./assembly.ts";
import { splitIntoVisualBeats, type ScriptSegment } from "./timeline.ts";

const seg = (i: number, start: number, end: number, narration: string, text: string | null): ScriptSegment => ({
  index: i, start_sec: start, end_sec: end, label: `Part ${i + 1}`, narration, camera_angle: "medium", broll: "smartphone", on_screen_text: text, visual_type: "video",
});
const segments = [
  seg(0, 0, 18, "Is your phone the best way to invest in mutual funds today", "Invest From Your Phone"),
  seg(1, 18, 38, "Open the app and compare funds before you decide anything at all here", "Compare Funds"),
  seg(2, 38, 60, "So to recap, start small and stay consistent. Please like the video and subscribe to the channel for more.", "LIKE AND SUBSCRIBE"),
];

function script() {
  const job = buildAssemblyJob({ packageId: "p", title: "Invest From Your Phone Today", voiceUrl: "https://v/a.mp3", segments });
  job.broll[0].pieces = [{ kind: "video", url: "https://s/1.mp4", offset_sec: 0, duration_sec: 11, trim_start_sec: 0, source_id: "video:1" },
                         { kind: "image", url: "https://s/2.jpg", offset_sec: 11, duration_sec: 7, trim_start_sec: 0, source_id: "image:2" }];
  job.broll[1].pieces = [{ kind: "video", url: "https://s/3.mp4", offset_sec: 0, duration_sec: 20, trim_start_sec: 0, source_id: "video:3" }];
  // scene 3 has no stock media at all -> branded background
  const provider = getAssemblyProvider("creatomate", "k", null) as unknown as { buildRenderScript(j: unknown): any };
  return provider.buildRenderScript(job);
}
const flat = (els: any[]): any[] => els.flatMap((e) => [e, ...(e.elements ? flat(e.elements) : [])]);

test("every text/shape element is centre-anchored and inside the 10% safe margin", () => {
  const all = flat(script().elements).filter((e) => e.type === "text" || e.type === "shape");
  assert.ok(all.length > 10);
  for (const e of all) {
    assert.equal(e.x_anchor, "50%", `${e.type} "${e.text ?? ""}" lacks x_anchor`);
    assert.equal(e.y_anchor, "50%");
    const x = parseFloat(e.x); const w = parseFloat(e.width ?? "0");
    assert.ok(x - w / 2 >= -0.01 && x + w / 2 <= 100.01, `"${e.text}" spans ${x - w / 2}%..${x + w / 2}%`);
    if (e.type === "text" && e.width) assert.ok(x - w / 2 >= 10 - 0.01 || e.width === "24%", `"${e.text}" crosses the safe margin`);
  }
  const titles = flat(script().elements).filter((e) => e.type === "text" && e.text === "INVEST FROM YOUR PHONE");
  assert.equal(titles.length, 1, "hook headline is uppercased and present");
  assert.equal(titles[0].x, "50%"); assert.equal(titles[0].y, "50%");
});

test("captions are in a separate bottom safe area (86%), headlines are not", () => {
  const els = flat(script().elements);
  const captions = els.filter((e) => e.name?.startsWith("Caption-"));
  assert.ok(captions.length > 0 && captions.every((c) => c.y === "86%" && c.x === "50%"));
  const headlines = els.filter((e) => e.type === "text" && !e.name && e.y === "50%");
  assert.ok(headlines.length >= 2);
});

test("pieces: contiguous, inside the scene, videos muted and trimmed, images zoom", () => {
  const scene1 = script().elements.find((e: any) => e.name === "Scene-1");
  const media = scene1.elements.filter((e: any) => e.type === "video" || e.type === "image");
  assert.deepEqual(media.map((m: any) => [m.type, m.time, m.duration]), [["video", 0, 11], ["image", 11, 7]]);
  assert.equal(media[0].volume, "0%"); assert.equal(media[0].trim_start, 0);
  assert.equal(media[1].animations[0].type, "scale");
  assert.ok(media.every((m: any) => m.time + m.duration <= 18 + 1e-9));
  assert.ok(!("loop" in media[0]), "no looping");
});

test("scene without media keeps only the branded backdrop colour (no fake footage)", () => {
  const scene3 = script().elements.find((e: any) => e.name === "Scene-3");
  assert.ok(scene3.fill_color);
  assert.equal(scene3.elements.filter((e: any) => e.type === "video" || e.type === "image").length, 0);
});

test("closing scene has like, subscribe button, bell; unique tracks; synced to narration", () => {
  const scene3 = script().elements.find((e: any) => e.name === "Scene-3");
  const texts = scene3.elements.map((e: any) => e.text).filter(Boolean);
  for (const needle of ["LIKE & SUBSCRIBE", "SUBSCRIBE", "SUBSCRIBED", "TURN ON THE BELL", "LIKE"]) assert.ok(texts.includes(needle), `missing ${needle}`);
  assert.ok(texts.includes("\u{1F44D}") && texts.includes("\u{1F514}"));
  const tracks = scene3.elements.slice(3).map((e: any) => e.track); // CTA elements
  assert.equal(new Set(tracks).size, tracks.length, "CTA elements need distinct tracks");
  const like = scene3.elements.find((e: any) => e.text === "LIKE");
  const sub = scene3.elements.find((e: any) => e.text === "SUBSCRIBE");
  const expectedLike = cueTimeInScene(segments[2], /^like/i)!;
  assert.ok(Math.abs(like.time - expectedLike) < 0.01, `like at ${like.time}, voice says it at ${expectedLike}`);
  assert.ok(sub.time > like.time);
  assert.ok(scene3.elements.every((e: any) => e.time + (e.duration ?? 0) <= 22 + 1e-6), "nothing outlives the scene");
  // The headline "LIKE AND SUBSCRIBE" is not drawn twice
  assert.equal(scene3.elements.filter((e: any) => e.text === "LIKE AND SUBSCRIBE").length, 0);
  console.log(`  voice says "like" at +${expectedLike.toFixed(1)}s of 22s scene; icon appears at +${like.time.toFixed(1)}s; subscribe at +${sub.time.toFixed(1)}s`);
});


test("long narration segments split into short, ordered visual beats without changing total duration", () => {
  const long = seg(8, 40, 58, "The market opens with strong buying pressure. Traders watch the live index chart. Gold prices then move higher as investors seek safety. The final move changes the market outlook.", null);
  const beats = splitIntoVisualBeats(long);
  assert.ok(beats.length >= 3, `expected multiple visual beats, got ${beats.length}`);
  assert.equal(beats[0].offset_sec, 0);
  assert.ok(Math.abs(beats.reduce((sum, beat) => sum + beat.duration_sec, 0) - 18) < 0.11);
  for (const beat of beats) {
    assert.ok(beat.duration_sec >= 1.9 && beat.duration_sec <= 5.1, `unexpected beat duration ${beat.duration_sec}`);
    assert.ok(beat.segment.narration.trim().length > 0);
    assert.deepEqual(beat.segment.search_queries, [], "do not inherit broad parent-scene search queries");
  }
  for (let i = 1; i < beats.length; i++) {
    assert.ok(Math.abs(beats[i].offset_sec - (beats[i - 1].offset_sec + beats[i - 1].duration_sec)) < 0.11, "beats must be contiguous");
  }
});
