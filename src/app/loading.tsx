/**
 * Root loading state — shown while a page's server payload streams in
 * (session lookup in AppPage) during navigation.
 *
 * The app is a SPA: every page mounts the same shell, so one shared
 * loading UI is the useful one — per-route copies would be identical.
 * Plain muted skeleton blocks, no spinner, no animation beyond the
 * pulse (collapsed to instant under prefers-reduced-motion).
 */
export default function Loading() {
  return (
    <div
      className="flex min-h-screen"
      aria-busy="true"
      aria-label="Loading Promethe"
    >
      {/* Sidebar skeleton (desktop only, like the real shell). */}
      <div
        className="hidden w-64 shrink-0 space-y-2 border-r p-4 md:block"
        aria-hidden="true"
      >
        <div className="mb-6 h-7 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-8 animate-pulse rounded-md bg-muted" />
        <div className="h-8 animate-pulse rounded-md bg-muted" />
        <div className="h-8 animate-pulse rounded-md bg-muted" />
        <div className="h-8 animate-pulse rounded-md bg-muted" />
        <div className="h-8 animate-pulse rounded-md bg-muted" />
        <div className="h-8 animate-pulse rounded-md bg-muted" />
      </div>
      {/* Main content skeleton. */}
      <div className="flex-1 space-y-4 p-6" aria-hidden="true">
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-44 animate-pulse rounded-md bg-muted" />
        <div className="h-44 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
