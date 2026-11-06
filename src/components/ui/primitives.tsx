import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur ${className}`}>{children}</div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-sky-500 text-zinc-950 hover:bg-sky-400 disabled:bg-sky-500/40 disabled:text-zinc-300",
  secondary:
    "border border-zinc-700 bg-zinc-800/70 text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800 disabled:text-zinc-500",
  ghost: "text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-100 disabled:text-zinc-600",
};

export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-zinc-200">
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30";

export function Notice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const toneClass = {
    error: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  }[tone];
  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${toneClass}`}>{children}</div>;
}
