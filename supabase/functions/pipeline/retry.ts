/**
 * Reliability helpers shared by every provider call.
 *
 * Two layers of retry exist on purpose:
 *  1. fetchWithRetry  - short in-request retries (seconds) for blips: timeouts, 429, 5xx.
 *  2. step-level backoff (see steps.ts) - if a step still fails, the video is rescheduled with a
 *     longer exponential delay (1 min, 2 min, 4 min ...) and picked up by a later scheduler tick.
 *
 * Edge Functions are short-lived serverless workers, so a long-running node-cron process is not an
 * option here. pg_cron (every minute) + the persisted `next_attempt_at` column play that role.
 */

export class HttpError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(label: string, status: number, detail: string, retryAfterMs: number | null = null) {
    super(`${label} failed (${status}): ${detail}`);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Configuration or data problems that retrying cannot fix. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof PermanentError) return false;
  if (err instanceof HttpError) return isRetryableStatus(err.status);
  return true; // network errors, timeouts, malformed model output
}

export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.5 + Math.random() / 2)); // jitter avoids synchronized retries
}

function parseRetryAfter(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type RetryOptions = {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const { retries = 2, timeoutMs = 60_000, baseDelayMs = 1000, maxDelayMs = 8000 } = opts;
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!isRetryableStatus(res.status)) return res;
      lastResponse = res;
      lastError = null;
      if (attempt <= retries) {
        const wait = Math.min(maxDelayMs, parseRetryAfter(res) ?? backoffDelayMs(attempt, baseDelayMs, maxDelayMs));
        await res.body?.cancel();
        await sleep(wait);
      }
    } catch (err) {
      lastError = err;
      lastResponse = null;
      if (attempt <= retries) await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs));
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("Network request failed");
}

export async function assertOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const detail = (await res.text()).slice(0, 300);
  throw new HttpError(label, res.status, detail, parseRetryAfter(res));
}

/** Delay before the next step-level attempt: 1m, 2m, 4m, 8m ... capped at 30 minutes. */
export function stepBackoffMs(attempt: number): number {
  return backoffDelayMs(attempt, 60_000, 30 * 60_000);
}
