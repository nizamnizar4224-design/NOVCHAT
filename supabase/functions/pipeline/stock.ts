/**
 * Stock-media relevance, de-duplication and duration planning.
 *
 * This module is intentionally free of Deno / network / Supabase APIs. The Pixabay HTTP layer is
 * injected through the `StockSource` interface (see pixabay.ts) so every decision here can be unit
 * tested with plain Node.
 *
 * Pipeline per scene:
 *   1. buildSearchPlan()  - several short Pixabay-friendly queries + weighted subject "concepts".
 *   2. scoreHit()         - every returned hit is scored against the concepts. Hits whose tags do not
 *                           contain the scene's real subject are rejected (no "first result wins").
 *   3. planScene()        - picks de-duplicated assets and splits the scene duration across them
 *                           without stretching or looping any clip.
 */

export type MediaKind = "video" | "image";

export type SceneForSearch = {
  index: number;
  label: string;
  narration: string;
  broll: string;
  on_screen_text: string | null;
  visual_type?: MediaKind;
  /** Optional, written by the script model: short Pixabay queries, most specific first. */
  search_queries?: string[];
  /** Optional, written by the script model: nouns a matching clip must be about. */
  subject_keywords?: string[];
};

export type RawHit = { [key: string]: unknown };

export interface StockSource {
  searchVideos(query: string): Promise<RawHit[]>;
  searchImages(query: string): Promise<RawHit[]>;
}

export type Concept = {
  term: string;
  stem: string;
  variants: Set<string>;
  weight: number;
  /** Generic words (person, hand, business...) can support a match but never anchor one. */
  generic: boolean;
};

export type Candidate = {
  kind: MediaKind;
  id: string;
  key: string;
  tags: string;
  tagStems: string[];
  pageUrl: string | null;
  downloadUrl: string;
  /** Native duration in seconds (videos only). */
  duration: number | null;
  width: number | null;
  height: number | null;
  score: number;
  coverage: number;
  tier: "scene" | "topic";
  query: string;
};

export type PlannedPiece = {
  candidate: Candidate;
  offsetSec: number;
  durationSec: number;
  trimStartSec: number;
};

export type ScenePlan = {
  sceneIndex: number;
  requiredSec: number;
  pieces: PlannedPiece[];
  coveredSec: number;
  status: "full" | "partial" | "none";
  queriesTried: string[];
  notes: string[];
};

export type Ledger = { used: Set<string>; tagSets: string[][] };
export const createLedger = (): Ledger => ({ used: new Set(), tagSets: [] });

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------
export const TUNING = {
  /** A scene candidate must reach this relevance score (0-100+) after penalties. */
  minSceneScore: 42,
  /** Topic-level (last resort) candidates need to match the overall video topic with this score. */
  minTopicScore: 34,
  /** A video shorter than this (usable seconds) is not worth a cut. */
  minVideoPieceSec: 2.5,
  /** Safety margin removed from every clip's native duration so we never run past its last frame. */
  videoTailMarginSec: 0.15,
  /** Longest time one still image should be on screen before another relevant image takes over. */
  imageMaxSec: 5,
  maxVideoPieces: 4,
  maxImagePieces: 4,
  maxVideoQueries: 5,
  maxImageQueries: 5,
  maxTopicQueries: 2,
  /** Gaps shorter than this are ignored (sub-frame rounding). */
  gapToleranceSec: 0.15,
  /** A slightly lower-scored clip that covers the whole scene beats stitching several clips. */
  singleClipScoreSlack: 12,
  /** Stop searching videos once coverage is complete and the best clip scores at least this much. */
  goodEnoughScore: 50,
  /** Tag-set similarity above which two assets count as "the same shot". */
  nearDuplicateJaccard: 0.8,
} as const;

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------
const STOP = new Set((
  "the and with for from into onto about over under across between through during each every some many more most very just " +
  "this that these those there then than also their your you are was were been being have has had will would could should can may might must " +
  "its our out off but not all any who what when where why how which one two three first next here now new way get gets make makes need needs " +
  "start starts let lets see look looks looking take takes going goes come comes does doing done say says said thing things lot really actually " +
  "simple easy best top good great big small long short high low right left back front side around per own other another same different " +
  "become becomes means mean like likes using use used while upon your them they him her his she its too " +
  "open opens opening opened check checks checking reviewing review reviews enter enters entering display displays displaying appear appears " +
  "appearing move moves moving recap cta intro outro conclusion summary hook opening question questions teaser"
).split(/\s+/));

