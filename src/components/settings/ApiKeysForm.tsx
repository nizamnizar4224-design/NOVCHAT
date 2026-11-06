import { useState, type FormEvent } from "react";
import { Card, Button, FieldLabel, inputClass, Notice } from "@/components/ui/primitives";
import { SecretField } from "@/components/settings/SecretField";
import { supabase } from "@/lib/supabase";
import type { AssemblyProviderId, SettingsStatus } from "@/types";

type SecretKey = "openai_api_key" | "heygen_api_key" | "elevenlabs_api_key" | "assembly_api_key";

const EMPTY_SECRETS: Record<SecretKey, string> = {
  openai_api_key: "",
  heygen_api_key: "",
  elevenlabs_api_key: "",
  assembly_api_key: "",
};

type ApiKeysFormProps = {
  settings: SettingsStatus;
  onSaved: () => Promise<void>;
};

export function ApiKeysForm({ settings, onSaved }: ApiKeysFormProps) {
  const [secrets, setSecrets] = useState(EMPTY_SECRETS);
  const [textModel, setTextModel] = useState(settings.openai_text_model ?? "");
  const [imageModel, setImageModel] = useState(settings.openai_image_model ?? "");
  const [templateId, setTemplateId] = useState(settings.assembly_template_id ?? "");
  const [provider, setProvider] = useState<AssemblyProviderId>(settings.assembly_provider);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const setSecret = (key: SecretKey) => (value: string) => setSecrets((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setResult(null);

    const patch: Record<string, string | null> = {
      openai_text_model: textModel.trim() || null,
      openai_image_model: imageModel.trim() || null,
      assembly_provider: provider,
      assembly_template_id: templateId.trim() || null,
    };
    for (const key of Object.keys(secrets) as SecretKey[]) {
      const value = secrets[key].trim();
      if (value) patch[key] = value;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("api_settings")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) {
        setResult({ tone: "error", text: "Your settings could not be saved. Please try again." });
        return;
      }
      setSecrets(EMPTY_SECRETS);
      await onSaved();
      setResult({ tone: "success", text: "API settings saved." });
    } catch {
      setResult({ tone: "error", text: "Network error while saving. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="space-y-6 p-6 sm:p-8">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">AI and voice providers</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Shared by every channel. Voice and avatar IDs, and YouTube credentials, are set per channel on the Channels
            page.
          </p>
        </div>
        <SecretField
          id="openai_api_key"
          label="OpenAI API key"
          saved={settings.openai_api_key}
          value={secrets.openai_api_key}
          onChange={setSecret("openai_api_key")}
          hint="Used for topic research, scripts, metadata and thumbnail images. Get a key at platform.openai.com/api-keys."
        />
        <SecretField
          id="elevenlabs_api_key"
          label="ElevenLabs API key"
          saved={settings.elevenlabs_api_key}
          value={secrets.elevenlabs_api_key}
          onChange={setSecret("elevenlabs_api_key")}
          hint="Generates the voiceover narration."
        />
      </Card>

      <Card className="space-y-6 p-6 sm:p-8">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">OpenAI models</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Model IDs change over time. Leave a field empty to use the built-in default.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="openai_text_model">Script model</FieldLabel>
            <input
              id="openai_text_model"
              value={textModel}
              onChange={(event) => setTextModel(event.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="gpt-6-luna"
              spellCheck={false}
            />
          </div>
          <div>
            <FieldLabel htmlFor="openai_image_model">Thumbnail image model</FieldLabel>
            <input
              id="openai_image_model"
              value={imageModel}
              onChange={(event) => setImageModel(event.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="gpt-image-2.5-flare"
              spellCheck={false}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-6 p-6 sm:p-8">
        <div>
          <h2 className="text-base font-semibold text-zinc-50">Video editing</h2>
          <p className="mt-1 text-sm text-zinc-400">
HeyGen is disabled. The pipeline sends the ElevenLabs voiceover and script information directly to Creatomate, then creates the thumbnail after the video is ready.
          </p>
        </div>
        <div>
          <FieldLabel htmlFor="assembly_provider">Editing provider</FieldLabel>
          <select
            id="assembly_provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as AssemblyProviderId)}
            className={inputClass}
          >
            <option value="none">None</option>
            <option value="creatomate">Creatomate (integrated)</option>
            <option value="shotstack">Shotstack (not implemented)</option>
          </select>
        </div>
        {provider === "creatomate" && (
          <div>
            <FieldLabel htmlFor="assembly_template_id">Creatomate Template ID</FieldLabel>
            <input id="assembly_template_id" value={templateId} onChange={(event) => setTemplateId(event.target.value)} className={`${inputClass} font-mono`} placeholder="Paste your Creatomate template ID" spellCheck={false} />
            <p className="mt-1.5 text-xs text-zinc-500">Your Creatomate template should contain dynamic elements named Video-Title, Narration-Audio, Caption-Text and Scene-Plan. Add your own visual/background layers to the template.</p>
          </div>
        )}
        <SecretField
          id="assembly_api_key"
          label="Editing provider API key"
          saved={settings.assembly_api_key}
          value={secrets.assembly_api_key}
          onChange={setSecret("assembly_api_key")}
          hint="Creatomate API key. Used by the server to submit renders and poll render status."
        />
      </Card>

      {result && <Notice tone={result.tone}>{result.text}</Notice>}

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Save API settings
        </Button>
      </div>
    </form>
  );
}
