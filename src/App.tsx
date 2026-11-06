import { Loader2 } from "lucide-react";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { AccessDenied } from "@/components/auth/AccessDenied";
import { DashboardPage } from "@/pages/DashboardPage";
import { useAuthSession } from "@/hooks/useAuthSession";

function App() {
  const { access, recheckAccess, signOut } = useAuthSession();

  if (access === "loading" || access === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-sky-400" aria-label="Loading" />
      </div>
    );
  }
  if (access === "signed-out") return <LoginScreen onOwnerClaimed={recheckAccess} />;
  if (access === "locked") return <AccessDenied onSignOut={() => void signOut()} />;
  return <DashboardPage onSignOut={() => void signOut()} />;
}

export default App;
