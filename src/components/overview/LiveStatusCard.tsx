import { Activity, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { recoverStalePipelineStatus } from "@/lib/pipeline";
import { Card, Notice } from "@/components/ui/primitives";
import { formatRelative } from "@/lib/format";
import type { PipelineState } from "@/types";

type LiveStatusCardProps = {
  state: PipelineState | null;
  error: string | null;
  inProgressCount: number;
};

export function LiveStatusCard({ state, error, inProgressCount }: LiveStatusCardProps) {
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const isStale = Boolean(state?.running && inProgressCount === 0 &&
    Date.now() - Date.parse(state.activity_updated_at) >= 10 * 60_000);
  const running = Boolean(state?.running && !isStale);
  const recover = async () => {
    setRecovering(true);
    setRecoveryMessage(null);
    try { await recoverStalePipelineStatus(); window.location.reload(); }
    catch (err) { setRecoveryMessage(err instanceof Error ? err.message : "Could not recover pipeline status."); }
    finally { setRecovering(false); }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Activity className="h-4 w-4 text-sky-400" aria-hidden="true" />
          Live status
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            running ? "bg-sky-500/15 text-sky-200" : "bg-zinc-800 text-zinc-300"
          }`}
        >
          <span className="relative flex h-2 w-2">
            {running && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${running ? "bg-sky-400" : "bg-zinc-500"}`} />
          </span>
          {isStale ? "Stale status" : running ? "Working" : "Idle"}
        </span>
      </div>

      <div className="mt-5 flex items-start gap-3">
        {running && <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-sky-400" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-zinc-50">
            {error ? "Status unavailable" : isStale ? "Previous job appears to have stopped" : state?.activity ?? "Loading..."}
          </p>
          {state && !error && (
            <p className="mt-1 text-sm text-zinc-400">Updated {formatRelative(state.activity_updated_at)}</p>
          )}
          <p className="mt-1 text-sm text-zinc-400">
            {inProgressCount} {inProgressCount === 1 ? "video" : "videos"} currently in production
          </p>
        </div>
      </div>

      {isStale && (
        <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-200">No video is currently in production and the last activity is older than 10 minutes. This may be an orphaned pipeline status.</p>
          <button type="button" onClick={() => void recover()} disabled={recovering}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-400/30 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${recovering ? "animate-spin" : ""}`} />
            {recovering ? "Checking safely..." : "Check and clear stale status"}
          </button>
          {recoveryMessage && <p className="mt-2 text-xs text-amber-100">{recoveryMessage}</p>}
        </div>
      )}

      {error && (
        <div className="mt-5">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {state?.last_error && !running && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="break-words">Last run needs attention: {state.last_error}</span>
        </div>
      )}
    </Card>
  );
}
