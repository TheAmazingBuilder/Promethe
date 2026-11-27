/**
 * Offline queue hook (§25.5) - live queue state plus replay triggers.
 *
 * Two hooks share one module-level controller:
 * - useOfflineQueueState(): live queue state + actions, no global
 *   listeners. The queue panel uses this one.
 * - useOfflineQueue(): the state hook plus the global listeners
 *   (`online` events, service-worker sync messages, replay on mount,
 *   Background Sync registration). Exactly one instance exists, in
 *   PwaRoot (mounted once in the root layout) - the listeners must
 *   never be registered twice.
 */
"use client";

import * as React from "react";
import { getBrowserStore, isOfflineQueueSupported } from "./store";
import { getOfflineUserId, onOfflineUserIdChange } from "./session";
import {
  countActionableItems,
  discardItem,
  expireStaleItems,
  listQueueItems,
  onQueueChange,
} from "./queue";
import {
  createApiReplaySender,
  onNoteSynced,
  replayQueue,
  resolveOfflineConflict,
  type ReplaySummary,
} from "./replay";
import type { OfflineQueueItem } from "./types";

export const OFFLINE_SYNC_TAG = "promethe-offline-replay";

export interface OfflineQueueState {
  supported: boolean;
  userId: string | null;
  items: OfflineQueueItem[];
  actionableCount: number;
  conflictCount: number;
  failedCount: number;
  isOnline: boolean;
  isReplaying: boolean;
  replayNow: () => Promise<ReplaySummary | null>;
  retryItem: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
  resolveConflict: (id: string, choice: "mine" | "server") => Promise<void>;
}

// Module-level connectivity + replay state, shared by every hook
// instance so the panel (no listeners of its own) stays in sync with
// the single listener-owning instance in PwaRoot.
let onlineState: boolean =
  typeof navigator !== "undefined" ? navigator.onLine : true;
const onlineSubscribers = new Set<(online: boolean) => void>();

function publishOnline(value: boolean): void {
  if (value === onlineState) return;
  onlineState = value;
  onlineSubscribers.forEach((cb) => cb(value));
}

function subscribeOnline(cb: (online: boolean) => void): () => void {
  onlineSubscribers.add(cb);
  // A subscriber learns the current value on subscribe: a publish that
  // landed before this subscription (a missed `online` transition, or a
  // stale listener from a previous mount publishing during the commit)
  // can never leave it stranded on a stale snapshot.
  cb(onlineState);
  return () => {
    onlineSubscribers.delete(cb);
  };
}

/**
 * Re-read the browser's connectivity and publish it. Returns true when the
 * state flipped to online.
 *
 * The `online`/`offline` event stream is lossy: a transition that fires
 * before the listeners are attached (page load, bfcache restore), or one
 * the browser never delivers, leaves the displayed state stuck offline
 * even though navigator.onLine is true - the banner then never disappears
 * until the next event. Every re-sync point below re-reads navigator.onLine
 * instead of trusting the last event, so the displayed state converges
 * back to the browser's truth on focus, visibility, restore and on a
 * periodic backstop.
 */
function resyncOnline(): boolean {
  if (typeof navigator === "undefined") return false;
  const next = navigator.onLine;
  const was = onlineState;
  publishOnline(next);
  return !was && next;
}

let replayingState = false;
let activeReplayCount = 0;
const replayingSubscribers = new Set<(replaying: boolean) => void>();

function publishReplaying(value: boolean): void {
  if (value === replayingState) return;
  replayingState = value;
  replayingSubscribers.forEach((cb) => cb(value));
}

function subscribeReplaying(cb: (replaying: boolean) => void): () => void {
  replayingSubscribers.add(cb);
  // Same self-healing rule as subscribeOnline: a subscriber learns the
  // current value on subscribe.
  cb(replayingState);
  return () => {
    replayingSubscribers.delete(cb);
  };
}

// The engine owns single-flight per (store, user). This counter keeps the
// shared UI accurate when distinct user/store replays run concurrently.
async function runReplay(userId: string): Promise<ReplaySummary | null> {
  if (getOfflineUserId() !== userId) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  activeReplayCount += 1;
  publishReplaying(true);
  const controller = new AbortController();
  const unsubscribeSession = onOfflineUserIdChange((nextUserId) => {
    if (nextUserId !== userId) controller.abort();
  });
  try {
    const store = getBrowserStore();
    const sender = await createApiReplaySender(controller.signal);
    if (getOfflineUserId() !== userId) {
      controller.abort();
      return null;
    }
    return await replayQueue(
      store,
      userId,
      sender,
      () => getOfflineUserId() === userId && !controller.signal.aborted,
    );
  } catch {
    return null;
  } finally {
    unsubscribeSession();
    activeReplayCount = Math.max(0, activeReplayCount - 1);
    publishReplaying(activeReplayCount > 0);
  }
}

async function registerBackgroundSync(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || !("SyncManager" in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const syncReg = reg as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    await syncReg.sync?.register(OFFLINE_SYNC_TAG);
  } catch {
    // Background Sync is best-effort: the `online` event covers the rest.
  }
}

