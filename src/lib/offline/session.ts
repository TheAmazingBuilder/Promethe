/**
 * Offline user identity (§25.5) - module-level current user id.
 *
 * PwaRoot (root layout) renders outside the SessionProvider, so the
 * offline queue cannot read the session from React context. The session
 * provider publishes the signed-in user id here on every identity
 * change (login, logout, account switch); the queue hook reads it.
 * The id is never persisted: on logout it is cleared together with the
 * queue itself.
 */

let currentUserId: string | null = null;
let identityRevision = 0;
const SESSION_CHANNEL = "promethe-offline-session";
let sessionChannel: BroadcastChannel | null = null;

function publishUserId(userId: string | null, isRemote = false): void {
  const changed = currentUserId !== userId;
  currentUserId = userId;
  // Remote broadcasts must always trigger session revalidation, even when
  // the offline module already has this id but React still has stale state.
  if (!changed && !isRemote) return;
  // A revision also detects A -> B -> A transitions while a request is in
  // flight, where comparing only the final user id would miss the switch.
  identityRevision += 1;
  for (const listener of [...listeners]) listener(userId, isRemote);
}

function getSessionChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!sessionChannel) {
    sessionChannel = new BroadcastChannel(SESSION_CHANNEL);
    sessionChannel.addEventListener("message", (event: MessageEvent) => {
      const value = event.data?.userId;
      if (value === null || typeof value === "string") publishUserId(value, true);
    });
  }
  return sessionChannel;
}

const listeners = new Set<(userId: string | null, isRemote: boolean) => void>();

export function getOfflineUserId(): string | null {
  return currentUserId;
}

/** Monotonic in-memory fence for requests spanning an identity transition. */
export function getOfflineIdentityRevision(): number {
  return identityRevision;
}

export function setOfflineUserId(userId: string | null): void {
  if (currentUserId === userId) return;
  publishUserId(userId);
  getSessionChannel()?.postMessage({ userId });
}

export function onOfflineUserIdChange(
  listener: (userId: string | null, isRemote: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
