
ఇప్పుడు మనకు എന്റെ വെബ്സൈറ്റിൽ ഒക്കെ റൺ ചെയ്ത് അപ്ലൈക്കും അവിടെ അത് ഡിപ്ലോയ് ആയിട്ടുണ്ട്. Ready to deploy എന്ന ഓപ്ഷനിലേക്ക് എത്തിയിട്ടുണ്ട്. പക്ഷേ ഇപ്പോൾ ജനറേറ്റ് ആയ വീഡിയോ എങ്ങനെയാണ് കാണുക? ഇപ്പോൾ അത് വന്ന് കഴിഞ്ഞാൽ തംബ്നെയിൽ ക്രിയേറ്റ് ചെയ്യാൻ വേണ്ടിയുള്ള എപിഐ കൊടുക്കാത്തതുകൊണ്ട് അത് ഫെയിൽഡ് ആയി Ready to push എന്നുള്ള രീതിയിൽ thumbnail failed ആയി നിൽക്കുകയാണ്. അപ്പം ഇതുവരെയുള്ള സ്റ്റെപ്പ് ഞാൻ എങ്ങനെ കാണും? അതായത് എനിക്ക് നേരത്തെ വോയ്സ് ഓവർ കേക്കാൻ വേണ്ടി നമ്മുടെ വെബ്സൈറ്റിൽ ഒരു ഓപ്ഷൻ ഉണ്ടായിരുന്നു. വോയ്സ് ഓവർ എന്ന് പറഞ്ഞ് പ്ലേ ചെയ്യാൻ വേണ്ടിയുള്ള ഓപ്ഷൻ. അതുപോലെ ഈ വീഡിയോ പ്ലേ ചെയ്യാൻ വേണ്ടിയുള്ള ഓപ്ഷൻ എവിടെയാണ്? വീഡിയോ കാണാൻ വേണ്ടി
അതെ, ഇപ്പോൾ നിങ്ങൾക്ക് വേണ്ടത് Thumbnail ഇല്ലെങ്കിലും Generate ചെയ്ത വീഡിയോ നേരിട്ട് Play ചെയ്ത് കാണാനുള്ള Preview Option ആണ്.

Thumbnail API ഇല്ലാത്തതിനാൽ Thumbnail Step Failed ആയാലും, അതിനു മുമ്പ് Video Render വിജയിച്ചിട്ടുണ്ടെങ്കിൽ വീഡിയോ കാണാൻ കഴിയണം. Ready to Push എന്ന Status വന്നതുകൊണ്ട് മാത്രം വീഡിയോ കാണാനുള്ള സൗകര്യം Website-ൽ ഉണ്ടെന്ന് ഉറപ്പില്ല.

നമുക്ക് വേണ്ടത് Voiceover Player പോലെ തന്നെ ഒരു Video Preview Player ആണ്. അത് Thumbnail Status-ൽ നിന്ന് സ്വതന്ത്രമായി പ്രവർത്തിക്കണം.

ഞാൻ നിങ്ങളുടെ Website-ന്റെ VideosPage.tsx പരിശോധിച്ചു. അതിൽ Voiceover Player ഉണ്ടായിരുന്നു; പക്ഷേ Generated Video Player നിലവിലില്ലായിരുന്നു. അതിനാൽ Video History-യിൽ വീഡിയോ തുറന്നാലും Play ചെയ്യാനുള്ള Option കാണില്ലായിരുന്നു.

ഇപ്പോൾ അതിനുള്ള Code മാറ്റം തയ്യാറാക്കിയിട്ടുണ്ട്.

Video Preview feature added to source
പുതിയ Option എവിടെ കാണും?
Vercel-ൽ പുതിയ Code Deploy ചെയ്തതിനുശേഷം:

Website തുറക്കുക.

Video History തിരഞ്ഞെടുക്കുക.

നിങ്ങൾ Generate ചെയ്ത വീഡിയോയുടെ Row-ൽ ക്ലിക്ക് ചെയ്യുക.

Details Panel-ൽ Generated Video Preview കാണാം.

അവിടെ Play അമർത്തി വീഡിയോ കാണാം.

Thumbnail Failed ആയാലും Video Player പ്രവർത്തിക്കും. ഇത് final_video_path അല്ലെങ്കിൽ video_path ഉപയോഗിച്ച് Supabase Storage-ൽ നിന്ന് വീഡിയോ തുറക്കും. Private Storage ഫയലുകൾക്കായി signed URL ഉപയോഗിക്കുന്ന രീതിയാണ് ഇതിൽ ഉൾപ്പെടുത്തിയിരിക്കുന്നത്. 

