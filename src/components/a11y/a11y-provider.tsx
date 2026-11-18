"use client";

/**
 * v2.5 Module 8 — A11yProvider (§3.3).
 *
 * Owns the accessibility slice of UserDisplayPreference: text scale, contrast
 * mode, reduced motion, font family, line/letter spacing, focus ring, touch
 * targets, underline links, tabular numbers. localStorage is the instant
 * source (the pre-paint script already applied the attributes before first
 * paint — no flash); on login the server row is adopted when the device has
 * no stored value (per-device override otherwise, §2). Every change applies
 * immediately via applyA11yToDocument() and syncs to the server (debounced
 * partial PUT).
 *
 * Reduced motion also exposes `prefersReducedMotion` for chart components
 * (Recharts animations) through useA11yPrefs().
 */
import * as React from "react";
import { useSession } from "@/components/app/session-context";
import { apiFetch } from "@/lib/api-client";
import {
  applyA11yToDocument,
  normalizeA11yPreferences,
  persistA11y,
  readStoredA11y,
  type A11yPreferences,
} from "@/lib/a11y/preferences";

interface A11yContextValue {
  preferences: A11yPreferences;
  set: (patch: Partial<A11yPreferences>) => void;
  reset: () => void;
  /** Effective reduced-motion (manual override or OS preference). */
  reducedMotionActive: boolean;
  /** Server sync state. */
  synced: boolean;
}

const A11yContext = React.createContext<A11yContextValue | null>(null);

const A11Y_DEFAULTS = normalizeA11yPreferences(null);

export function A11yProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [preferences, setPreferences] = React.useState<A11yPreferences>(A11Y_DEFAULTS);
  const [synced, setSynced] = React.useState(false);
  const [osReducedMotion, setOsReducedMotion] = React.useState(false);

  // ── Load: localStorage first (instant), then reconcile with the server ────
  React.useEffect(() => {
    const stored = readStoredA11y();
    if (stored) {
      setPreferences(stored);
      applyA11yToDocument(stored);
    }
  }, []);

  const sessionKey = session?.user.id ?? null;
  React.useEffect(() => {
    if (sessionKey == null) {
      setSynced(false);
      return;
    }
    let cancelled = false;
    apiFetch<{ preferences: Record<string, unknown> }>(
      "/api/v1/display-preferences"
    )
      .then((payload) => {
        if (cancelled) return;
        const row = payload.preferences;
        const stored = readStoredA11y();
        if (!stored) {
          // First use on this device — adopt the server row.
          const adopted = normalizeA11yPreferences({
            textScale: row.textScale as number | undefined,
            contrastMode: row.contrastMode as A11yPreferences["contrastMode"],
            reducedMotion: row.reducedMotion as A11yPreferences["reducedMotion"],
            fontFamily: row.fontFamily as A11yPreferences["fontFamily"],
            lineHeight: (row.lineHeight as number | null | undefined) ?? null,
            letterSpacing:
              (row.letterSpacing as number | null | undefined) ?? null,
            focusRingStyle: row.focusRingStyle as A11yPreferences["focusRingStyle"],
            largerTouchTargets: row.largerTouchTargets === true,
            underlineLinks: row.underlineLinks === true,
            tabularNumbers: row.tabularNumbers === true,
          });
          setPreferences(adopted);
          persistA11y(adopted);
          applyA11yToDocument(adopted);
        }
        setSynced(true);
      })
      .catch(() => {
        if (!cancelled) setSynced(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  // ── Apply on every change ────────────────────────────────────────────────
  React.useEffect(() => {
    applyA11yToDocument(preferences);
    persistA11y(preferences);
  }, [preferences]);

  // ── Debounced server sync (a11y slice only) ──────────────────────────────
  const syncTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (sessionKey == null) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      apiFetch("/api/v1/display-preferences", {
        method: "PUT",
        body: JSON.stringify({
          textScale: preferences.textScale,
          contrastMode: preferences.contrastMode,
          reducedMotion: preferences.reducedMotion,
          fontFamily: preferences.fontFamily,
          lineHeight: preferences.lineHeight,
          letterSpacing: preferences.letterSpacing,
          focusRingStyle: preferences.focusRingStyle,
          largerTouchTargets: preferences.largerTouchTargets,
          underlineLinks: preferences.underlineLinks,
          tabularNumbers: preferences.tabularNumbers,
        }),
      })
        .then(() => setSynced(true))
        .catch(() => setSynced(false));
    }, 800);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [sessionKey, preferences]);

  // ── OS reduced-motion (for SYSTEM mode + charts) ─────────────────────────
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setOsReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const set = React.useCallback((patch: Partial<A11yPreferences>) => {
    setPreferences((prev) => normalizeA11yPreferences({ ...prev, ...patch }));
  }, []);

  const reset = React.useCallback(() => {
    setPreferences(A11Y_DEFAULTS);
  }, []);

  const reducedMotionActive =
    preferences.reducedMotion === "ON" ||
    (preferences.reducedMotion === "SYSTEM" && osReducedMotion);

  const value = React.useMemo<A11yContextValue>(
    () => ({ preferences, set, reset, reducedMotionActive, synced }),
    [preferences, set, reset, reducedMotionActive, synced]
  );

  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>;
}

export function useA11yPrefs(): A11yContextValue {
  const ctx = React.useContext(A11yContext);
  if (!ctx) {
    throw new Error("useA11yPrefs must be used inside <A11yProvider>");
  }
  return ctx;
}
