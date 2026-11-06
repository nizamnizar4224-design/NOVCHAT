import type { ReactNode } from "react";
import { Clapperboard, Film, KeyRound, LayoutDashboard, LogOut, Tv, type LucideIcon } from "lucide-react";

export type DashboardView = "overview" | "videos" | "channels" | "settings";

const NAV_ITEMS: { id: DashboardView; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "videos", label: "Videos", icon: Film },
  { id: "channels", label: "Channels", icon: Tv },
  { id: "settings", label: "API Settings", icon: KeyRound },
];

type AppShellProps = {
  view: DashboardView;
  onNavigate: (view: DashboardView) => void;
  onSignOut: () => void;
  children: ReactNode;
};

export function AppShell({ view, onNavigate, onSignOut, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 md:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950 md:sticky md:top-0 md:flex md:h-screen">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 ring-1 ring-sky-500/30">
            <Clapperboard className="h-5 w-5 text-sky-400" aria-hidden="true" />
          </div>
          <span className="text-base font-semibold tracking-tight">Studio Autopilot</span>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Dashboard sections">
          {NAV_ITEMS.map((item) => (
            <NavButton key={item.id} item={item} active={view === item.id} onClick={() => onNavigate(item.id)} />
          ))}
        </nav>
        <div className="border-t border-zinc-800/80 p-3">
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Clapperboard className="h-5 w-5 text-sky-400" aria-hidden="true" />
              <span className="text-sm font-semibold">Studio Autopilot</span>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 pb-3" aria-label="Dashboard sections">
            {NAV_ITEMS.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={view === item.id}
                onClick={() => onNavigate(item.id)}
                compact
              />
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
  compact = false,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const base = "flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-200";
  const size = compact ? "shrink-0 px-3.5 py-2" : "w-full px-3 py-2.5";
  const state = active
    ? "bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30"
    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100";
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`${base} ${size} ${state}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {item.label}
    </button>
  );
}
