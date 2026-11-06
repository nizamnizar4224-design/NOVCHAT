import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type AccessState = "loading" | "signed-out" | "checking" | "owner" | "locked";

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<AccessState>("loading");
  const [checkCount, setCheckCount] = useState(0);

  useEffect(() => {
    let latest = 0;

    const resolve = async (next: Session | null) => {
      const attempt = ++latest;
      setSession(next);
      if (!next) {
        setAccess("signed-out");
        return;
      }
      setAccess("checking");
      const { data, error } = await supabase.rpc("is_owner");
      if (attempt !== latest) return;
      setAccess(!error && data === true ? "owner" : "locked");
    };

    void supabase.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      (async () => {
        await resolve(next);
      })();
    });

    return () => subscription.subscription.unsubscribe();
  }, [checkCount]);

  return {
    session,
    access,
    recheckAccess: () => setCheckCount((count) => count + 1),
    signOut: () => supabase.auth.signOut(),
  };
}
