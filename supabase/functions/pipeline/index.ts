import { type Channel, db, loadChannel, loadChannels, loadSettings, setActivity, type Settings } from "./db.ts";
import {
  createPackage,
  driveInFlight,
  publishNextVideo,
  requirePrepareConfig,
  requirePublishConfig,
  retryPackage,
} from "./steps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Action = "prepare" | "publish" | "tick" | "retry" | "recover";
type JobParams = { channelId?: string; packageId?: string };

const LOCK_STALE_MS = 10 * 60_000;
const WORK_BUDGET_MS = 110_000;
const DUE_WINDOW_MS = 50 * 60_000;
// A scheduled job still fires if the tick lands up to this many minutes after the scheduled time
// (for example when the previous minute's tick was skipped because another job held the lock).
const CATCH_UP_MINUTES = 30;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAction(value: unknown): value is Action {
  return value === "prepare" || value === "publish" || value === "tick" || value === "retry" || value === "recover";
}

async function isAuthorized(req: Request, action: Action): Promise<boolean> {
  if (action === "tick") {
    const provided = req.headers.get("x-cron-secret");
    if (!provided) return false;
    const { data, error } = await db.from("cron_config").select("secret").eq("id", 1).single();
    if (error) throw new Error(`Could not verify scheduler: ${error.message}`);
    return data.secret === provided;
  }

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) return false;
  const { data: owner, error: ownerError } = await db
    .from("app_owner")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (ownerError) throw new Error(`Could not verify owner: ${ownerError.message}`);
  return owner !== null;
}

