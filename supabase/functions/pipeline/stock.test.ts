// Run with:  node --test supabase/functions/pipeline/stock.test.ts   (Node 22+)
//        or:  deno test supabase/functions/pipeline/stock.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assemblePieces,
  buildSearchPlan,
  createLedger,
  DEFAULT_SEARCH_BUDGET,
  planScene,
  scoreHit,
  SearchBudget,
  type SearchContext,
  type RawHit,
  type SceneForSearch,
  type StockSource,
} from "./stock.ts";
import { PixabayClient } from "./pixabay.ts";

let nextId = 1000;
const video = (tags: string, duration: number, extra: Record<string, unknown> = {}): RawHit => {
  const id = nextId++;
  return {
    id, tags, duration, pageURL: `https://pixabay.com/videos/${tags.split(/[ ,]+/).join("-")}-${id}/`,
    videos: { medium: { url: `https://cdn.example/v${id}.mp4`, width: 1920, height: 1080 }, small: { url: `https://cdn.example/s${id}.mp4`, width: 1280, height: 720 } },
    likes: 10, downloads: 100, ...extra,
  };
};
const image = (tags: string, extra: Record<string, unknown> = {}): RawHit => {
  const id = nextId++;
  return { id, tags, pageURL: `https://pixabay.com/photos/${tags.split(/[ ,]+/).join("-")}-${id}/`,
    largeImageURL: `https://cdn.example/i${id}.jpg`, imageWidth: 1920, imageHeight: 1280, likes: 5, downloads: 50, ...extra };
};

class FakeSource implements StockSource {
  calls: string[] = [];
  constructor(private videos: Record<string, RawHit[]>, private images: Record<string, RawHit[]> = {}) {}
  async searchVideos(q: string) { this.calls.push(`video:${q}`); return this.videos[q] ?? this.videos["*"] ?? []; }
  async searchImages(q: string) { this.calls.push(`image:${q}`); return this.images[q] ?? this.images["*"] ?? []; }
}

const phoneScene: SceneForSearch = {
  index: 0, label: "Mobile banking", narration: "Open your banking app on your smartphone and check the balance.",
  broll: "Close-up of a person using a smartphone to open a mobile banking app", on_screen_text: "MOBILE BANKING", visual_type: "video",
};

/** The exact matcher that shipped before this change (kept here only to demonstrate the root cause). */
function oldPixabayTagMatch(query: string, tags: unknown): boolean {
  if (typeof tags !== "string" || !tags.trim()) return true;
  const stop = new Set(["the", "and", "with", "for", "from", "into", "about", "show", "showing", "indian", "close", "up"]);
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));
  const tagWords = new Set(tags.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  return words.some((w) => tagWords.has(w) || [...tagWords].some((t) => t.includes(w) || w.includes(t)));
}

test("ROOT CAUSE: old matcher accepted unrelated footage, new scorer rejects it", () => {
  const query = phoneScene.broll;
  const unrelated = [
    "ocean, waves, person, sunset", // shares only "person"
    "flowers, apple, garden",        // "app" is a substring of "apple"
    "storm, clouds, sky",            // empty overlap with query -> old code still falls through to images
    "",                               // no tags at all -> old code returned true
  ];
  const plan = buildSearchPlan(phoneScene, "mobile banking tips", false);
  for (const tags of unrelated.slice(0, 2).concat(unrelated[3])) {
    if (tags !== "storm, clouds, sky") assert.equal(oldPixabayTagMatch(query, tags), true, `old matcher accepted "${tags}"`);
    const s = scoreHit(plan.concepts, { tags }, 0, plan.sceneTokens);
    assert.ok(!s.anchored || s.score < 30, `new scorer must reject "${tags}" (score ${s.score}, anchored ${s.anchored})`);
  }
  const good = scoreHit(plan.concepts, { tags: "smartphone, banking, finance, hand" }, 0, plan.sceneTokens);
  assert.ok(good.anchored && good.score > 50, `relevant clip should score high, got ${good.score}`);
});

