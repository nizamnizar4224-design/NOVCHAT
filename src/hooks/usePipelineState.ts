import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { PipelineState } from "@/types";

const POLL_INTERVAL_MS = 3000;

export function usePipelineState() {
  const [state, setState] = useState<PipelineState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from("pipeline_state")
      .select("running, activity, activity_updated_at, last_prepare_at, last_publish_at, last_error")
      .eq("id", 1)
      .maybeSingle();
    if (queryError) {
      setError("Could not load live status.");
      return;
    }
    if (!data) {
      setError("Live status is unavailable.");
      return;
    }
    setError(null);
    setState(data as PipelineState);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return { state, error, refresh: load };
}
