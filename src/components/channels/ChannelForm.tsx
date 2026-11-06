import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button, Card, FieldLabel, inputClass, Notice } from "@/components/ui/primitives";
import { SecretField } from "@/components/settings/SecretField";
import { supabase } from "@/lib/supabase";
import { TIMEZONES } from "@/lib/format";
import { NICHES, type Channel, type ChannelSecretKey, type Niche, type YouTubePrivacy } from "@/types";

const SECRET_KEYS: ChannelSecretKey[] = ["youtube_client_id", "youtube_client_secret", "youtube_refresh_token"];

const EMPTY_SECRETS: Record<ChannelSecretKey, string> = {
  youtube_client_id: "",
  youtube_client_secret: "",
  youtube_refresh_token: "",
};

type ChannelFormProps = {
  /** null = creating a new channel */
  channel: Channel | null;
  onSaved: (channelId: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  onCancel: () => void;
};

export function ChannelForm({ channel, onSaved, onDeleted, onCancel }: ChannelFormProps) {
  const [name, setName] = useState(channel?.name ?? "");
  const [niche, setNiche] = useState<Niche>(channel?.niche ?? "general");
  const [styleNotes, setStyleNotes] = useState(channel?.style_notes ?? "");
  const [region, setRegion] = useState(channel?.target_region ?? "India");
  const [country, setCountry] = useState(channel?.target_country ?? "India");
  const [language, setLanguage] = useState(channel?.primary_language ?? "English");
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [voiceId, setVoiceId] = useState(channel?.elevenlabs_voice_id ?? "");
  const [avatarId, setAvatarId] = useState(channel?.heygen_avatar_id ?? "");
  const [privacy, setPrivacy] = useState<YouTubePrivacy>(channel?.youtube_privacy ?? "private");
  const [prepareTime, setPrepareTime] = useState(channel?.prepare_time ?? "09:00");
  const [publishTime, setPublishTime] = useState(channel?.publish_time ?? "15:00");
  const [timezone, setTimezone] = useState(channel?.timezone ?? "UTC");
  const [secrets, setSecrets] = useState(EMPTY_SECRETS);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const setSecret = (key: ChannelSecretKey) => (value: string) =>
    setSecrets((current) => ({ ...current, [key]: value }));
  const nicheHint = NICHES.find((item) => item.value === niche)?.hint;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);
    if (!name.trim()) {
      setResult({ tone: "error", text: "Give the channel a name." });
      return;
    }
    if (!prepareTime || !publishTime) {
      setResult({ tone: "error", text: "Set both run times before saving." });
      return;
    }

    const values: Record<string, string | boolean | null> = {
      name: name.trim(),
      niche,
      style_notes: styleNotes.trim() || null,
      target_region: region,
      target_country: country,
      primary_language: language,
      enabled,
      elevenlabs_voice_id: voiceId.trim() || null,
      heygen_avatar_id: avatarId.trim() || null,
      youtube_privacy: privacy,
      prepare_time: prepareTime,
      publish_time: publishTime,
      timezone,
    };
    for (const key of SECRET_KEYS) {
      const value = secrets[key].trim();
      if (value) values[key] = value;
    }

    setSaving(true);
    try {
      if (channel) {
        const { error } = await supabase
          .from("channels")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("id", channel.id);
        if (error) {
          setResult({ tone: "error", text: "The channel could not be saved. Please try again." });
          return;
        }
        setSecrets(EMPTY_SECRETS);
        await onSaved(channel.id);
        setResult({ tone: "success", text: "Channel saved." });
      } else {
        const { data, error } = await supabase.from("channels").insert(values).select("id").single();
        if (error || !data) {
          setResult({ tone: "error", text: "The channel could not be created. Please try again." });
          return;
        }
        await onSaved(data.id as string);
      }
    } catch {
      setResult({ tone: "error", text: "Network error while saving. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!channel) return;
    const confirmed = window.confirm(
      `Delete "${channel.name}"? Its credentials and schedule are removed. Existing videos stay in your history but can no longer be processed.`,
    );
    if (!confirmed) return;
    setDeleting(true);
    setResult(null);
    try {
      const { error } = await supabase.from("channels").delete().eq("id", channel.id);
      if (error) {
        setResult({ tone: "error", text: "The channel could not be deleted. Please try again." });
        return;
      }
      await onDeleted();
    } catch {
      setResult({ tone: "error", text: "Network error while deleting. Please try again." });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="space-y-6 p-6 sm:p-8">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">{channel ? "Channel details" : "New channel"}</h2>
          <p className="mt-1 text-sm text-zinc-400">
            The niche shapes how scripts are written for this channel; style notes let you add your own rules.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="channel_name">Channel name</FieldLabel>
            <input
              id="channel_name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              placeholder="e.g. Money Basics"
              maxLength={80}
            />
          </div>
          <div>
            <FieldLabel htmlFor="channel_niche">Niche</FieldLabel>
            <select
              id="channel_niche"
              value={niche}
              onChange={(event) => setNiche(event.target.value as Niche)}
              className={inputClass}
            >
              {NICHES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            {nicheHint && <p className="mt-1.5 text-xs text-zinc-500">{nicheHint}</p>}
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div><FieldLabel htmlFor="target_region">Target region</FieldLabel><select id="target_region" value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass}><option>India</option><option>United States</option><option>GCC</option><option>United Kingdom</option><option>Canada</option><option>Australia</option><option>Global</option></select></div>
          <div><FieldLabel htmlFor="target_country">Target country</FieldLabel><input id="target_country" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} placeholder="India / UAE / USA" /></div>
          <div><FieldLabel htmlFor="primary_language">Primary language</FieldLabel><select id="primary_language" value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}><option>English</option><option>Hindi</option><option>Malayalam</option><option>Tamil</option><option>Arabic</option><option>Spanish</option></select></div>
        </div>
        <div>
          <FieldLabel htmlFor="style_notes">
            Style notes <span className="font-normal text-zinc-500">(optional)</span>
          </FieldLabel>
          <textarea
            id="style_notes"
            value={styleNotes}
            onChange={(event) => setStyleNotes(event.target.value)}
            rows={3}
            maxLength={1500}
            className={inputClass}
            placeholder="e.g. Friendly and calm. Target beginners. Never mention specific stocks."
          />
        </div>
        <label className="flex items-center gap-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-sky-500"
          />
          Run this channel on its schedule
        </label>
      </Card>

      <Card className="space-y-6 p-6 sm:p-8">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">Voice and avatar</h2>
          <p className="mt-1 text-sm text-zinc-400">Uses the shared ElevenLabs and HeyGen keys from API Settings.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="elevenlabs_voice_id">ElevenLabs voice ID</FieldLabel>
            <input
              id="elevenlabs_voice_id"
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
              spellCheck={false}
            />
          </div>
          <div>
            <FieldLabel htmlFor="heygen_avatar_id">
              HeyGen avatar ID <span className="font-normal text-zinc-500">(optional)</span>
            </FieldLabel>
            <input
              id="heygen_avatar_id"
              value={avatarId}
              onChange={(event) => setAvatarId(event.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="Avatar for this channel"
              spellCheck={false}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-6 p-6 sm:p-8">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">YouTube credentials</h2>
          <p className="mt-1 text-sm text-zinc-400">
            OAuth credentials and a refresh token for this channel&apos;s own YouTube account. Each channel needs its own
            refresh token.
          </p>
        </div>
        <SecretField
          id="youtube_client_id"
          label="Client ID"
          saved={channel?.secrets.youtube_client_id ?? null}
          value={secrets.youtube_client_id}
          onChange={setSecret("youtube_client_id")}
        />
        <SecretField
          id="youtube_client_secret"
          label="Client Secret"
          saved={channel?.secrets.youtube_client_secret ?? null}
          value={secrets.youtube_client_secret}
          onChange={setSecret("youtube_client_secret")}
        />
        <SecretField
          id="youtube_refresh_token"
          label="Refresh Token"
          saved={channel?.secrets.youtube_refresh_token ?? null}
          value={secrets.youtube_refresh_token}
          onChange={setSecret("youtube_refresh_token")}
          hint="Needs the YouTube upload scope."
        />
        <div>
          <FieldLabel htmlFor="youtube_privacy">Visibility of new uploads</FieldLabel>
          <select
            id="youtube_privacy"
            value={privacy}
            onChange={(event) => setPrivacy(event.target.value as YouTubePrivacy)}
            className={inputClass}
          >
            <option value="private">Private (review before going public)</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </div>
      </Card>

      <Card className="space-y-6 p-6 sm:p-8">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">Schedule</h2>
          <p className="mt-1 text-sm text-zinc-400">
            The first time creates a new video each day; the second publishes the next finished one.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <FieldLabel htmlFor="prepare_time">Create video at</FieldLabel>
            <input
              id="prepare_time"
              type="time"
              value={prepareTime}
              onChange={(event) => setPrepareTime(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel htmlFor="publish_time">Publish at</FieldLabel>
            <input
              id="publish_time"
              type="time"
              value={publishTime}
              onChange={(event) => setPublishTime(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
            <select id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className={inputClass}>
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {result && <Notice tone={result.tone}>{result.text}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {channel && (
            <Button type="button" variant="ghost" onClick={() => void handleDelete()} loading={deleting} className="text-rose-300 hover:text-rose-200">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete channel
            </Button>
          )}
        </div>
        <div className="flex gap-3">
          {!channel && (
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={saving}>
            {channel ? "Save channel" : "Create channel"}
          </Button>
        </div>
      </div>
    </form>
  );
}
