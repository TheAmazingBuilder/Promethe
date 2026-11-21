"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorFallback({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <main
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-12 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden="true" className="size-6" />
      </div>
      <div className="max-w-md space-y-2">
        <div role="heading" aria-level={1} className="text-xl font-semibold">Something went wrong</div>
        <p className="text-sm text-muted-foreground">
          Promethe couldn’t display this page. Try again. If you just submitted
          a change, check whether it was saved before submitting it again.
        </p>
      </div>
      <Button onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </main>
  );
}
