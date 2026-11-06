import { useEffect, useState } from "react";
import { CalendarClock, Globe } from "lucide-react";
import { Card, Notice } from "@/components/ui/primitives";
import { formatCountdown, formatDateTime, nextRunAt } from "@/lib/format";
import type { Channel } from "@/types";

type ScheduleCardProps = {
  channels: Channel[];
  error: string | null;
};

export function ScheduleCard({ channels, error }: ScheduleCardProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const active = channels.filter((channel) => channel.enabled);

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
        <CalendarClock className="h-4 w-4 text-sky-400" aria-hidden="true" />
        Upcoming schedule
      </div>

      {error && (
        <div className="mt-5">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {!error && active.length === 0 && (
        <p className="mt-5 text-sm text-zinc-400">No active channels. Add or enable one on the Channels page.</p>
      )}

      <ul className="mt-5 space-y-4">
        {active.map((channel) => {
          const rows = [
            { label: "Create video", time: channel.prepare_time, tone: "text-sky-300" },
            { label: "Publish to YouTube", time: channel.publish_time, tone: "text-emerald-300" },
          ].map((row) => ({ ...row, next: nextRunAt(row.time, channel.timezone, now) }));
          return (
            <li key={channel.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-zinc-100">{channel.name}</p>
                <p className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
                  <Globe className="h-3 w-3" aria-hidden="true" />
                  {channel.timezone}
                </p>
              </div>
              <div className="mt-3 space-y-3">
                {rows.map((row) => (
                  <div key={row.label}>
                    <p className="text-xs uppercase tracking-wide text-zinc-500">{row.label}</p>
                    <p className={`text-base font-semibold ${row.tone}`}>{row.time}</p>
                    <p className="text-xs text-zinc-400">
                      {row.next
                        ? `${formatDateTime(row.next.toISOString())} (${formatCountdown(row.next, now)})`
                        : "No upcoming run"}
                    </p>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
