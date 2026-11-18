import { AppRoot } from "@/components/app/app-root";
import { getSession } from "@/server/session";
import { cookies } from "next/headers";

/**
 * Shared server wrapper for every app page: the server resolves the
 * session cookie (no flash of the auth screen for logged-in users) and
 * renders the same shell. Which view shows comes from the pathname
 * (see src/lib/routes.ts) — the page files themselves are thin wrappers
 * around this helper so the shell stays in exactly one place.
 */
export async function AppPage() {
  const session = await getSession();
  const jar = await cookies();
  const sidebarOpen = jar.get("sidebar_state")?.value !== "false";
  return <AppRoot initialSession={session} defaultSidebarOpen={sidebarOpen} />;
}
