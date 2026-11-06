import { useState } from "react";
import { Loader2, Plus, Tv } from "lucide-react";
import { ChannelForm } from "@/components/channels/ChannelForm";
import { Button, Notice } from "@/components/ui/primitives";
import type { useChannels } from "@/hooks/useChannels";
import { NICHES } from "@/types";

type ChannelsPageProps = {
  channels: ReturnType<typeof useChannels>;
};

export function ChannelsPage({ channels }: ChannelsPageProps) {
  const { channels: list, loading, error, refresh } = channels;
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);

  const selected = list.find((channel) => channel.id === selectedId) ?? null;
  const activeId = selectedId === "new" ? "new" : selected?.id ?? list[0]?.id ?? null;
  const active = activeId && activeId !== "new" ? list.find((channel) => channel.id === activeId) ?? null : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Channels</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Run several YouTube channels (finance, education, entertainment...) side by side. Each has its own niche,
            credentials, voice and schedule.
          </p>
        </div>
        <Button onClick={() => setSelectedId("new")}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add channel
        </Button>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading channels...
        </div>
      )}

      {!loading && !error && (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Channels" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {list.map((channel) => {
              const isActive = channel.id === activeId;
              const niche = NICHES.find((item) => item.value === channel.niche)?.label ?? channel.niche;
              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedId(channel.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex shrink-0 items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-sky-500/40 bg-sky-500/10"
                      : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                  }`}
                >
                  <Tv className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-100">{channel.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {niche}
                      {!channel.enabled && " - paused"}
                    </span>
                  </span>
                </button>
              );
            })}
            {list.length === 0 && <p className="text-sm text-zinc-400">No channels yet.</p>}
          </nav>

          <div>
            {activeId === "new" && (
              <ChannelForm
                key="new"
                channel={null}
                onCancel={() => setSelectedId(null)}
                onSaved={async (id) => {
                  await refresh();
                  setSelectedId(id);
                }}
                onDeleted={refresh}
              />
            )}
            {active && (
              <ChannelForm
                key={active.id}
                channel={active}
                onCancel={() => setSelectedId(null)}
                onSaved={async () => {
                  await refresh();
                }}
                onDeleted={async () => {
                  setSelectedId(null);
                  await refresh();
                }}
              />
            )}
            {!activeId && <p className="text-sm text-zinc-400">Add your first channel to get started.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
