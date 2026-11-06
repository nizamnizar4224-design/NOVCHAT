import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Card, FieldLabel, inputClass, Notice } from "@/components/ui/primitives";
import { supabase } from "@/lib/supabase";

export function SecurityCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    if (password.length < 12) {
      setResult({ tone: "error", text: "Use at least 12 characters for the master password." });
      return;
    }
    if (password !== confirm) {
      setResult({ tone: "error", text: "The two passwords do not match." });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setResult({ tone: "error", text: error.message });
        return;
      }
      setPassword("");
      setConfirm("");
      setResult({ tone: "success", text: "Master password updated." });
    } catch {
      setResult({ tone: "error", text: "Network error while saving. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card className="space-y-6 p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-zinc-50">Security</h2>
            <p className="mt-1 text-sm text-zinc-400">
              This dashboard has a single owner. Nobody else can sign in or create an account. Change your master
              password here.
            </p>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="new_password">New password</FieldLabel>
            <input
              id="new_password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
              placeholder="At least 12 characters"
            />
          </div>
          <div>
            <FieldLabel htmlFor="confirm_password">Confirm password</FieldLabel>
            <input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" loading={saving} disabled={!password}>
            Update password
          </Button>
        </div>
      </Card>
    </form>
  );
}