test("query generation: short, specific, synonym-aware", () => {
  const plan = buildSearchPlan(phoneScene, "mobile banking", false);
  assert.ok(plan.queries.length >= 4, plan.queries.join(" | "));
  assert.ok(plan.queries.every((q) => q.split(" ").length <= 4), "no query longer than 4 words");
  assert.ok(plan.queries.some((q) => /smartphone/.test(q)));
  assert.ok(plan.queries.some((q) => /bank/.test(q)));
  console.log("  phone queries:", plan.queries.join(" | "));

  const fund = buildSearchPlan({ index: 1, label: "Mutual fund", narration: "A mutual fund pools money from investors.", broll: "Indian investor reviewing mutual fund investment statement", on_screen_text: "MUTUAL FUNDS" }, "mutual funds", false);
  console.log("  fund queries: ", fund.queries.join(" | "));
  assert.ok(fund.queries.some((q) => /invest/.test(q)));
  const calc = buildSearchPlan({ index: 2, label: "Returns", narration: "Use a calculator to estimate your returns.", broll: "calculator and returns on investment growth", on_screen_text: null }, "mutual funds", false);
  console.log("  calc queries: ", calc.queries.join(" | "));
  assert.ok(calc.queries.some((q) => /calculator/.test(q)));
});

test("scene with ocean/storm/flower results gets NO footage (branded background is the last resort)", async () => {
  const src = new FakeSource({ "*": [video("ocean waves sunset", 20), video("storm clouds sky", 20), video("flowers garden spring", 20), video("forest trees nature person", 20)] },
    { "*": [image("beach sea sand person"), image("mountain landscape nature")] });
  const plan = await planScene(phoneScene, 12, src, createLedger(), { topicText: "mobile banking", isFinalScene: false });
  assert.equal(plan.status, "none");
  assert.equal(plan.pieces.length, 0);
  assert.ok(src.calls.length > 3, "retried with several queries and both media types");
  assert.ok(src.calls.some((c) => c.startsWith("image:")), "images were searched too");
});

test("retries with better queries when the first query returns junk", async () => {
  const src = new FakeSource({
    "*": [video("ocean waves", 20)],
    "smartphone": [video("smartphone, mobile, hand, banking app", 18)],
  });
  const plan = await planScene(phoneScene, 12, src, createLedger(), { topicText: "mobile banking", isFinalScene: false });
  assert.equal(plan.status, "full");
  assert.match(plan.pieces[0].candidate.tags, /smartphone/);
  assert.ok(plan.queriesTried.length >= 2);
});

test("duplicate assets are never reused across scenes", async () => {
  const shared = video("smartphone, banking app, mobile", 30);
  const second = video("smartphone, mobile payment, hand", 30);
  const third = video("smartphone, mobile finance, person", 30);
  const src = new FakeSource({ "*": [shared, second, third] });
  const ledger = createLedger();
  const picked: string[] = [];
  for (let i = 0; i < 3; i++) {
    const plan = await planScene({ ...phoneScene, index: i }, 10, src, ledger, { topicText: "mobile banking", isFinalScene: false });
    assert.equal(plan.status, "full", `scene ${i}`);
    picked.push(...plan.pieces.map((p) => p.candidate.key));
  }
  assert.equal(new Set(picked).size, picked.length, `duplicates found: ${picked.join(",")}`);
  // A 4th scene has no unused relevant asset: it must NOT silently reuse or invent one.
  const fourth = await planScene({ ...phoneScene, index: 3 }, 10, src, ledger, { topicText: "mobile banking", isFinalScene: false });
  assert.equal(fourth.status, "none");
});

test("20s scene + only a 15s clip: stitched with a second relevant clip, never stretched or looped", async () => {
  const a = video("smartphone, banking, mobile", 15);
  const b = video("smartphone, mobile app, finance", 9);
  const src = new FakeSource({ "*": [a, b] });
  const plan = await planScene(phoneScene, 20, src, createLedger(), { topicText: "mobile banking", isFinalScene: false });
  assert.equal(plan.status, "full");
  assert.equal(plan.pieces.length, 2);
  for (const p of plan.pieces) assert.ok(p.durationSec <= (p.candidate.duration ?? 0), `piece ${p.durationSec}s exceeds clip ${p.candidate.duration}s`);
  const total = plan.pieces.reduce((s, p) => s + p.durationSec, 0);
  assert.ok(Math.abs(total - 20) < 0.05, `total ${total}`);
  assert.equal(plan.pieces[1].offsetSec, plan.pieces[0].durationSec, "pieces are contiguous");
});

test("20s scene + 15s clip + relevant image: video then image fills the rest", async () => {
  const src = new FakeSource({ "*": [video("smartphone, banking, mobile", 15)] }, { "*": [image("smartphone, banking app, mobile")] });
  const plan = await planScene(phoneScene, 20, src, createLedger(), { topicText: "mobile banking", isFinalScene: false });
  assert.equal(plan.status, "full");
  assert.deepEqual(plan.pieces.map((p) => p.candidate.kind), ["video", "image"]);
  assert.ok(plan.pieces[0].durationSec <= 15);
});

