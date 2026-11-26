"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/app/error-fallback";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep diagnostics in the browser console; never expose stack traces to users.
    console.error("Application route error", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return <ErrorFallback onRetry={reset} />;
}
