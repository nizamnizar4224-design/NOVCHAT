import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { FieldLabel, inputClass } from "@/components/ui/primitives";
import type { SecretHint } from "@/types";

type SecretFieldProps = {
  id: string;
  label: string;
  /** null = not set; otherwise a masked hint such as "••••a1b2". The real value never reaches the browser. */
  saved: SecretHint;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
};

export function SecretField({ id, label, saved, value, onChange, hint }: SecretFieldProps) {
  const [visible, setVisible] = useState(false);
  const isSaved = saved !== null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${isSaved ? "text-emerald-300" : "text-zinc-500"}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isSaved ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden="true" />
          {isSaved ? `Saved ${saved}` : "Not set"}
        </span>
      </div>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={isSaved ? "Saved. Type a new value to replace it" : "Paste your key"}
          className={`${inputClass} pr-11 font-mono`}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide value" : "Show value"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
