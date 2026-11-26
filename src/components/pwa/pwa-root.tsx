"use client";

import { useEffect, useState } from "react";
import { Download, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useOfflineQueue } from "@/lib/offline/use-offline-queue";
import { OfflineQueuePanel } from "@/components/offline/offline-queue-panel";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaRoot() {
  const t = useTranslations("offlineQueue");
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  // Single mount point (root layout): this hook owns the online/offline
  // listeners, the replay triggers and the Background Sync registration.
  const queue = useOfflineQueue();
  const { isOnline, actionableCount, conflictCount } = queue;

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => setInstallPrompt(null);

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // The application remains usable when service workers are unavailable.
      });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt || isInstalling) return;

    setIsInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted" || choice.outcome === "dismissed") {
        setInstallPrompt(null);
      }
    } catch {
      // The browser may reject a stale or unavailable prompt. Keep the app
      // usable and leave the action available for another user-initiated try.
    } finally {
      setIsInstalling(false);
    }
  };

  // Offline banner: while offline it shows the queued work; while online
  // it only appears when something still needs attention (a failed or
  // conflicted item never hides behind a green state).
  const showQueueBanner =
    (!isOnline && actionableCount > 0) ||
    (isOnline && (conflictCount > 0 || queue.failedCount > 0));

  return (
    <>
      {showQueueBanner ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 z-[100] flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground shadow-lg"
        >
          <WifiOff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {isOnline
              ? t("onlineBanner", { count: actionableCount })
              : t("offlineBanner", { count: actionableCount })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={queue.isReplaying}
            onClick={() => void queue.replayNow()}
          >
            {queue.isReplaying ? t("syncing") : t("retryNow")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setQueueOpen(true)}>
            {t("viewQueue")}
          </Button>
        </div>
      ) : !isOnline ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 z-[100] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground shadow-lg"
        >
          <WifiOff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>You are offline. Live data is unavailable.</span>
        </div>
      ) : null}

      <OfflineQueuePanel open={queueOpen} onOpenChange={setQueueOpen} />

      {installPrompt ? (
        <div className="fixed bottom-4 right-4 z-[100]">
          <Button
            type="button"
            size="sm"
            onClick={() => void handleInstall()}
            disabled={isInstalling}
            aria-label="Install Promethe"
          >
            <Download aria-hidden="true" />
            Install app
          </Button>
        </div>
      ) : null}
    </>
  );
}
