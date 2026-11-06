import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { VideoPackage } from "@/types";

const POLL_INTERVAL_MS = 5000;

export function useVideoPackages() {
  const [packages, setPackages] = useState<VideoPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from("video_packages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (queryError) {
      setError("Could not load your video history.");
      return;
    }
    setError(null);
    setPackages((data ?? []) as VideoPackage[]);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return { packages, loading, error, refresh: load };
}