/** Words that describe the *shot* rather than the subject. */
const SHOT_FILLER = new Set((
  "showing shows show shot shots footage video videos clip clips scene scenes stock closeup close wide view views image images picture " +
  "pictures photo photos animation animated background backgrounds cinematic slow motion time lapse timelapse overlay text screen"
).split(/\s+/));

/** Calls to action: never searched for in the closing scene (the editor draws its own icons). */
const CTA_WORDS = new Set((
  "subscribe subscribing subscription like likes bell notification notifications button channel youtube share comment comments"
).split(/\s+/));

const GENERIC_NOUNS = new Set((
  "person people man men woman women hand hands face group team young old happy smiling sitting standing walking holding " +
  "business businessman businesswoman work working worker indian india professional lifestyle concept idea"
).split(/\s+/));

/** Tight synonym groups: members are interchangeable for MATCHING a tag. */
const SYNONYM_GROUPS: string[][] = [
  ["phone", "smartphone", "mobile", "cellphone", "iphone", "android", "handset"],
  ["bank", "banking", "atm", "banker"],
  ["money", "cash", "currency", "rupee", "dollar", "banknote", "coin"],
  ["invest", "investment", "investor", "investing", "portfolio"],
  ["stock", "equity", "trading", "trader", "stockmarket"],
  ["calculator", "calculation", "calculate", "calculating", "calc"],
  ["chart", "graph", "diagram", "statistics", "analytics"],
  ["growth", "increase", "rising", "profit", "gain"],
  ["laptop", "notebook", "computer", "pc"],
  ["house", "home", "property", "apartment", "realestate"],
  ["car", "automobile", "vehicle"],
  ["doctor", "physician", "medic"],
  ["student", "pupil", "learner"],
  ["study", "studying", "learning", "education"],
  ["meeting", "conference", "discussion", "boardroom"],
  ["card", "creditcard", "debitcard"],
  ["document", "paperwork", "statement", "contract"],
  ["tax", "taxation", "gst"],
  ["insurance", "policy"],
  ["loan", "mortgage", "debt", "emi"],
  ["save", "saving", "savings", "piggybank", "piggy"],
  ["shopping", "shop", "store", "retail", "mall"],
  ["food", "meal", "dish", "cooking", "cuisine"],
  ["exercise", "workout", "fitness", "gym"],
  ["health", "healthy", "wellness"],
  ["social", "socialmedia", "facebook", "instagram", "twitter"],
  ["internet", "online", "web", "website"],
  ["app", "application"],
];

/** Related (not equivalent) ideas, used ONLY to generate extra search queries. */
const QUERY_EXPANSIONS: Record<string, string[]> = {
  phone: ["smartphone", "mobile phone", "person using smartphone"],
  bank: ["banking app", "bank customer", "atm"],
  invest: ["investor", "stock market", "financial planning"],
  fund: ["investment", "finance", "financial planning"],
  mutual: ["investment", "finance"],
  calculator: ["calculator", "financial calculation", "accounting"],
  return: ["growth chart", "profit graph", "investment growth"],
  growth: ["growth chart", "profit graph"],
  money: ["money", "cash", "coins"],
  save: ["piggy bank", "savings"],
  loan: ["loan", "mortgage", "debt"],
  tax: ["tax", "accounting", "calculator"],
  insurance: ["insurance", "family protection"],
  statement: ["bank statement", "financial document"],
  document: ["paperwork", "documents desk"],
  app: ["mobile app", "smartphone app"],
  stock: ["stock market", "trading screen", "stock chart"],
  student: ["student studying", "classroom"],
  health: ["healthy lifestyle", "doctor"],
  laptop: ["laptop", "working on laptop"],
};

