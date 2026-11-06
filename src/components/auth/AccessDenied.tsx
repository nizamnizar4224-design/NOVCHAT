import { ShieldAlert } from "lucide-react";
import { Button, Card, Notice } from "@/components/ui/primitives";

export function AccessDenied({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/15">
          <ShieldAlert className="h-6 w-6 text-rose-400" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-zinc-50">Access restricted</h1>
        <p className="mt-2 text-sm text-zinc-400">This console is private and belongs to a different owner account.</p>
        <div className="mt-6">
          <Notice tone="info">Sign in with the owner account you created during setup.</Notice>
        </div>
        <Button variant="secondary" className="mt-6 w-full" onClick={onSignOut}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
