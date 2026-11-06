import { useEffect, useState } from "react";
import { AppShell, type DashboardView } from "@/components/layout/AppShell";
import { OverviewPage } from "@/pages/OverviewPage";
import { VideosPage } from "@/pages/VideosPage";
import { ChannelsPage } from "@/pages/ChannelsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { usePipelineState } from "@/hooks/usePipelineState";
import { useVideoPackages } from "@/hooks/useVideoPackages";
import { useSettingsStatus } from "@/hooks/useSettingsStatus";
import { useChannels } from "@/hooks/useChannels";
import { supabase } from "@/lib/supabase";

export function DashboardPage({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<DashboardView>("overview");
  const pipeline = usePipelineState();
  const videos = useVideoPackages();
  const settings = useSettingsStatus();
  const channels = useChannels();

  // Registers this project's pipeline URL for the minute-by-minute scheduler (pg_cron). Harmless to repeat.
  useEffect(() => {
    const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!base) return;
    void supabase.rpc("ensure_scheduler", { p_url: `${base.replace(/\/$/, "")}/functions/v1/pipeline` });
  }, []);

  return (
    <AppShell view={view} onNavigate={setView} onSignOut={onSignOut}>
      {view === "overview" && <OverviewPage pipeline={pipeline} videos={videos} channels={channels} />}
      {view === "videos" && <VideosPage videos={videos} channels={channels.channels} />}
      {view === "channels" && <ChannelsPage channels={channels} />}
      {view === "settings" && <SettingsPage settings={settings} />}
    </AppShell>
  );
}
