"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/app/error-fallback";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application root error", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <ErrorFallback onRetry={reset} />
      </body>
    </html>
  );
}
