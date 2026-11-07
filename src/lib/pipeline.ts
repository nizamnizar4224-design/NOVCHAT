import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { PipelineAction } from "@/types";

async function invokePipeline(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke("pipeline", { body });
  if (!error) return;
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null);
    if (parsed && typeof parsed.error === "string") throw new Error(parsed.error);
  }
  throw new Error("The pipeline could not be started. Check your connection and try again.");
}

export async function runPipelineJob(action: PipelineAction, channelId: string): Promise<string> {
  await invokePipeline({ action, channel_id: channelId });
  return action === "prepare" ? "New video generation started." : "Publishing started.";
}

export async function retryVideo(packageId: string): Promise<string> {
  await invokePipeline({ action: "retry", package_id: packageId });
  return "Retry started.";
}

export async function createSignedFileUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from("video-assets").createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error("Could not load the audio file.");
  return data.signedUrl;
}

export async function recoverStalePipelineStatus(): Promise<string> {
  await invokePipeline({ action: "recover" });
  return "Stale pipeline status checked.";
}
