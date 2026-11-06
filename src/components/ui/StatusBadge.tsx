import { CheckCircle2, Clock3, Loader2, Send, XCircle } from "lucide-react";
import type { PackageStatus } from "@/types";

const STATUS_META: Record<PackageStatus, { label: string; className: string; icon: "spin" | "check" | "clock" | "x" | "send" }> = {
  queued: { label: "Queued", className: "border-zinc-600 bg-zinc-800 text-zinc-200", icon: "clock" },
  voicing: { label: "Voiceover", className: "border-sky-500/40 bg-sky-500/10 text-sky-200", icon: "spin" },
  thumbnail: { label: "Thumbnail", className: "border-sky-500/40 bg-sky-500/10 text-sky-200", icon: "spin" },
  render_submit: { label: "Rendering", className: "border-sky-500/40 bg-sky-500/10 text-sky-200", icon: "spin" },
  rendering: { label: "Rendering", className: "border-sky-500/40 bg-sky-500/10 text-sky-200", icon: "spin" },
  assembling: { label: "Editing", className: "border-violet-500/40 bg-violet-500/10 text-violet-200", icon: "spin" },
  ready: { label: "Ready to publish", className: "border-amber-500/40 bg-amber-500/10 text-amber-200", icon: "clock" },
  uploading: { label: "Uploading", className: "border-sky-500/40 bg-sky-500/10 text-sky-200", icon: "send" },
  published: { label: "Published", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200", icon: "check" },
  failed: { label: "Failed", className: "border-rose-500/40 bg-rose-500/10 text-rose-200", icon: "x" },
};

const ICONS = {
  spin: Loader2,
  check: CheckCircle2,
  clock: Clock3,
  x: XCircle,
  send: Send,
};

export function StatusBadge({ status }: { status: PackageStatus }) {
  const meta = STATUS_META[status];
  const Icon = ICONS[meta.icon];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>
      <Icon className={`h-3.5 w-3.5 ${meta.icon === "spin" ? "animate-spin" : ""}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
