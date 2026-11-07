/**
 * Pixabay search client used by the stock-media planner.
 *
 * - Caches identical queries for the lifetime of one video (the same query is never billed twice).
 * - Stays under Pixabay's default limit (100 requests / 60 s per key) with a sliding window, and
 *   honours 429 responses (X-RateLimit-Reset) with a bounded wait.
 * - Has a hard per-video request budget so a bad prompt can never exhaust the key.
 * - Stops searching after repeated hard failures (for example an invalid API key) instead of
 *   repeating the same failing request for every scene.
 */
import type { RawHit, StockSource } from "./stock.ts";

export type PixabayOptions = {
  maxRequests?: number;
  windowLimit?: number;
  windowMs?: number;
  /** Longest we are willing to wait for the rate-limit window before giving up on searching. */
  maxWaitMs?: number;
  perPage?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class PixabayClient implements StockSource {
  private cache = new Map<string, Promise<RawHit[]>>();
  private stamps: number[] = [];
  private hardFailures = 0;
  requests = 0;
  disabledReason: string | null = null;

  readonly maxRequests: number;
  private readonly windowLimit: number;
  private readonly windowMs: number;
  private readonly maxWaitMs: number;
  private readonly perPage: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private apiKey: string, opts: PixabayOptions = {}) {
    this.maxRequests = opts.maxRequests ?? 90;
    this.windowLimit = opts.windowLimit ?? 90;
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxWaitMs = opts.maxWaitMs ?? 20_000;
    this.perPage = opts.perPage ?? 20;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  searchVideos(query: string): Promise<RawHit[]> {
    return this.cached("video", query);
  }

  searchImages(query: string): Promise<RawHit[]> {
    return this.cached("image", query);
  }

  private cached(kind: "video" | "image", query: string): Promise<RawHit[]> {
    const key = `${kind}|${query.trim().toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const pending = this.request(kind, query.trim().slice(0, 100));
    this.cache.set(key, pending);
    return pending;
  }

  private async throttle(): Promise<boolean> {
    const cutoff = this.now() - this.windowMs;
    this.stamps = this.stamps.filter((t) => t > cutoff);
    if (this.stamps.length < this.windowLimit) return true;
    const wait = this.stamps[0] + this.windowMs - this.now() + 250;
    if (wait > this.maxWaitMs) return false;
    await this.sleep(wait);
    return this.throttle();
  }

  private async request(kind: "video" | "image", query: string): Promise<RawHit[]> {
    if (this.disabledReason) return [];
    if (this.requests >= this.maxRequests) {
      this.disabledReason = "per-video Pixabay request budget reached";
      return [];
    }
    if (!(await this.throttle())) {
      this.disabledReason = "Pixabay rate limit window is full";
      return [];
    }

    const url = new URL(kind === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/");
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(this.perPage));
    url.searchParams.set("safesearch", "true");
    if (kind === "video") {
      url.searchParams.set("min_width", "1280");
    } else {
      url.searchParams.set("image_type", "photo");
      url.searchParams.set("orientation", "horizontal");
      url.searchParams.set("min_width", "1280");
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      this.requests++;
      this.stamps.push(this.now());
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), { signal: AbortSignal.timeout(20_000) });
      } catch (error) {
        this.noteFailure();
        throw new Error(`Pixabay ${kind} search network error: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (res.status === 429 && attempt === 0) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const waitMs = Math.min(this.maxWaitMs, (Number.isFinite(reset) && reset > 0 ? reset : 10) * 1000 + 250);
        await res.body?.cancel();
        await this.sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 120);
        this.noteFailure();
        throw new Error(`Pixabay ${kind} search failed (${res.status}) ${detail}`.trim());
      }
      this.hardFailures = 0;
      const payload = await res.json();
      return Array.isArray(payload?.hits) ? (payload.hits as RawHit[]) : [];
    }
    this.noteFailure();
    throw new Error(`Pixabay ${kind} search is rate limited`);
  }

  private noteFailure(): void {
    this.hardFailures++;
    if (this.hardFailures >= 3) this.disabledReason = "Pixabay failed three times in a row (check the API key)";
  }
}
