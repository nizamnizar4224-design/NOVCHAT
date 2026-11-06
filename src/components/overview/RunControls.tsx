import { useState } from "react";
import { Clapperboard, Send } from "lucide-react";
import { Card, FieldLabel, inputClass, Notice } from "@/components/ui/primitives";
import { runPipelineJob } from "@/lib/pipeline";
import type { Channel, PipelineAction, VideoPackage } from "@/types";

type RunControlsProps = {
  running: boolean;
  channels: Channel[];
  packages: VideoPackage[];
  onStarted: () => void;
};

export function RunControls({ running, channels, packages, onStarted }: RunControlsProps) {
  const [channelId, setChannelId] = useState<string>("");
  const [pending, setPending] = useState<PipelineAction | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const activeId = channels.some((channel) => channel.id === channelId) ? channelId : channels[0]?.id ?? "";
  const readyCount = packages.filter(
    (pkg) =>
      pkg.channel_id === activeId && pkg.status === "ready" && Boolean(pkg.final_video_path ?? pkg.video_path),
  ).length;

  const run = async (action: PipelineAction) => {
    if (!activeId) return;
    setPending(action);
    setResult(null);
    try {
      const message = await runPipelineJob(action, activeId);
      setResult({ tone: "success", text: message });
      onStarted();
    } catch (err) {
      setResult({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setPending(null);
    }
  };

  const busy = running || pending !== null || !activeId;

  return (
    <Card className="p-6">
      <h2 className="text-sm font-medium text-zinc-300">Run manually</h2>
      <p className="mt-1 text-sm text-zinc-500">Test either stage right now instead of waiting for the schedule.</p>

      {channels.length === 0 ? (
        <div className="mt-5">
          <Notice tone="info">Add a channel on the Channels page before running the pipeline.</Notice>
        </div>
      ) : (
        <>
          {channels.length > 1 && (
            <div className="mt-5 max-w-xs">
              <FieldLabel htmlFor="run_channel">Channel</FieldLabel>
              <select
                id="run_channel"
                value={activeId}
                onChange={(event) => setChannelId(event.target.value)}
                className={inputClass}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void run("prepare")}
              disabled={busy}
              className="group flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-left transition duration-200 hover:border-sky-500/40 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300 transition group-hover:scale-105">
                <Clapperboard className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-medium text-zinc-100">Generate new video</span>
                <span className="mt-1 block text-xs text-zinc-400">Research a topic, write, voice and render it.</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => void run("publish")}
              disabled={busy || readyCount === 0}
              className="group flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-left transition duration-200 hover:border-emerald-500/40 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300 transition group-hover:scale-105">
                <Send className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-medium text-zinc-100">Publish next video</span>
                <span className="mt-1 block text-xs text-zinc-400">
                  {readyCount === 0
                    ? "No finished video is waiting."
                    : `${readyCount} waiting to go live on YouTube.`}
                </span>
              </span>
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="mt-4">
          <Notice tone={result.tone === "success" ? "success" : "error"}>{result.text}</Notice>
        </div>
      )}
    </Card>
  );
}