Supabase Docs
+1

Updated files
Changed Files ZIP Recommended
Download Video Preview Changed Files

മാറ്റിയ VideosPage.tsx മാത്രം.

Full Project ZIP
Download Full Updated Project

ഇനി ചെയ്യേണ്ടത്
Changed Files ZIP-ൽ ഉള്ള src/pages/VideosPage.tsx GitHub-ലെ അതേ ഫയലിന് പകരം Upload ചെയ്യുക. GitHub Commit ചെയ്താൽ Vercel വീണ്ടും Deploy ചെയ്യും.

ശ്രദ്ധിക്കുക: Code മാറ്റം തയ്യാറാക്കിയിട്ടുണ്ട്. ഇവിടെ Build വിജയിച്ചതായി സ്ഥിരീകരിക്കാൻ കഴിഞ്ഞിട്ടില്ല; ഈ Environment-ൽ Vite ഇൻസ്റ്റാൾ ചെയ്തിട്ടില്ല. Live Website-ൽ Deploy ചെയ്ത് പരിശോധിക്കണം.

ഒരു പ്രധാന കാര്യം: Deploy ചെയ്തിട്ടും Player-ൽ Video preview not available yet എന്ന് വന്നാൽ video_path, final_video_path എന്നിവ ഇപ്പോഴും Database-ൽ ശൂന്യമാണ്. അപ്പോൾ Player പ്രശ്നമല്ല; വീഡിയോ Storage-ലേക്ക് Save ചെയ്യുന്ന Pipeline ഭാഗം വീണ്ടും പരിശോധിക്കണം.

ICANT DOWNLOAD ZIP
സാരമില്ല. ZIP download ആവുന്നില്ലെങ്കിൽ ZIP ഇല്ലാതെയും ഫയൽ നേരിട്ട് ഡൗൺലോഡ് ചെയ്യാം.

Direct file download
VideosPage.tsx

ഇവിടെ ക്ലിക്ക് ചെയ്ത് ഫയൽ ഡൗൺലോഡ് ചെയ്യൂ

ZIP വേണ്ട. നേരിട്ട് GitHub-ൽ replace ചെയ്യാവുന്ന ഫയലാണ്.

GitHub-ൽ ചെയ്യേണ്ടത്:

Repository തുറക്കുക.

src/pages/VideosPage.tsx തുറക്കുക.

Edit ചെയ്ത് പുതിയ ഫയലിലെ Code മുഴുവൻ Paste ചെയ്യുക.

Commit Changes ചെയ്യുക.

Vercel സ്വയം Deploy ചെയ്യും.

ഇതും download ആവുന്നില്ലെങ്കിൽ പറയൂ. Code ഇവിടെ ഭാഗങ്ങളായി നേരിട്ട് നൽകാം.


VideosPage.tsx
Code
നമുക്ക് ഈ വീഡിയോസ് ഡിലീറ്റ് ചെയ്യാനുള്ള ഓപ്ഷനും വേണം. അതേപോലെ  ചാനല്സിലേക്ക് കയറിക്കഴിഞ്ഞാൽ മെയിൻ ചാനൽ ക്രിയേറ്റ് ചെയ്യണം. ക്രിയേറ്റ് ചെയ്യാനുള്ള ഓപ്ഷൻ മാത്രം കാണിക്കുന്നുള്ളൂ. ഡിലീറ്റ് ചെയ്യാനുള്ള ഓപ്ഷൻ   ഉണ്ട്. ഓക്കെ. അപ്പോൾ അത് വേണ്ട. അപ്പോൾ വീഡിയോസ് വന്ന് കഴിയുമ്പോൾ ഈ ക്രിയേറ്റ് ആവുന്ന വീഡിയോസ് ഡിലീറ്റ് ചെയ്യാനുള്ള ഓപ്ഷൻ. അതിപ്പോൾ ക്രിയേറ്റഡ് ടൈറ്റിൽ ചാനൽ സ്റ്റാറ്റസ് യൂട്യൂബ്. ഇങ്ങനെ ഇത്ര ഓപ്ഷൻസ് ആണ് കൊടുത്തേക്കുന്നത്. ഇതിന് അടുത്തായിട്ട് ഒരു ആക്ഷൻ, എന്തെങ്കിലും ഒരു ബട്ടൺ വെച്ചിട്ട് ഡിലീറ്റ് ചെയ്യാനുള്ള ഓപ്ഷൻ കൂടെ കൊടുക്കുകയാണെങ്കിൽ ആ വീഡിയോസ് നമുക്ക് ഡിലീറ്റ് ചെയ്യാമായിരുന്നു. കാരണം ഈ കിടക്കുന്ന ഇപ്പോഴുള്ള പ്രിവ്യൂ എനിക്ക് ഡിലീറ്റ് ആക്കണം. കാരണം ഇപ്പോൾ ലാസ്റ്റ് ക്രിയേറ്റ് ആയ വീഡിയോ ക്രിയേറ്റ് ആയി. അതായത് ഓ ക്രിയേറ്റ് ആയ വീഡിയോ കാണാൻ പറ്റുന്നുണ്ട്. ആ വീഡിയോ ഞാൻ അയച്ചുതരാം. വീഡിയോയ്ക്ക് ക്വാളിറ്റി ഇല്ല. വീഡിയോ ലോ ക്വാളിറ്റി ആണ്
അതെ, തീർച്ചയായും. Video History-യിൽ ഓരോ വീഡിയോയുടെ അടുത്തും Delete ബട്ടൺ ചേർക്കാം. നിങ്ങൾ പറഞ്ഞ Created, Title, Channel, Status, YouTube എന്നീ കോളങ്ങൾക്ക് അടുത്തായിരിക്കും അത്.

