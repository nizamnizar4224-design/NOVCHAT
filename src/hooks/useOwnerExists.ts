import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/** `null` while checking. Once an owner exists the login screen stops offering account creation. */
export function useOwnerExists(): boolean | null {
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void supabase.rpc("owner_exists").then(({ data, error }) => {
      if (active) setExists(error ? true : data === true);
    });
    return () => {
      active = false;
    };
  }, []);
  return exists;
}
