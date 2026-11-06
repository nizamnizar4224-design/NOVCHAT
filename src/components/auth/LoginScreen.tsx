import { useState, type FormEvent } from "react";
import { Clapperboard, Lock } from "lucide-react";
import { Button, Card, FieldLabel, inputClass, Notice } from "@/components/ui/primitives";
import { supabase } from "@/lib/supabase";
import { useOwnerExists } from "@/hooks/useOwnerExists";

type Mode = "signin" | "setup";

export function LoginScreen({ onOwnerClaimed }: { onOwnerClaimed: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ownerExists = useOwnerExists();
  const canSetUp = ownerExists === false;
  const isSetup = mode === "setup" && canSetUp;

  const handleSignIn = async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(
        signInError.message.toLowerCase().includes("invalid")
          ? "That username or password is not correct."
          : `Sign-in failed: ${signInError.message}`,
      );
    }
  };

  const handleSetup = async () => {
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (!data.session) {
      setMessage("Account created. Sign in with your new username and password.");
      setMode("signin");
      return;
    }
    const { data: claimed, error: claimError } = await supabase.rpc("claim_owner");
    if (claimError || claimed !== true) {
      await supabase.auth.signOut();
      setError("This dashboard already has an owner. Only the original owner can sign in.");
      return;
    }
    onOwnerClaimed();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      if (isSetup) await handleSetup();
      else await handleSignIn();
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-12">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.12),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 ring-1 ring-sky-500/30">
            <Clapperboard className="h-7 w-7 text-sky-400" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Studio Autopilot</h1>
          <p className="mt-2 text-sm text-zinc-400">Private console for your automated YouTube channel</p>
        </div>

        <Card className="p-8 shadow-2xl shadow-black/40">
          <div className="mb-6 flex items-center gap-2 text-sm text-zinc-400">
            <Lock className="h-4 w-4" aria-hidden="true" />
            {isSetup ? "Create the owner account" : "Owner sign in"}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <FieldLabel htmlFor="email">Username (email)</FieldLabel>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <input
                id="password"
                type="password"
                autoComplete={isSetup ? "new-password" : "current-password"}
                required
                minLength={isSetup ? 12 : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
                placeholder={isSetup ? "At least 12 characters" : "Your master password"}
              />
            </div>

            {error && <Notice tone="error">{error}</Notice>}
            {message && <Notice tone="success">{message}</Notice>}

            <Button type="submit" className="w-full" loading={submitting}>
              {isSetup ? "Create owner account" : "Sign in"}
            </Button>
          </form>

          {canSetUp && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMessage(null);
                setMode(isSetup ? "signin" : "setup");
              }}
              className="mt-6 w-full text-center text-sm text-zinc-400 transition hover:text-zinc-200"
            >
              {isSetup ? "Already set up? Sign in instead" : "First time here? Set up the owner account"}
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}
