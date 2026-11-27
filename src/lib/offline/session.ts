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
const SESSION_CHANNEL = "promethe-offline-session";
let sessionChannel: BroadcastChannel | null = null;

function publishUserId(userId: string | null): void {
  if (currentUserId === userId) return;
  currentUserId = userId;
  for (const listener of [...listeners]) listener(userId);
}

function getSessionChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!sessionChannel) {
    sessionChannel = new BroadcastChannel(SESSION_CHANNEL);
    sessionChannel.addEventListener("message", (event: MessageEvent) => {
      const value = event.data?.userId;
      if (value === null || typeof value === "string") publishUserId(value);
    });
  }
  return sessionChannel;
}

const listeners = new Set<(userId: string | null) => void>();

export function getOfflineUserId(): string | null {
  return currentUserId;
}

export function setOfflineUserId(userId: string | null): void {
  if (currentUserId === userId) return;
  publishUserId(userId);
  getSessionChannel()?.postMessage({ userId });
}

export function onOfflineUserIdChange(
  listener: (userId: string | null) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