ഞാൻ നിലവിലുള്ള VideosPage.tsx-ൽ ഈ മാറ്റം തയ്യാറാക്കിയിട്ടുണ്ട്.

Delete option added to source
Delete അമർത്തുമ്പോൾ എന്ത് സംഭവിക്കും?
Confirmation ചോദിക്കും.

ആ വീഡിയോയുടെ Preview ഫയൽ Storage-ൽ നിന്ന് Delete ചെയ്യും.

അതിന്റെ Voiceover, Thumbnail ഫയലുകളും Delete ചെയ്യും.

video_packages-ലെ ആ വീഡിയോയുടെ റെക്കോർഡും Delete ചെയ്യും.

Video History പുതുക്കും.

YouTube-ൽ ഇതിനകം Published ആയ വീഡിയോ YouTube-ൽ നിന്ന് സ്വയം Delete ചെയ്യില്ല.

Updated file:

Download VideosPage.tsx

ഇത് GitHub-ലെ src/pages/VideosPage.tsx ഉപയോഗിച്ച് Replace ചെയ്ത് Commit ചെയ്യുക. Vercel Deploy കഴിഞ്ഞാൽ Delete ബട്ടൺ കാണും.

വീഡിയോയുടെ Quality പരിശോധിക്കാം
നിങ്ങൾ പറഞ്ഞ Low Quality വീഡിയോ പരിശോധിക്കാനും ഞാൻ തയ്യാറാണ്. ഇപ്പോൾ ലഭിച്ച CameraRecording Supabase Logs കാണിക്കുന്ന Screen Recording ആണ്; Generated Video അല്ല.

Creatomate-ൽ നിന്ന് Generate ചെയ്ത യഥാർത്ഥ MP4 വീഡിയോ ഇവിടെ Upload ചെയ്യൂ. അതിന്റെ Resolution, Bitrate, Frame Rate, Visual Quality എന്നിവ പരിശോധിച്ച് എന്തുകൊണ്ടാണ് Quality കുറഞ്ഞതെന്ന് കണ്ടെത്താം.


VideosPage.tsx
Code
ഡൗൺലോഡ് ചെയ്യാൻ പറ്റുന്നില്ല. ഫയല് ഡൗൺലോഡ് ചെയ്യാൻ അല്ല ഫയൽ ഓപ്പൺ ചെയ്യാൻ നോക്കുമ്പോൾ Could not load this fileെന്ന് പറഞ്ഞാണ് വരുന്നത്. Retry.

Worked for 15s
ക്ഷമിക്കണം. ഇത്തവണ ZIP-ന് പുറമേ സാധാരണ Text ഫയലായും തയ്യാറാക്കിയിട്ടുണ്ട്. അതിനാൽ തുറക്കാൻ എളുപ്പമായിരിക്കും.

ഇവിടെ നിന്ന് വീണ്ടും ശ്രമിക്കൂ:

പുതിയ ലിങ്ക്
1. VideosPage Code – TXT

VideosPage-delete-option.txt തുറക്കുക