/** Queue state + actions, without any global listener. */
export function useOfflineQueueState(): OfflineQueueState {
  // PwaRoot renders outside the SessionProvider, so the user id comes
  // from the offline session module (published by SessionProvider).
  const [userId, setUserId] = React.useState<string | null>(() =>
    getOfflineUserId(),
  );
  const [items, setItems] = React.useState<OfflineQueueItem[]>([]);
  // The rendered online state always derives from the live module store.
  // The previous `useState(() => onlineState)` + subscribe-in-effect
  // pattern could strand this component on a stale snapshot: if a publish
  // landed between the first render and the subscription (a missed
  // `online` transition, or a stale listener from a previous mount
  // publishing during the commit), the module flipped to online while the
  // component still held offline - and every later resync was a no-op,
  // because publishOnline only notifies on a change. The banner then
  // stayed forever even though navigator.onLine was true. With
  // useSyncExternalStore the snapshot is re-read after subscribing and the
  // component re-renders when it changed, so the stuck state is
  // impossible. Server snapshot is online (the server has no navigator).
  const isOnline = React.useSyncExternalStore(
    subscribeOnline,
    () => onlineState,
    () => true,
  );
  const [isReplaying, setIsReplaying] = React.useState(() => replayingState);

  const load = React.useCallback(async () => {
    if (!userId || getOfflineUserId() !== userId || !isOfflineQueueSupported()) {
      setItems([]);
      return;
    }
    try {
      const store = getBrowserStore();
      await expireStaleItems(store, userId);
      const nextItems = await listQueueItems(store, userId);
      if (getOfflineUserId() === userId) setItems(nextItems);
    } catch {
      setItems([]);
    }
  }, [userId]);

  React.useEffect(() => {
    setUserId(getOfflineUserId());
    return onOfflineUserIdChange((id) => setUserId(id));
  }, []);

  React.useEffect(() => {
    void load();
    return onQueueChange(() => void load());
  }, [load]);

  React.useEffect(() => subscribeReplaying(setIsReplaying), []);

  const replayNow = React.useCallback(async (): Promise<ReplaySummary | null> => {
    if (!userId || getOfflineUserId() !== userId || !isOfflineQueueSupported()) return null;
    const summary = await runReplay(userId);
    await load();
    return summary;
  }, [userId, load]);

  const retryItem = React.useCallback(
    async (id: string) => {
      if (!userId || getOfflineUserId() !== userId || !isOfflineQueueSupported()) return;
      const store = getBrowserStore();
      const item = await store.getItem(id);
      if (!item || item.userId !== userId || getOfflineUserId() !== userId) return;
      await store.putItem({
        ...item,
        status: "PENDING",
        attempts: 0,
        retryable: true,
        lastError: null,
      });
      await load();
      await replayNow();
    },
    [userId, load, replayNow],
  );

  const discard = React.useCallback(
    async (id: string) => {
      if (!userId || getOfflineUserId() !== userId || !isOfflineQueueSupported()) return;
      const store = getBrowserStore();
      const item = await store.getItem(id);
      if (!item || item.userId !== userId || getOfflineUserId() !== userId) return;
      await discardItem(store, id);
      await load();
    },
    [userId, load],
  );

  const resolve = React.useCallback(
    async (id: string, choice: "mine" | "server") => {
      if (!userId || getOfflineUserId() !== userId || !isOfflineQueueSupported()) return;
      const store = getBrowserStore();
      const item = await store.getItem(id);
      if (!item || item.userId !== userId || getOfflineUserId() !== userId) return;
      await resolveOfflineConflict(store, id, choice);
      await load();
      if (choice === "mine") await replayNow();
    },
    [userId, load, replayNow],
  );

  const actionableCount = countActionableItems(items);
  const conflictCount = items.filter((item) => item.status === "CONFLICT").length;
  const failedCount = items.filter((item) => item.status === "FAILED").length;

  return {
    supported: isOfflineQueueSupported(),
    userId,
    items,
    actionableCount,
    conflictCount,
    failedCount,
    isOnline,
    isReplaying,
    replayNow,
    retryItem,
    discard,
    resolveConflict: resolve,
  };
}

/**
 * The full hook: queue state plus the global listeners. Call it exactly
 * once, in PwaRoot (mounted once in the root layout).
 */
export function useOfflineQueue(): OfflineQueueState {
  const state = useOfflineQueueState();
  const { replayNow } = state;

  // Replay when the connection returns.
  React.useEffect(() => {
    // Re-sync from the browser on every mount: the module state may be
    // stale from a previous mount (or a previous test). A flip back to
    // online replays the queue, like the `online` event does.
    const handleResync = () => {
      if (resyncOnline()) void replayNow();
    };
    handleResync();
    const handleOnline = () => {
      publishOnline(true);
      void replayNow();
    };
    const handleOffline = () => publishOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // The event stream alone cannot be trusted: re-read navigator.onLine
    // whenever the user comes back to the tab, when a bfcache restore
    // resumes the page (mount effects do not re-run there), and on a
    // periodic backstop, so a missed `online` transition can never leave
    // the offline banner stuck while the browser is online.
    window.addEventListener("focus", handleResync);
    window.addEventListener("pageshow", handleResync);
    document.addEventListener("visibilitychange", handleResync);
    const resyncTimer = window.setInterval(handleResync, 30_000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleResync);
      window.removeEventListener("pageshow", handleResync);
      document.removeEventListener("visibilitychange", handleResync);
      window.clearInterval(resyncTimer);
    };
  }, [replayNow]);

  React.useEffect(() => {
    if (onlineState) void replayNow();
    // Once on mount (and when connectivity is first known online).
  }, []);

  // Background Sync: the service worker relays its `sync` event to every
  // open client, which replays in-page (session auth lives in the page).
  React.useEffect(() => {
    void registerBackgroundSync();
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "promethe-offline-replay") void replayNow();
    };
    navigator.serviceWorker?.addEventListener?.("message", handleMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener?.("message", handleMessage);
    };
  }, [replayNow]);

  return state;
}

/** Re-exported for the Gaïa view: remap a provisional note id after sync. */
export { onNoteSynced };
