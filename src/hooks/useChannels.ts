import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Channel } from "@/types";

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_channels");
    setLoading(false);
    if (rpcError || !Array.isArray(data)) {
      setError("Could not load your channels.");
      return;
    }
    setError(null);
    setChannels(data as Channel[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { channels, loading, error, refresh: load };
}