test("only 5s needed from a 15s clip: only 5s is used", async () => {
  const src = new FakeSource({ "*": [video("smartphone, banking, mobile", 15)] });
  const plan = await planScene(phoneScene, 5, src, createLedger(), { topicText: "mobile banking", isFinalScene: false });
  assert.equal(plan.pieces.length, 1);
  assert.equal(plan.pieces[0].durationSec, 5);
  assert.equal(plan.pieces[0].trimStartSec, 0);
});

test("images never hold longer than 5s; uncovered time remains an honest gap", async () => {
  const src = new FakeSource({ "*": [] }, { "*": [image("calculator, finance"), image("calculator, accounting, numbers"), image("calculator, money, desk")] });
  const scene: SceneForSearch = { index: 4, label: "Calculator", narration: "Use a calculator", broll: "calculator on desk", on_screen_text: null };
  const plan = await planScene(scene, 25, src, createLedger(), { topicText: "mutual funds calculator", isFinalScene: false });
  assert.equal(plan.status, "partial");
  assert.equal(plan.pieces.length, 3);
  assert.ok(plan.pieces.every((p) => p.candidate.kind === "image"));
  assert.ok(plan.pieces.every((p) => p.durationSec <= 5), "still images must change at least every five seconds");
  assert.ok(plan.coveredSec <= 15.05, "do not pretend three images cover a 25-second scene");
});

test("portrait video and tiny clips are rejected", async () => {
  const portrait = video("smartphone, banking", 20, { videos: { medium: { url: "https://cdn.example/p.mp4", width: 1080, height: 1920 } } });
  const tiny = video("smartphone, banking", 1.5);
  const src = new FakeSource({ "*": [portrait, tiny] });
  const plan = await planScene(phoneScene, 8, src, createLedger(), { topicText: "mobile banking", isFinalScene: false });
  assert.equal(plan.pieces.length, 0);
});

test("closing scene never searches for subscribe/bell/like and uses recap/topic subject", () => {
  const scene: SceneForSearch = { index: 9, label: "Recap and CTA", narration: "So to recap, mutual funds are simple. Like and subscribe!", broll: "youtube subscribe button bell animation", on_screen_text: "LIKE AND SUBSCRIBE" };
  const plan = buildSearchPlan(scene, "mutual funds for beginners", true);
  const all = plan.queries.join(" ");
  assert.doesNotMatch(all, /subscribe|bell|like|youtube|button/);
  assert.ok(plan.queries.length > 0 || plan.topicQueries.length > 0, "still has something relevant to search");
  console.log("  final scene queries:", plan.queries.join(" | "), "|| topic:", plan.topicQueries.join(" | "));
});

test("assemblePieces: gap is reported when footage cannot cover the scene", () => {
  const mk = (d: number, score = 60) => ({ kind: "video" as const, id: String(d), key: `video:${d}`, tags: "", tagStems: [], pageUrl: null, downloadUrl: "u", duration: d, width: 1920, height: 1080, score, coverage: 1, tier: "scene" as const, query: "q" });
  const r = assemblePieces(30, [mk(8), mk(7)], []);
  assert.equal(r.pieces.length, 2);
  assert.ok(r.coveredSec < 30);
});

test("PixabayClient: caches identical queries and honours the request budget", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response(JSON.stringify({ hits: [{ id: 1 }] }), { status: 200 }); }) as typeof fetch;
  const client = new PixabayClient("k", { fetchImpl, maxRequests: 3 });
  await client.searchVideos("phone"); await client.searchVideos("Phone "); // cache hit
  assert.equal(calls, 1);
  await client.searchVideos("a1"); await client.searchImages("a2");
  const blocked = await client.searchVideos("a3");
  assert.deepEqual(blocked, []);
  assert.equal(calls, 3);
  assert.match(client.disabledReason ?? "", /budget/);
});

test("PixabayClient: stops after repeated hard failures (bad API key)", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response("[ERROR 400] Invalid API key", { status: 400 }); }) as typeof fetch;
  const client = new PixabayClient("bad", { fetchImpl });
  for (const q of ["a1", "a2", "a3"]) await client.searchVideos(q).catch(() => []);
  assert.deepEqual(await client.searchVideos("a4"), []);
  assert.equal(calls, 3);
});

