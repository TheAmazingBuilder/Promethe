"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QueryErrorState({
  title = "Unable to load data",
  description = "Something went wrong while loading this information. Please try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
    >
      <AlertCircle className="size-5 text-destructive" aria-hidden="true" />
      <div className="max-w-md space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