const OFFTOPIC_NATURE = new Set((
  "ocean sea beach wave waves forest flower flowers sunset sunrise storm cloud clouds sky waterfall mountain mountains landscape nature lake river " +
  "tree trees leaf leaves rain wildlife bird birds butterfly snow field grass meadow island desert animal animals cat dog horse insect fish"
).split(/\s+/));
const OFFTOPIC_ABSTRACT = new Set((
  "abstract background texture pattern wallpaper particles bokeh loop seamless gradient glitter fireworks"
).split(/\s+/));
const OFFTOPIC_DECORATIVE = new Set((
  "watch wristwatch clock hourglass calendar fireworks balloon balloons celebration party birthday christmas newyear"
).split(/\s+/));
const OFFTOPIC_ANIMALS = new Set((
  "pig piggy piggybank cow bull bear lion tiger dog cat horse bird birds"
).split(/\s+/));

const synonymIndex = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  const stems = new Set(group.map((word) => stem(word)));
  for (const word of group) {
    const key = stem(word);
    const existing = synonymIndex.get(key) ?? new Set<string>();
    for (const member of stems) if (member !== key) existing.add(member);
    synonymIndex.set(key, existing);
  }
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------
export function stem(word: string): string {
  let s = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && /(ches|shes|sses|xes)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us")) s = s.slice(0, -1);
  if (s.length > 6 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 5 && s.endsWith("ed")) s = s.slice(0, -2);
  return s;
}

function rawTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

