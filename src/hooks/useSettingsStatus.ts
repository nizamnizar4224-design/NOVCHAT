import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SettingsStatus } from "@/types";

export function useSettingsStatus() {
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_settings_status");
    if (rpcError || !data || typeof data !== "object") {
      setError("Could not load your API settings.");
      return;
    }
    setError(null);
    setSettings(data as SettingsStatus);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { settings, error, refresh: load };
}
