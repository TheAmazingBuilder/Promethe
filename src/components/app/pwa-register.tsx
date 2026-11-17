"use client";

/** Registers the PWA service worker (no-op where unsupported). */
import * as React from "react";

export function PwaRegister() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration fails on plain HTTP (except localhost) or when the
      // browser blocks it - the app works fine without it.
    });
  }, []);
  return null;
}