/** Subject-bearing tokens in reading order (original word forms), de-duplicated by stem. */
export function contentTokens(text: string, dropCta = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of rawTokens(text)) {
    if (STOP.has(token) || SHOT_FILLER.has(token)) continue;
    if (dropCta && CTA_WORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    const key = stem(token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

/** First subject-bearing word of each related-idea query ("stock market" -> "stock"). */
function expansionHeads(key: string): string[] {
  const heads: string[] = [];
  for (const phrase of QUERY_EXPANSIONS[key] ?? []) {
    const head = contentTokens(phrase).find((t) => !GENERIC_NOUNS.has(t));
    if (head) heads.push(stem(head));
  }
  return heads;
}

function makeConcept(term: string, weight: number): Concept {
  const s = stem(term);
  const variants = new Set<string>(synonymIndex.get(s) ?? []);
  // A query built from a related idea must be able to match its own results.
  for (const head of expansionHeads(s)) if (head !== s) variants.add(head);
  return {
    term,
    stem: s,
    variants,
    weight,
    generic: GENERIC_NOUNS.has(term.toLowerCase()) || GENERIC_NOUNS.has(s),
  };
}

function cleanQuery(query: string, dropCta: boolean): string | null {
  const tokens = rawTokens(query).filter((t) => !STOP.has(t) && !(dropCta && CTA_WORDS.has(t)));
  const words = tokens.slice(0, 4);
  if (words.length === 0) return null;
  return words.join(" ").slice(0, 60);
}

// ---------------------------------------------------------------------------------------------
// Search plan
// ---------------------------------------------------------------------------------------------
export type SearchPlan = {
  queries: string[];
  topicQueries: string[];
  concepts: Concept[];
  topicConcepts: Concept[];
  sceneTokens: Set<string>;
};

export function buildSearchPlan(scene: SceneForSearch, topicText: string, isFinalScene: boolean): SearchPlan {
  const dropCta = isFinalScene;
  const concepts = new Map<string, Concept>();
  const add = (term: string, weight: number) => {
    const key = stem(term);
    if (!key || STOP.has(term) || SHOT_FILLER.has(term)) return;
    const existing = concepts.get(key);
    if (existing) {
      if (weight > existing.weight && !existing.generic) existing.weight = weight;
      return;
    }
    const concept = makeConcept(term, weight);
    if (concept.generic) concept.weight = Math.min(concept.weight, 0.35);
    concepts.set(key, concept);
  };

  for (const keyword of scene.subject_keywords ?? []) {
    for (const token of contentTokens(keyword, dropCta)) add(token, 1);
  }
  const brollTokens = contentTokens(scene.broll, dropCta);
  for (const token of brollTokens) add(token, 0.9);
  const labelTokens = contentTokens(`${scene.label} ${scene.on_screen_text ?? ""}`, dropCta);
  for (const token of labelTokens) add(token, 0.6);
  const narrationTokens = contentTokens(scene.narration, dropCta);
  for (const token of narrationTokens.slice(0, 6)) add(token, 0.4);

  const topicTokens = contentTokens(topicText);
  const topicConcepts = new Map<string, Concept>();
  for (const token of topicTokens.slice(0, 4)) {
    const concept = makeConcept(token, 0.8);
    if (!concept.generic) topicConcepts.set(concept.stem, concept);
  }

  // The closing scene is mostly a call to action. If nothing subject-bearing is left, rely on the topic.
  if (isFinalScene && [...concepts.values()].every((c) => c.generic)) {
    for (const concept of topicConcepts.values()) concepts.set(concept.stem, { ...concept, weight: 0.9 });
  }

  const ranked = [...concepts.values()].sort((a, b) => b.weight - a.weight);

  // --- queries -------------------------------------------------------------------------------
  // Pixabay ANDs every word, so short subject-first queries work far better than a sentence.
  const queries: string[] = [];
  const push = (q: string | null | undefined) => {
    if (!q) return;
    const value = q.trim().toLowerCase();
    if (value.length < 3) return;
    if (!queries.includes(value)) queries.push(value);
  };
  const isGenericToken = (t: string) => GENERIC_NOUNS.has(t) || GENERIC_NOUNS.has(stem(t));
  /** Drops generic words and words that are synonyms of an earlier word (smartphone + mobile). */
  const distinctSubject = (tokens: string[]): string[] => {
    const subject = tokens.filter((t) => !isGenericToken(t));
    const out: string[] = [];
    for (const token of subject.length > 0 ? subject : tokens) {
      const concept = makeConcept(token, 1);
      const redundant = out.some((prev) => {
        const p = makeConcept(prev, 1);
        return p.stem === concept.stem || p.variants.has(concept.stem) || concept.variants.has(p.stem);
      });
      if (!redundant) out.push(token);
    }
    return out;
  };
  const subject = distinctSubject(brollTokens);

  for (const q of scene.search_queries ?? []) push(cleanQuery(q, dropCta));
  push(subject.slice(0, 3).join(" "));
  push(subject.slice(0, 2).join(" "));
  push(subject[0]);
  const strong = ranked.filter((c) => !c.generic);
  for (const concept of strong.slice(0, 3)) {
    for (const expansion of QUERY_EXPANSIONS[concept.stem] ?? []) push(expansion);
  }
  for (const concept of strong.slice(0, 3)) {
    const synonym = [...(synonymIndex.get(concept.stem) ?? [])][0];
    if (synonym) push(synonym);
  }
  for (let i = 0; i + 1 < Math.min(subject.length, 5); i++) push(`${subject[i]} ${subject[i + 1]}`);
  for (const concept of strong.slice(0, 2)) push(concept.term);
  push(distinctSubject(labelTokens).slice(0, 2).join(" "));

  // Keep the video's named topic in a compound query without losing the current
  // narration beat's subject (e.g. UPI + PIN safety, not generic finance footage).
  const topicHead = distinctSubject(topicTokens).slice(0, 1)[0];
  const sceneHead = subject.slice(0, 2);
  if (topicHead && sceneHead.length) push([topicHead, ...sceneHead].slice(0, 4).join(" "));
  if (topicHead && sceneHead.length > 1) push([topicHead, sceneHead[sceneHead.length - 1]].join(" "));

  const cappedQueries = queries.slice(0, 8);

  const topicQueries: string[] = [];
  const pushTopic = (q: string) => {
    const value = q.trim().toLowerCase();
    if (value.length >= 3 && !cappedQueries.includes(value) && !topicQueries.includes(value)) topicQueries.push(value);
  };
  pushTopic(topicTokens.slice(0, 2).join(" "));
  for (const concept of [...topicConcepts.values()].slice(0, 2)) {
    for (const expansion of QUERY_EXPANSIONS[concept.stem] ?? []) pushTopic(expansion);
    pushTopic(concept.term);
  }

  // Only scene-local terms may exempt a tag from off-topic penalties. The overall video
  // topic must not make unrelated imagery look relevant to an individual narration beat.
  const sceneTokens = new Set<string>(
    rawTokens(`${scene.broll} ${scene.label} ${scene.on_screen_text ?? ""} ${scene.narration}`).map(stem),
  );

  return {
    queries: cappedQueries,
    topicQueries: topicQueries.slice(0, 4),
    concepts: ranked.slice(0, 8),
    topicConcepts: [...topicConcepts.values()],
    sceneTokens,
  };
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------
function matchValue(concept: Concept, tagStem: string): number {
  if (tagStem === concept.stem) return 1;
  if (concept.variants.has(tagStem)) return 0.8;
  const [short, long] = tagStem.length <= concept.stem.length ? [tagStem, concept.stem] : [concept.stem, tagStem];
  // Prefix relation only for reasonably long, similar-length words (invest/investor, never app/apple).
  if (short.length >= 4 && long.startsWith(short) && short.length / long.length >= 0.75) return 0.65;
  return 0;
}

function slugTokens(pageUrl: unknown): string[] {
  if (typeof pageUrl !== "string") return [];
  const match = pageUrl.match(/pixabay\.com\/(?:videos|photos|images|illustrations)\/([^/]+?)(?:-\d+)?\/?$/i);
  return match ? rawTokens(match[1].replace(/-/g, " ")) : [];
}

export type Score = { score: number; coverage: number; anchored: boolean; penalties: string[] };

export function scoreHit(
  concepts: Concept[],
  hit: RawHit,
  rank: number,
  sceneTokens: Set<string>,
): Score {
  const tags = typeof hit.tags === "string" ? hit.tags : "";
  const tagStems = new Set(rawTokens(tags).map(stem));
  const slugStems = new Set(slugTokens(hit.pageURL).map(stem));

  const top = concepts.slice(0, 5);
  const denominator = top.reduce((sum, c) => sum + c.weight, 0);
  if (top.length === 0 || denominator === 0) return { score: 0, coverage: 0, anchored: false, penalties: ["no-concepts"] };

  let matched = 0;
  let anchored = false;
  let matchedConcepts = 0;
  let strongMatches = 0;
  for (const concept of top) {
    let best = 0;
    for (const t of tagStems) best = Math.max(best, matchValue(concept, t));
    if (best < 1) for (const t of slugStems) best = Math.max(best, matchValue(concept, t) * 0.7);
    matched += concept.weight * best;
    if (best >= 0.65) matchedConcepts++;
    if (!concept.generic && concept.weight >= 0.8 && best >= 0.65) {
      anchored = true;
      strongMatches++;
    }
  }
  const coverage = matched / denominator;

  const penalties: string[] = [];
  let penalty = 0;
  const hitsGroup = (group: Set<string>) => [...tagStems].some((t) => group.has(t) && !sceneTokens.has(t));
  if (hitsGroup(OFFTOPIC_NATURE)) { penalty += 30; penalties.push("nature-tags"); }
  if (hitsGroup(OFFTOPIC_ABSTRACT)) { penalty += 15; penalties.push("abstract-tags"); }
  if (hitsGroup(OFFTOPIC_DECORATIVE)) { penalty += 22; penalties.push("decorative-object-tags"); }
  if (hitsGroup(OFFTOPIC_ANIMALS)) { penalty += 18; penalties.push("unrequested-animal-tags"); }

  const rankBonus = Math.max(0, 6 - rank * 0.5);
  const popularity = Math.min(3, Math.log10(1 + Number(hit.likes ?? 0) + Number(hit.downloads ?? 0) / 10) );
  // A broad topic match is not enough: require the actual scene subject to appear in tags/slug.
  // Require at least one strong scene-specific subject anchor, but do not require every
  // supporting noun to appear in a stock tag (e.g. calculator + desk).
  const score = coverage * 100 - penalty + rankBonus + popularity;
  return { score: Math.round(score * 10) / 10, coverage: Math.round(coverage * 1000) / 1000, anchored, penalties };
}

export function toCandidate(
  kind: MediaKind,
  hit: RawHit,
  scored: Score,
  query: string,
  tier: "scene" | "topic",
): Candidate | null {
  const id = String(hit.id ?? "");
  if (!id) return null;
  const tags = typeof hit.tags === "string" ? hit.tags : "";
  const pageUrl = typeof hit.pageURL === "string" ? hit.pageURL : null;

  if (kind === "video") {
    const files = (hit.videos ?? {}) as Record<string, { url?: string; width?: number; height?: number }>;
    // Medium (the existing behaviour) first; never pull the large 4K rendition.
    const file = [files.medium, files.small].find((f) => typeof f?.url === "string" && f.url.trim() !== "");
    const duration = Number(hit.duration);
    if (!file?.url || !Number.isFinite(duration) || duration <= 0) return null;
    const width = Number(file.width) || null;
    const height = Number(file.height) || null;
    // The output is 16:9. Portrait footage would be heavily cropped by "cover", so reject it.
    if (width && height && width / height < 1.2) return null;
    return { kind, id, key: `video:${id}`, tags, tagStems: rawTokens(tags).map(stem), pageUrl, downloadUrl: file.url, duration, width, height,
      score: scored.score, coverage: scored.coverage, tier, query };
  }

  const url = [hit.largeImageURL, hit.webformatURL].find((u) => typeof u === "string" && u.trim() !== "") as string | undefined;
  const width = Number(hit.imageWidth) || null;
  const height = Number(hit.imageHeight) || null;
  if (!url) return null;
  if (width && height && width / height < 1.2) return null;
  if (width && width < 1000) return null;
  return { kind, id, key: `image:${id}`, tags, tagStems: rawTokens(tags).map(stem), pageUrl, downloadUrl: url, duration: null, width, height,
    score: scored.score, coverage: scored.coverage, tier, query };
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const x of sa) if (sb.has(x)) shared++;
  return shared / (sa.size + sb.size - shared);
}

// ---------------------------------------------------------------------------------------------
// Duration planning
// ---------------------------------------------------------------------------------------------
const usableSeconds = (c: Candidate) => Math.max(0, (c.duration ?? 0) - TUNING.videoTailMarginSec);

/** Total seconds the best de-duplicated videos could cover (stitched, at most maxVideoPieces). */
function stitchedCoverage(videos: Candidate[], required: number): number {
  let total = 0;
  for (const v of videos.slice(0, TUNING.maxVideoPieces)) {
    total += usableSeconds(v);
    if (total >= required) break;
  }
  return total;
}

export function assemblePieces(
  requiredSec: number,
  videosIn: Candidate[],
  imagesIn: Candidate[],
): { pieces: PlannedPiece[]; coveredSec: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const videos = videosIn.filter((v) => usableSeconds(v) >= TUNING.minVideoPieceSec).sort((a, b) => b.score - a.score);
  const images = [...imagesIn].sort((a, b) => b.score - a.score);
  const chosen: { candidate: Candidate; durationSec: number }[] = [];
  let covered = 0;

  // 1) One clip that covers the whole scene is the cleanest result, if it is nearly as relevant as the best.
  const best = videos[0];
  if (best) {
    const single = usableSeconds(best) >= requiredSec
      ? best
      : videos.find((v) => usableSeconds(v) >= requiredSec && v.score >= best.score - TUNING.singleClipScoreSlack);
    if (single) {
      chosen.push({ candidate: single, durationSec: requiredSec });
      covered = requiredSec;
    } else {
      // 2) Stitch several different relevant clips, each at native speed, no looping.
      for (const v of videos) {
        if (covered >= requiredSec - TUNING.gapToleranceSec || chosen.length >= TUNING.maxVideoPieces) break;
        const take = Math.min(usableSeconds(v), requiredSec - covered);
        chosen.push({ candidate: v, durationSec: take });
        covered += take;
      }
    }
  }

  // 3) Fill any remaining time with relevant still images (Ken Burns zoom happens in the renderer).
  let remaining = requiredSec - covered;
  if (remaining > TUNING.gapToleranceSec && images.length > 0) {
    const count = Math.min(images.length, TUNING.maxImagePieces, Math.ceil(remaining / TUNING.imageMaxSec));
    for (let i = 0; i < count && remaining > TUNING.gapToleranceSec; i++) {
      const take = Math.min(TUNING.imageMaxSec, remaining);
      chosen.push({ candidate: images[i], durationSec: take });
      covered += take;
      remaining -= take;
    }
  }

  let cursor = 0;
  const pieces: PlannedPiece[] = chosen.map((c) => {
    const piece: PlannedPiece = {
      candidate: c.candidate,
      offsetSec: round2(cursor),
      durationSec: round2(c.durationSec),
      trimStartSec: 0,
    };
    cursor += c.durationSec;
    return piece;
  });
  return { pieces, coveredSec: round2(Math.min(requiredSec, cursor)) };
}

/** What planScene tells the budget about the search it is about to run. */
export type SearchContext = {
  kind: MediaKind;
  /** Searches already started for this scene (all kinds). */
  searchesDone: number;
  /** Searches already started for this scene of this same kind. */
  searchesOfKind: number;
};

export type SearchBudgetConfig = {
  /** Safety limit for ALL scenes together (not a per-scene deadline). */
  hardLimitMs: number;
  /** Network requests the whole video may spend (mirror of the Pixabay client's cap). */
  totalRequests: number;
  sceneCount: number;
  /** A scene's time share is clamped to [minSceneMs, maxSceneMs]. */
  minSceneMs: number;
  maxSceneMs: number;
  /** A scene's request allowance is never lower than this. */
  minSceneRequests: number;
};

export const DEFAULT_SEARCH_BUDGET = {
  hardLimitMs: 90_000,
  minSceneMs: 4_000,
  maxSceneMs: 10_000,
  minSceneRequests: 4,
} as const;

/**
 * Fair-share search budget.
 *
 * Time and requests are divided across the scenes that are still waiting, so a scene can only ever
 * spend its own share (plus whatever earlier scenes left unspent). Early scenes therefore cannot
 * starve later ones. Two guarantees hold for every scene until the hard safety limit is hit:
 *   - at least one video search and at least one image search is always allowed;
 *   - a minimum request allowance.
 * Request accounting uses the client's real request counter, so cached queries cost nothing.
 */
export class SearchBudget {
  private readonly hardDeadline: number;
  constructor(
    private cfg: SearchBudgetConfig,
    private clock: { now: () => number; requestsUsed: () => number },
  ) {
    this.hardDeadline = clock.now() + cfg.hardLimitMs;
  }

  /** Call once per scene, in order. Returns that scene's shouldStop() predicate. */
  startScene(scenesFinished: number): (ctx: SearchContext) => boolean {
    const now = this.clock.now();
    const scenesLeft = Math.max(1, this.cfg.sceneCount - scenesFinished);
    const timeShare = (this.hardDeadline - now) / scenesLeft;
    const sceneMs = Math.min(this.cfg.maxSceneMs, Math.max(this.cfg.minSceneMs, timeShare));
    const sceneDeadline = Math.min(now + sceneMs, this.hardDeadline);
    const requestsLeft = Math.max(0, this.cfg.totalRequests - this.clock.requestsUsed());
    const allowance = Math.max(this.cfg.minSceneRequests, Math.ceil(requestsLeft / scenesLeft));
    const startedWith = this.clock.requestsUsed();

    return (ctx: SearchContext) => {
      if (this.clock.now() >= this.hardDeadline) return true; // safety limit for the whole video
      if (ctx.searchesOfKind === 0) return false; // every scene may try videos and images at least once
      const spent = this.clock.requestsUsed() - startedWith;
      return this.clock.now() >= sceneDeadline || spent >= allowance;
    };
  }
}

export type PlanOptions = {
  topicText: string;
  isFinalScene: boolean;
  /** Asked before every search; return true to stop searching for this scene. */
  shouldStop?: (ctx: SearchContext) => boolean;
  /** Disable broad whole-video topic fallback for tightly scoped visual beats. */
  allowTopicFallback?: boolean;
};

export async function planScene(
  scene: SceneForSearch,
  requiredSec: number,
  source: StockSource,
  ledger: Ledger,
  options: PlanOptions,
): Promise<ScenePlan> {
  const plan = buildSearchPlan(scene, options.topicText, options.isFinalScene);
  const notes: string[] = [];
  const queriesTried: string[] = [];
  const videos = new Map<string, Candidate>();
  const images = new Map<string, Candidate>();

  const consider = (kind: MediaKind, hits: RawHit[], query: string, tier: "scene" | "topic") => {
    const concepts = tier === "scene" ? plan.concepts : plan.topicConcepts;
    const minScore = tier === "scene" ? TUNING.minSceneScore : TUNING.minTopicScore;
    hits.forEach((hit, rank) => {
      const scored = scoreHit(concepts, hit, rank, plan.sceneTokens);
      if (!scored.anchored || scored.coverage < 0.38 || scored.score < minScore) return;
      const candidate = toCandidate(kind, hit, scored, query, tier);
      if (!candidate || ledger.used.has(candidate.key)) return;
      // Penalise near-identical shots already used in this video (same uploader series, same tags).
      const similar = ledger.tagSets.some((tags) => jaccard(tags, candidate.tagStems) >= TUNING.nearDuplicateJaccard);
      if (similar) candidate.score -= 8;
      if (candidate.score < minScore || candidate.coverage < 0.38) return;
      const pool = kind === "video" ? videos : images;
      const existing = pool.get(candidate.key);
      if (!existing || existing.score < candidate.score) pool.set(candidate.key, candidate);
    });
  };

  const sortedVideos = () => [...videos.values()].sort((a, b) => b.score - a.score);
  const videosCoverScene = () => stitchedCoverage(sortedVideos(), requiredSec) >= requiredSec - TUNING.gapToleranceSec;

  const done = { video: 0, image: 0 };
  const stopped = (kind: MediaKind): boolean =>
    options.shouldStop?.({ kind, searchesDone: done.video + done.image, searchesOfKind: done[kind] }) ?? false;

  const run = async (kind: MediaKind, query: string, tier: "scene" | "topic") => {
    done[kind]++;
    queriesTried.push(`${kind}:${query}`);
    try {
      const hits = kind === "video" ? await source.searchVideos(query) : await source.searchImages(query);
      consider(kind, hits, query, tier);
    } catch (error) {
      notes.push(`search failed (${kind} "${query}"): ${error instanceof Error ? error.message : String(error)}`.slice(0, 160));
    }
  };

  // Stage 1: scene-specific VIDEO queries until the scene can be covered by good clips.
  for (const query of plan.queries.slice(0, TUNING.maxVideoQueries)) {
    if (stopped("video")) { notes.push("search budget for this scene reached"); break; }
    await run("video", query, "scene");
    const top = sortedVideos()[0];
    if (top && top.score >= TUNING.goodEnoughScore && videosCoverScene()) break;
  }

  // Stage 2: scene-specific IMAGE queries if video footage does not cover the scene.
  if (!videosCoverScene()) {
    for (const query of plan.queries.slice(0, TUNING.maxImageQueries)) {
      if (stopped("image")) { notes.push("search budget for this scene reached"); break; }
      await run("image", query, "scene");
      if (images.size >= TUNING.maxImagePieces) break;
    }
  }

  // Stage 3 (last resort before a branded background): footage about the overall video topic.
  const sceneCoverage = assemblePieces(requiredSec, [...videos.values()], [...images.values()]);
  if (options.allowTopicFallback !== false && sceneCoverage.coveredSec < requiredSec - TUNING.gapToleranceSec && plan.topicConcepts.length > 0) {
    for (const query of plan.topicQueries.slice(0, TUNING.maxTopicQueries)) {
      if (stopped("video")) break;
      await run("video", query, "topic");
      if (videosCoverScene()) break;
    }
    if (!videosCoverScene() && images.size === 0 && plan.topicQueries[0] && !stopped("image")) {
      await run("image", plan.topicQueries[0], "topic");
    }
    notes.push("used topic-level fallback queries");
  }

  const { pieces, coveredSec } = assemblePieces(requiredSec, [...videos.values()], [...images.values()]);
  for (const piece of pieces) {
    ledger.used.add(piece.candidate.key);
    ledger.tagSets.push(piece.candidate.tagStems);
  }
  const status: ScenePlan["status"] = pieces.length === 0
    ? "none"
    : coveredSec >= requiredSec - TUNING.gapToleranceSec ? "full" : "partial";
  if (status !== "full") notes.push(status === "none" ? "no relevant stock media found" : `only ${coveredSec}s of ${requiredSec}s covered`);
  return { sceneIndex: scene.index, requiredSec, pieces, coveredSec, status, queriesTried, notes };
}