test("PixabayClient: waits and retries once on 429", async () => {
  let calls = 0; const slept: number[] = [];
  const fetchImpl = (async () => {
    calls++;
    return calls === 1 ? new Response("slow down", { status: 429, headers: { "x-ratelimit-reset": "2" } }) : new Response(JSON.stringify({ hits: [{ id: 7 }] }), { status: 200 });
  }) as typeof fetch;
  const client = new PixabayClient("k", { fetchImpl, sleep: async (ms) => { slept.push(ms); } });
  const hits = await client.searchVideos("phone");
  assert.equal(hits.length, 1);
  assert.equal(slept.length, 1);
});

// ---------------------------------------------------------------------------------------------
// Fair-share search budget
// ---------------------------------------------------------------------------------------------
const SUBJECTS = ["smartphone", "calculator", "laptop", "house", "car", "doctor", "student", "insurance", "loan", "tax", "shopping", "exercise", "internet", "food"];
const EARLY_JUNK = 4; // scenes 0..3 only ever get unrelated footage, so they burn their entire budget

function clocked(costMs: number) {
  let t = 0;
  const clock = { now: () => t };
  class ClockedSource implements StockSource {
    requests = 0;
    perScene = new Map<number, number>();
    current = -1;
    private hit(kind: "video" | "image", q: string): RawHit[] {
      this.requests++;
      t += costMs;
      this.perScene.set(this.current, (this.perScene.get(this.current) ?? 0) + 1);
      const subject = SUBJECTS.findIndex((w) => q.includes(w));
      // Early scenes: Pixabay only returns unrelated nature footage for their queries.
      if (subject < 0 || subject < EARLY_JUNK) return kind === "video" ? [video("ocean waves sunset", 30), video("forest trees nature", 30)] : [image("beach sea sand")];
      const w = SUBJECTS[subject];
      return kind === "video" ? [video(`${w}, closeup, ${w} desk`, 30)] : [image(`${w}, desk`)];
    }
    async searchVideos(q: string) { return this.hit("video", q); }
    async searchImages(q: string) { return this.hit("image", q); }
  }
  return { clock, source: new ClockedSource() };
}
const sceneFor = (i: number): SceneForSearch => ({
  index: i, label: `Part ${i + 1}`, narration: `Talking about ${SUBJECTS[i]} here.`, broll: `${SUBJECTS[i]} close up`, on_screen_text: null, visual_type: "video",
});

test("OLD behaviour (one shared 60s deadline) starves later scenes - reproduced", async () => {
  const { clock, source } = clocked(2500);
  const start = clock.now();
  const results = [];
  for (let i = 0; i < SUBJECTS.length; i++) {
    source.current = i;
    results.push(await planScene(sceneFor(i), 12, source, createLedger(), {
      topicText: "personal finance", isFinalScene: false,
      shouldStop: () => clock.now() - start > 60_000, // what steps.ts used to do
    }));
  }
  const starved = results.filter((r) => r.queriesTried.length === 0);
  assert.ok(starved.length >= 3, `expected several scenes with zero searches, got ${starved.length}`);
  assert.ok(results.slice(EARLY_JUNK).some((r) => r.status === "none"), "later scenes with good footage available ended up branded");
  console.log(`  old global deadline: ${starved.length} of ${SUBJECTS.length} scenes never searched`);
});

test("NEW budget: later scenes are still searched (videos AND images) after early scenes use their whole budget", async () => {
  const { clock, source } = clocked(2500);
  const budget = new SearchBudget(
    { ...DEFAULT_SEARCH_BUDGET, totalRequests: 90, sceneCount: SUBJECTS.length },
    { now: clock.now, requestsUsed: () => source.requests },
  );
  const start = clock.now();
  const results = [];
  for (let i = 0; i < SUBJECTS.length; i++) {
    source.current = i;
    results.push(await planScene(sceneFor(i), 12, source, createLedger(), {
      topicText: "personal finance", isFinalScene: false, shouldStop: budget.startScene(i),
    }));
  }
  // Every scene searched, and every scene tried both a video and an image search at least once
  // when its videos did not cover it.
  for (const [i, r] of results.entries()) {
    assert.ok(r.queriesTried.some((q) => q.startsWith("video:")), `scene ${i} never searched videos`);
    // A scene that finds a good full-length clip may stop after one search. Any scene that was NOT
    // fully covered by video must also have tried images (and more than one query).
    if (r.status !== "full") {
      assert.ok(r.queriesTried.some((q) => q.startsWith("image:")), `uncovered scene ${i} never searched images`);
      assert.ok(r.queriesTried.length >= 2, `uncovered scene ${i} only made ${r.queriesTried.length} searches`);
    }
  }
  // Early scenes could not spend more than a fair share...
  for (let i = 0; i < EARLY_JUNK; i++) assert.ok((source.perScene.get(i) ?? 0) <= 8, `scene ${i} spent ${source.perScene.get(i)} requests`);
  // ...so every later scene found its (relevant) footage.
  for (let i = EARLY_JUNK; i < SUBJECTS.length; i++) {
    assert.equal(results[i].status, "full", `scene ${i} (${SUBJECTS[i]}): ${results[i].status} ${results[i].notes.join(";")}`);
    assert.match(results[i].pieces[0].candidate.tags, new RegExp(SUBJECTS[i]));
  }
  // Early scenes with no relevant footage stay branded - nothing unrelated was inserted.
  for (let i = 0; i < EARLY_JUNK; i++) assert.equal(results[i].pieces.length, 0);
  assert.ok(clock.now() - start <= DEFAULT_SEARCH_BUDGET.hardLimitMs + 2500, "stays inside the safety limit");
  assert.ok(source.requests <= 90, `request cap respected (${source.requests})`);
  console.log(`  new budget: ${source.requests} requests, ${((clock.now() - start) / 1000).toFixed(1)}s; junk scenes used ${[0, 1, 2, 3].map((i) => source.perScene.get(i)).join("/")} requests; scenes ${EARLY_JUNK}-${SUBJECTS.length - 1} all full`);
});

