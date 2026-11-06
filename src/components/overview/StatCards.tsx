import { CheckCircle2, Clapperboard, Send } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import type { VideoPackage } from "@/types";

type StatCardsProps = {
  packages: VideoPackage[];
  loading: boolean;
};

const GENERATED_STATUSES = ["ready", "uploading", "published"];

export function StatCards({ packages, loading }: StatCardsProps) {
  const generated = packages.filter((pkg) => GENERATED_STATUSES.includes(pkg.status)).length;
  const uploaded = packages.filter((pkg) => pkg.status === "published").length;
  const awaiting = packages.filter((pkg) => pkg.status === "ready").length;

  const stats = [
    { label: "Videos generated", value: generated, icon: Clapperboard, tone: "text-sky-300 bg-sky-500/15" },
    { label: "Uploaded to YouTube", value: uploaded, icon: CheckCircle2, tone: "text-emerald-300 bg-emerald-500/15" },
    { label: "Ready to publish", value: awaiting, icon: Send, tone: "text-amber-300 bg-amber-500/15" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="p-5 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">{stat.label}</span>
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.tone}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-zinc-50">
              {loading ? "-" : stat.value}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
