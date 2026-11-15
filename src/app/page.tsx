import { AppRoot } from "@/components/app/app-root";
import { getSession } from "@/server/session";
import { cookies } from "next/headers";

/**
 * Single visible route: the server resolves the session cookie (no flash of
 * the auth screen for logged-in users) and hydrates the SPA shell.
 */
export default async function Home() {
  const session = await getSession();
  const jar = await cookies();
  const sidebarOpen = jar.get("sidebar_state")?.value !== "false";
  return <AppRoot initialSession={session} defaultSidebarOpen={sidebarOpen} />;
}