തുറക്കാൻ കഴിയുന്നില്ലെങ്കിൽ ഡൗൺലോഡ് ചെയ്ത് Notepad-ൽ തുറക്കാം.

2. ZIP ഫയൽ

Studio-Autopilot-Video-Delete-Update.zip

TXT ഫയൽ തുറന്നാൽ അതിലെ മുഴുവൻ Code Copy ചെയ്ത് GitHub-ലെ src/pages/VideosPage.tsx-ൽ Paste ചെയ്യാം.

ഇതും തുറക്കാൻ കഴിയുന്നില്ലെങ്കിൽ പറയൂ; Code ഇവിടെ നേരിട്ട് ഭാഗങ്ങളായി നൽകാം.


VideosPage-delete-option.txt
Document
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Film, Loader2, Play, RotateCcw, Trash2, Volume2, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card, inputClass } from "@/components/ui/primitives";
import { createSignedFileUrl, retryVideo } from "@/lib/pipeline";
import { supabase } from "@/lib/supabase";
import { formatDateTime, formatTimestamp } from "@/lib/format";
import type { Channel, VideoPackage } from "@/types";

type VideosPageProps = {
  videos: { packages: VideoPackage[]; loading: boolean; error: string | null; refresh: () => Promise<void> };
  channels: Channel[];
};

export function VideosPage({ videos, channels }: VideosPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (pkg: VideoPackage) => {
    const label = pkg.title ?? pkg.topic ?? "this video";
    if (!window.confirm(`Delete "${label}" from Video History? This also removes its saved video, voiceover and thumbnail files from Storage. A video already published to YouTube will NOT be deleted from YouTube.`)) return;

    setDeletingId(pkg.id);
    setDeleteError(null);
    try {
      const paths = [...new Set([pkg.final_video_path, pkg.video_path, pkg.voice_path, pkg.thumbnail_path]
        .filter((path): path is string => Boolean(path) && !/^https?:\/\//i.test(path!)))];

      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage.from("video-assets").remove(paths);
        if (storageError) throw storageError;
      }

      const { error: deleteDbError } = await supabase.from("video_packages").delete().eq("id", pkg.id);
      if (deleteDbError) throw deleteDbError;

      if (selectedId === pkg.id) setSelectedId(null);
      await videos.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete this video.");
    } finally {
      setDeletingId(null);
    }
  };
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
      {deleteError && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">Delete failed: {deleteError}</p>}

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
                  <th className="px-6 py-3 font-medium">Action</th>
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
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); void handleDelete(pkg); }}
                        disabled={deletingId === pkg.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition hover:border-rose-400/60 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Delete ${pkg.title ?? pkg.topic ?? "video"}`}
                      >
                        {deletingId === pkg.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        {deletingId === pkg.id ? "Deleting" : "Delete"}
                      </button>
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

        {(pkg.final_video_path || pkg.video_path) ? (
          <section className="mt-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Generated video preview</h3>
            <VideoPreview paths={[pkg.final_video_path, pkg.video_path].filter((path): path is string => Boolean(path))} />
          </section>
        ) : (
          <section className="mt-6 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
            <h3 className="text-sm font-medium text-amber-200">Video preview not available yet</h3>
            <p className="mt-1 text-sm text-zinc-400">The video file has not been saved to Storage for this package. Thumbnail failure does not provide a playable video URL by itself.</p>
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

function VideoPreview({ paths }: { paths: string[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      for (const path of paths) {
        try {
          const playableUrl = /^https?:\/\//i.test(path) ? path : await createSignedFileUrl(path, 4 * 60 * 60);
          if (!cancelled) setUrl(playableUrl);
          if (!cancelled) setLoading(false);
          return;
        } catch {
          // Try the other saved path (final_video_path / video_path) before showing an error.
        }
      }
      if (!cancelled) {
        setError("Could not open the generated video. Check that the file exists in the video-assets Storage bucket and that this account can read it.");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paths.join("|")]);

  if (loading) {
    return (
      <div className="mt-3 flex h-40 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" aria-hidden="true" />
        <span className="ml-2 text-sm text-zinc-400">Preparing video preview...</span>
      </div>
    );
  }
  if (error || !url) {
    return <p className="mt-3 text-sm text-rose-300">{error ?? "Could not load the generated video."}</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      <video controls playsInline preload="metadata" src={url} className="w-full rounded-lg border border-zinc-800 bg-black" />
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-sky-300 transition hover:text-sky-200">
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        Open video in a new tab
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
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



