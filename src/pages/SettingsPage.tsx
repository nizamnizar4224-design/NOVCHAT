import { Loader2 } from "lucide-react";
import { ApiKeysForm } from "@/components/settings/ApiKeysForm";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { Notice } from "@/components/ui/primitives";
import type { useSettingsStatus } from "@/hooks/useSettingsStatus";

type SettingsPageProps = {
  settings: ReturnType<typeof useSettingsStatus>;
};

export function SettingsPage({ settings }: SettingsPageProps) {
  const { settings: values, error, refresh } = settings;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">API Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Keys are stored privately in your database and only ever used by the server. For safety the browser shows just
          the last four characters of a saved key; type a new value to replace it.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {!values && !error && (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading settings...
        </div>
      )}

      {values && <ApiKeysForm settings={values} onSaved={refresh} />}
      <SecurityCard />
    </div>
  );
}
