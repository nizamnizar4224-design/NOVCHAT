import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Film, Loader2, RotateCcw, Volume2, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card, inputClass } from "@/components/ui/primitives";
import { createSignedFileUrl, retryVideo } from "@/lib/pipeline";
import { formatDateTime, formatTimestamp } from "@/lib/format";
import type { Channel, VideoPackage } from "@/types";

type VideosPageProps = {
  videos: { packages: VideoPackage[]; loading: boolean; error: string | null; refresh: () => Promise<void> };
  channels: Channel[];
};

export function VideosPage({ videos, channels }: VideosPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const { loading, error } = videos;
  const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
  const packages = videos.packages.filter((pkg) => channelFilter === "all" || pkg.channel_id === channelFilter);
  // Always show the freshest copy of the open video (the list refreshes every few seconds).
  const selected = videos.packages.find((pkg) => pkg.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Video history</h1>
        <p className="mt-1 text-sm text-zinc-400">Every video the automation has created, with its publishing status.</p>
      </div>

      {channels.length > 1 && (
        <div className="max-w-xs">
          <label htmlFor="channel_filter" className="mb-1.5 block text-sm font-medium text-zinc-200">
            Channel
          </label>
          <select
            id="channel_filter"
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value)}
            className={inputClass}
          >
            <option value="all">All channels</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">{error}</p>}

      <Card className="overflow-hidden">
        {loading ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-400">Loading history...</p>
        ) : packages.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800">
              <Film className="h-6 w-6 text-zinc-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-zinc-200">No videos yet</p>
            <p className="mt-1 text-sm text-zinc-400">Generate your first video from the Overview page.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium">Title</th>
                  <th className="px-6 py-3 font-medium">Channel</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">YouTube</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {packages.map((pkg) => (
                  <tr
                    key={pkg.id}
                    onClick={() => setSelectedId(pkg.id)}
                    className="cursor-pointer transition-colors duration-150 hover:bg-zinc-800/40"
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-zinc-400">{formatDateTime(pkg.created_at)}</td>
                    <td className="max-w-xs px-6 py-4">
                      <span className="block truncate font-medium text-zinc-100">{pkg.title ?? pkg.topic ?? "Untitled video"}</span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-zinc-400">
                      {pkg.channel_id ? channelNames.get(pkg.channel_id) ?? "Unknown" : "Deleted channel"}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={pkg.status} />
                    </td>
                    <td className="px-6 py-4">
                      {pkg.youtube_url ? (
                        <a
                          href={pkg.youtube_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1.5 text-sky-300 transition hover:text-sky-200"
                        >
                          Watch
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="text-zinc-600">Not yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <VideoDetailPanel
          pkg={selected}
          channelName={selected.channel_id ? channelNames.get(selected.channel_id) ?? null : null}
          onClose={() => setSelectedId(null)}
          onRetried={() => void videos.refresh()}
        />
      )}
    </div>
  );
}

function VideoDetailPanel({
  pkg,
  channelName,
  onClose,
  onRetried,
}: {
  pkg: VideoPackage;
  channelName: string | null;
  onClose: () => void;
  onRetried: () => void;
}) {
  const [showScript, setShowScript] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await retryVideo(pkg.id);
      onRetried();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Could not retry this video.");
    } finally {
      setRetrying(false);
    }
  };
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const loadAudio = async () => {
    if (audioUrl || audioLoading || !pkg.voice_path) return;
    setAudioLoading(true);
    setAudioError(null);
    try {
      const url = await createSignedFileUrl(pkg.voice_path);
      setAudioUrl(url);
    } catch {
      setAudioError("Could not load the voiceover audio.");
    } finally {
      setAudioLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-[fadeIn_200ms_ease-out]" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Video details"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6 shadow-2xl animate-[slideIn_250ms_ease-out] sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">
              {formatDateTime(pkg.created_at)}
              {channelName ? ` - ${channelName}` : ""}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-50">{pkg.title ?? pkg.topic ?? "Untitled video"}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close details"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusBadge status={pkg.status} />
          {pkg.youtube_url && (
            <a
              href={pkg.youtube_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-sky-300 transition hover:text-sky-200"
            >
              Open on YouTube
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>

        {pkg.error_message && (
          <p
            className={`mt-5 rounded-lg border px-3.5 py-2.5 text-sm break-words ${
              pkg.status === "failed"
                ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                : "border-amber-500/30 bg-amber-500/10 text-amber-200"
            }`}
          >
            {pkg.error_message}
          </p>
        )}

        {pkg.status === "failed" && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-200 transition hover:border-zinc-600 disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              )}
              Retry from where it stopped
            </button>
            {retryError && <p className="mt-2 text-sm text-rose-300">{retryError}</p>}
          </div>
        )}

        {pkg.topic && (
          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Topic</h3>
            <p className="mt-2 text-sm text-zinc-200">{pkg.topic}</p>
          </section>
        )}

        {pkg.description && (
          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Description</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-zinc-300">{pkg.description}</p>
          </section>
        )}

        {pkg.tags.length > 0 && (
          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tags</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {pkg.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300">
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {pkg.voice_path && (
          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Voiceover</h3>
            {audioError && <p className="mt-2 text-sm text-rose-300">{audioError}</p>}
            {!audioUrl && !audioError && (
              <button
                type="button"
                onClick={() => void loadAudio()}
                disabled={audioLoading}
                className="mt-2 inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-200 transition hover:border-zinc-600 disabled:opacity-50"
              >
                {audioLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
                Play voiceover
              </button>
            )}
            {audioUrl && (
              <audio controls src={audioUrl} className="mt-3 w-full">
                <track kind="captions" />
              </audio>
            )}
          </section>
        )}

        {pkg.thumbnail_path && (
          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Thumbnail</h3>
            <ThumbnailImage path={pkg.thumbnail_path} />
          </section>
        )}

        {pkg.script_segments && pkg.script_segments.length > 0 && (
          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Script timeline</h3>
            <ol className="mt-3 space-y-3">
              {pkg.script_segments.map((segment) => (
                <li key={segment.index} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-100">{segment.label}</p>
                    <p className="font-mono text-xs text-sky-300">
                      {formatTimestamp(segment.start_sec)} - {formatTimestamp(segment.end_sec)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">{segment.narration}</p>
                  <dl className="mt-3 grid gap-1.5 text-xs text-zinc-400">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-zinc-500">Camera</dt>
                      <dd>{segment.camera_angle}</dd>
                    </div>
                    {segment.broll && (
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-zinc-500">B-roll</dt>
                        <dd>{segment.broll}</dd>
                      </div>
                    )}
                    {segment.on_screen_text && (
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-zinc-500">On screen</dt>
                        <dd>{segment.on_screen_text}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ol>
          </section>
        )}

        {pkg.script && (
          <section className="mt-6">
            <button
              type="button"
              onClick={() => setShowScript((value) => !value)}
              className="flex w-full items-center justify-between rounded-lg border border-zinc-800 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
              aria-expanded={showScript}
            >
              Narration script
              {showScript ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
            </button>
            {showScript && (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-zinc-300">{pkg.script}</p>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

function ThumbnailImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const signed = await createSignedFileUrl(path);
        if (!cancelled) setUrl(signed);
      } catch {
        if (!cancelled) setError("Could not load the thumbnail image.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (loading) {
    return (
      <div className="mt-3 flex h-40 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" aria-hidden="true" />
      </div>
    );
  }
  if (error || !url) {
    return <p className="mt-3 text-sm text-rose-300">{error ?? "No thumbnail available."}</p>;
  }
  return <img src={url} alt="Generated thumbnail" className="mt-3 w-full rounded-lg border border-zinc-800" />;
}
