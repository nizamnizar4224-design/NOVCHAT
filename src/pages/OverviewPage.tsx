import { useCallback } from "react";
import { LiveStatusCard } from "@/components/overview/LiveStatusCard";
import { RunControls } from "@/components/overview/RunControls";
import { ScheduleCard } from "@/components/overview/ScheduleCard";
import { StatCards } from "@/components/overview/StatCards";
import type { useChannels } from "@/hooks/useChannels";
import type { usePipelineState } from "@/hooks/usePipelineState";
import type { useVideoPackages } from "@/hooks/useVideoPackages";

type OverviewPageProps = {
  pipeline: ReturnType<typeof usePipelineState>;
  videos: ReturnType<typeof useVideoPackages>;
  channels: ReturnType<typeof useChannels>;
};

const IN_PRODUCTION = ["queued", "voicing", "thumbnail", "render_submit", "rendering", "assembling", "uploading"];

export function OverviewPage({ pipeline, videos, channels }: OverviewPageProps) {
  const inProgressCount = videos.packages.filter((pkg) => IN_PRODUCTION.includes(pkg.status)).length;
  const { refresh: refreshPipeline } = pipeline;
  const { refresh: refreshVideos } = videos;
  const refreshAll = useCallback(() => {
    void refreshPipeline();
    void refreshVideos();
  }, [refreshPipeline, refreshVideos]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Overview</h1>
        <p className="mt-1 text-sm text-zinc-400">Watch your automation run and see what is coming up next.</p>
      </div>

      <StatCards packages={videos.packages} loading={videos.loading} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <LiveStatusCard state={pipeline.state} error={pipeline.error} inProgressCount={inProgressCount} />
          <RunControls
            running={pipeline.state?.running ?? false}
            channels={channels.channels}
            packages={videos.packages}
            onStarted={refreshAll}
          />
        </div>
        <ScheduleCard channels={channels.channels} error={channels.error} />
      </div>
    </div>
  );
}