async function acquireLock(): Promise<boolean> {
  const { data: current, error: readError } = await db
    .from("pipeline_state")
    .select("running, activity_updated_at")
    .eq("id", 1)
    .single();
  if (readError) throw new Error(`Could not read pipeline state: ${readError.message}`);
  if (current.running && Date.now() - Date.parse(current.activity_updated_at) < LOCK_STALE_MS) return false;

  const { data, error } = await db
    .from("pipeline_state")
    .update({ running: true, activity: "Starting", activity_updated_at: new Date().toISOString() })
    .eq("id", 1)
    .eq("running", current.running)
    .eq("activity_updated_at", current.activity_updated_at)
    .select("id");
  if (error) throw new Error(`Could not start job: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function releaseLock(patch: { last_error?: string | null }): Promise<void> {
  const { error } = await db
    .from("pipeline_state")
    .update({ ...patch, running: false, activity: "Idle", activity_updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) console.error("Could not release pipeline lock", error.message);
}

async function markRan(channelId: string, column: "last_prepare_at" | "last_publish_at"): Promise<void> {
  const stamp = new Date().toISOString();
  const { error } = await db.from("channels").update({ [column]: stamp }).eq("id", channelId);
  if (error) throw new Error(`Could not record job run: ${error.message}`);
  await db.from("pipeline_state").update({ [column]: stamp }).eq("id", 1);
}

function localMinutesOfDay(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function scheduledMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function isDue(lastRun: string | null, now: number): boolean {
  return !lastRun || now - Date.parse(lastRun) > DUE_WINDOW_MS;
}

function shouldRun(channel: Channel, time: string, lastRun: string | null, now: number): boolean {
  let current: number;
  try {
    current = localMinutesOfDay(channel.timezone, new Date(now));
  } catch {
    return false; // invalid timezone: never fire rather than fire at the wrong time
  }
  const sinceScheduled = (current - scheduledMinutes(time) + 1440) % 1440;
  return sinceScheduled < CATCH_UP_MINUTES && isDue(lastRun, now);
}

async function runPrepare(settings: Settings, channel: Channel): Promise<void> {
  requirePrepareConfig(settings, channel);
  await markRan(channel.id, "last_prepare_at");
  await setActivity(`[${channel.name}] Preparing a new video`);
  await createPackage(channel.id);
}

async function runPublish(channel: Channel): Promise<void> {
  requirePublishConfig(channel);
  await markRan(channel.id, "last_publish_at");
  await publishNextVideo(channel.id);
}

/** Checks every enabled channel against its own schedule. One channel failing never blocks the others. */
async function runScheduled(settings: Settings): Promise<string[]> {
  const errors: string[] = [];
  const now = Date.now();
  for (const channel of await loadChannels()) {
    if (!channel.enabled) continue;
    try {
      if (shouldRun(channel, channel.prepare_time, channel.last_prepare_at, now)) {
        await runPrepare(settings, channel);
      }
    } catch (err) {
      errors.push(`${channel.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      if (shouldRun(channel, channel.publish_time, channel.last_publish_at, now)) {
        await runPublish(channel);
      }
    } catch (err) {
      errors.push(`${channel.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

async function recoverStalePipeline(): Promise<{ recovered: boolean; reason: string }> {
  const { data: state, error: stateError } = await db.from("pipeline_state")
    .select("running, activity_updated_at").eq("id", 1).single();
  if (stateError) throw new Error(`Could not read pipeline state: ${stateError.message}`);
  if (!state.running) return { recovered: false, reason: "Pipeline is already idle." };
  const ageMs = Date.now() - Date.parse(state.activity_updated_at);
  if (!Number.isFinite(ageMs) || ageMs < LOCK_STALE_MS) {
    return { recovered: false, reason: "The last activity is recent; the job may still be running." };
  }
  const activeStatuses = ["queued", "voicing", "thumbnail", "render_submit", "rendering", "assembling", "uploading"];
  const { data: activePackages, error: packageError } = await db.from("video_packages")
    .select("id").in("status", activeStatuses).limit(1);
  if (packageError) throw new Error(`Could not verify active video jobs: ${packageError.message}`);
  if ((activePackages ?? []).length > 0) {
    return { recovered: false, reason: "An in-progress video record still exists. No status was changed." };
  }
  const { error: updateError } = await db.from("pipeline_state").update({
    running: false,
    activity: "Idle — previous job stopped without completing",
    activity_updated_at: new Date().toISOString(),
    last_error: "Recovered a stale pipeline lock. No in-progress video records were found.",
  }).eq("id", 1).eq("running", true).eq("activity_updated_at", state.activity_updated_at);
  if (updateError) throw new Error(`Could not recover stale pipeline state: ${updateError.message}`);
  return { recovered: true, reason: "Stale pipeline status cleared safely." };
}

async function runJob(action: Action, params: JobParams): Promise<void> {
  const deadline = Date.now() + WORK_BUDGET_MS;
  let lastError: string | null | undefined = undefined;
  try {
    const settings = await loadSettings();
    if (action === "prepare") await runPrepare(settings, await loadChannel(params.channelId!));
    if (action === "publish") await runPublish(await loadChannel(params.channelId!));
    if (action === "retry") await retryPackage(params.packageId!);
    if (action === "tick") {
      const errors = await runScheduled(settings);
      if (errors.length > 0) lastError = errors.join(" | ").slice(0, 500);
    }
    await driveInFlight(settings, deadline);
    if (action !== "tick") lastError = null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastError = message.slice(0, 500);
    console.error(`Pipeline ${action} failed:`, message);
  } finally {
    await releaseLock(lastError === undefined ? {} : { last_error: lastError });
  }
}

function runInBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  runtime?.waitUntil(task);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (!isAction(action)) return json({ error: "Unknown action" }, 400);
    if (!(await isAuthorized(req, action))) return json({ error: "Not authorized" }, 401);

    const params: JobParams = {};
    if (action === "prepare" || action === "publish") {
      const requested = typeof body?.channel_id === "string" ? body.channel_id : undefined;
      if (requested) {
        params.channelId = requested;
      } else {
        const channels = await loadChannels();
        if (channels.length === 1) params.channelId = channels[0].id;
        else return json({ error: "Choose which channel to run this for." }, 400);
      }
    }
    if (action === "retry") {
      if (typeof body?.package_id !== "string") return json({ error: "package_id is required" }, 400);
      params.packageId = body.package_id;
    }

    if (action === "recover") {
      const result = await recoverStalePipeline();
      const status = result.recovered || result.reason === "Pipeline is already idle." ? 200 : 409;
      return json(result, status);
    }

    const acquired = await acquireLock();
    if (!acquired) {
      return action === "tick"
        ? json({ skipped: true, reason: "A job is already running" })
        : json({ error: "A job is already running. Wait for it to finish." }, 409);
    }

    runInBackground(runJob(action, params));
    return json({ accepted: true, action }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