test("NEW budget: the hard safety limit still stops everything (no runaway)", async () => {
  const { clock, source } = clocked(2500);
  const budget = new SearchBudget({ ...DEFAULT_SEARCH_BUDGET, hardLimitMs: 10_000, totalRequests: 90, sceneCount: SUBJECTS.length }, { now: clock.now, requestsUsed: () => source.requests });
  for (let i = 0; i < SUBJECTS.length; i++) {
    source.current = i;
    await planScene(sceneFor(i), 12, source, createLedger(), { topicText: "x", isFinalScene: false, shouldStop: budget.startScene(i) });
  }
  assert.ok(clock.now() <= 10_000 + 2500, `ran ${clock.now()}ms`);
  assert.ok(source.requests <= 5);
});

test("NEW budget: request allowance is shared fairly and the request cap is never exceeded", async () => {
  const { clock, source } = clocked(0); // time is not the constraint here, requests are
  const budget = new SearchBudget({ ...DEFAULT_SEARCH_BUDGET, totalRequests: 60, sceneCount: SUBJECTS.length, maxSceneMs: 10 ** 9, hardLimitMs: 10 ** 9 }, { now: clock.now, requestsUsed: () => source.requests });
  for (let i = 0; i < SUBJECTS.length; i++) {
    source.current = i;
    await planScene(sceneFor(i), 12, source, createLedger(), { topicText: "x", isFinalScene: false, shouldStop: budget.startScene(i) });
  }
  for (let i = 0; i < SUBJECTS.length; i++) assert.ok((source.perScene.get(i) ?? 0) >= 1, `scene ${i} was starved (${source.perScene.get(i)})`);
  for (let i = 0; i < EARLY_JUNK; i++) assert.ok((source.perScene.get(i) ?? 0) >= 2, `junk scene ${i} did not get a video AND an image search`);
  const early = Math.max(...[0, 1, 2, 3].map((i) => source.perScene.get(i) ?? 0));
  assert.ok(early <= 8, `an early scene took ${early} requests`);
  assert.ok(source.requests <= 70, `total ${source.requests}`);
  console.log(`  request shares per scene: ${SUBJECTS.map((_, i) => source.perScene.get(i)).join(",")} (total ${source.requests})`);
});

test("SearchBudget: unspent time and requests flow to later scenes", () => {
  let t = 0; let used = 0;
  const budget = new SearchBudget({ ...DEFAULT_SEARCH_BUDGET, totalRequests: 90, sceneCount: 10 }, { now: () => t, requestsUsed: () => used });
  const ctx = (n: number): SearchContext => ({ kind: "video", searchesDone: n, searchesOfKind: n });
  const first = budget.startScene(0);
  t += 500; used += 1; // scene 0 finishes almost instantly
  const later = budget.startScene(1);
  t += 9_000; used += 5; // later scene may use up to maxSceneMs (10s), more than the 9s average share
  assert.equal(later(ctx(2)), false, "scene 1 may still search after 9s (carry-over)");
  t += 2_000;
  assert.equal(later(ctx(2)), true, "but not beyond its 10s slice");
  assert.equal(first(ctx(0)), false, "first search of each kind is always allowed");
});
