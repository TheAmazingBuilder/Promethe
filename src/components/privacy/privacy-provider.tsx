"use client";

/**
 * v2.5 Module 8 — PrivacyProvider (§3.1 / §3.2).
 *
 * Owns the privacy slice of UserDisplayPreference:
 *  - localStorage is the instant source (pre-paint script already applied the
 *    CSS attributes before hydration);
 *  - on login the server row is fetched: when this device has no stored value
 *    the server value is ADOPTED, otherwise the device value wins (per-device
 *    override, §2);
 *  - every change is persisted locally AND synced to the server (debounced
 *    partial PUT — the a11y/time slices are never touched);
 *  - auto-privacy triggers: window blur / tab hidden, inactivity timer
 *    (screen-share detection is NOT possible in a web app — documented; the
 *    manual toggle and the "presenting" preset cover that use case);
 *  - the configurable shortcut (default Shift+H) toggles the mode globally.
 *
 * Performance (§6): the provider itself does NOT re-render the tree — it
 * only writes the data-privacy attribute on <html> (CSS blur) and notifies
 * the external store; <Money>/<Sensitive>/useFormat() subscribers update.
 */
import * as React from "react";
import { useSession } from "@/components/app/session-context";
import { apiFetch } from "@/lib/api-client";
import {
  engageAutoPrivacy,
  loadPrivacyState,
  readStoredPrivacy,
  releaseAutoPrivacy,
  setPrivacy,
  subscribePrivacy,
  getPrivacySnapshot,
} from "@/lib/privacy/store";
import type {
  PrivacyAutoEnable,
  PrivacyMode,
  PrivacyPreferences,
  PrivacyScope,
} from "@/lib/privacy/types";

/** Normalizes a KeyboardEvent into a chord string ("shift+h", "mod+k"…). */
function eventChord(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  const key = event.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return "";
  parts.push(key);
  return parts.join("+");
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

interface PrivacyContextValue {
  preferences: PrivacyPreferences;
  setMode: (mode: PrivacyMode) => void;
  setScope: (scope: Partial<PrivacyScope>) => void;
  setAuto: (auto: Partial<PrivacyAutoEnable>) => void;
  setShortcut: (shortcut: string) => void;
  setBlurScreenshots: (v: boolean) => void;
  setRevealOnHover: (v: boolean) => void;
  /** Server-side: redact amounts in notification bodies (R/pips only). */
  hideAmountsInNotifications: boolean;
  setHideAmountsInNotifications: (v: boolean) => void;
  /** Presenting preset (§3.2): hide amounts + blur screenshots + account names. */
  startPresenting: () => void;
  stopPresenting: () => void;
  isPresenting: boolean;
  /** True while an auto-trigger overrides the user's chosen mode. */
  autoActive: boolean;
  /** Server sync state (settings UI hint). */
  synced: boolean;
}

const PrivacyContext = React.createContext<PrivacyContextValue | null>(null);

/** The presenting preset scope (§3.2): maximal but reversible. */
const PRESENTING_SCOPE: PrivacyScope = {
  hideCurrencyAmounts: true,
  hideLots: true,
  hideBalances: true,
  hideAccountNames: true,
  hideBrokerInfo: true,
  hidePercentages: false,
  hideRAndPips: false,
};

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [autoActive, setAutoActive] = React.useState(false);
  const [synced, setSynced] = React.useState(false);
  const [hideAmountsInNotifications, setHideAmountsInNotificationsState] =
    React.useState(false);
  const [isPresenting, setIsPresenting] = React.useState(false);
  const presentingBackup = React.useRef<PrivacyPreferences | null>(null);
  const preferences = React.useSyncExternalStore(
    subscribePrivacy,
    getPrivacySnapshot,
    () => getPrivacySnapshot()
  );

  // ── Server reconciliation (per device) ────────────────────────────────────
  const sessionKey = session?.user.id ?? null;
  React.useEffect(() => {
    if (sessionKey == null) {
      setSynced(false);
      return;
    }
    let cancelled = false;
    apiFetch<{ preferences: Record<string, unknown> }>(
      "/api/display-preferences"
    )
      .then((payload) => {
        if (cancelled) return;
        const row = payload.preferences;
        const stored = readStoredPrivacy();
        // Device value wins (per-device override); first use adopts the row.
        if (stored) {
          // Adopt server-side-only fields the device cannot know about.
          setPrivacy({
            shortcut: typeof row.privacyShortcut === "string" ? row.privacyShortcut : undefined,
          });
        } else {
          loadPrivacyState(
            {
              mode: (row.privacyMode as PrivacyMode) ?? "OFF",
              scope: (row.privacyScope as PrivacyScope) ?? undefined,
              auto: (row.privacyAutoEnable as PrivacyAutoEnable) ?? undefined,
              shortcut: (row.privacyShortcut as string) ?? undefined,
              blurScreenshots: row.blurScreenshots === true,
              revealOnHover: row.revealOnHover !== false,
            },
            { adopt: true }
          );
        }
        setHideAmountsInNotificationsState(
          row.hideAmountsInNotifications === true
        );
        setSynced(true);
      })
      .catch(() => {
        if (!cancelled) setSynced(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  // ── <html> attributes (CSS blur + screenshot blur) ──────────────────────
  React.useEffect(() => {
    const root = document.documentElement;
    if (preferences.mode === "HIDE" || preferences.mode === "BLUR") {
      root.setAttribute("data-privacy", preferences.mode.toLowerCase());
    } else {
      root.removeAttribute("data-privacy");
    }
    if (preferences.revealOnHover) {
      root.removeAttribute("data-privacy-reveal");
    } else {
      root.setAttribute("data-privacy-reveal", "0");
    }
    if (preferences.mode === "BLUR" && preferences.blurScreenshots) {
      root.setAttribute("data-blur-screenshots", "1");
    } else {
      root.removeAttribute("data-blur-screenshots");
    }
  }, [preferences.mode, preferences.revealOnHover, preferences.blurScreenshots]);

  // ── Debounced server sync of the privacy slice ───────────────────────────
  const syncTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (sessionKey == null) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      apiFetch("/api/display-preferences", {
        method: "PUT",
        body: JSON.stringify({
          privacyMode: preferences.mode,
          privacyScope: preferences.scope,
          privacyAutoEnable: preferences.auto,
          privacyShortcut: preferences.shortcut,
          blurScreenshots: preferences.blurScreenshots,
          revealOnHover: preferences.revealOnHover,
        }),
      })
        .then(() => setSynced(true))
        .catch(() => setSynced(false));
    }, 800);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // synced intentionally excluded — sync result, not a trigger.
  }, [
    sessionKey,
    preferences.mode,
    preferences.scope,
    preferences.auto,
    preferences.shortcut,
    preferences.blurScreenshots,
    preferences.revealOnHover,
  ]);

  // ── Auto-privacy: window blur / tab hidden ───────────────────────────────
  React.useEffect(() => {
    const auto = preferences.auto;
    let blurred = false;
    const onWindowBlur = () => {
      if (!auto.onWindowBlur) return;
      blurred = true;
      engageAutoPrivacy();
      setAutoActive(true);
    };
    const onWindowFocus = () => {
      if (!blurred) return;
      blurred = false;
      releaseAutoPrivacy();
      setAutoActive(false);
    };
    const onVisibility = () => {
      if (document.hidden) {
        onWindowBlur();
      } else {
        onWindowFocus();
      }
    };
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [preferences.auto]);

  // ── Auto-privacy: inactivity timer ───────────────────────────────────────
  React.useEffect(() => {
    const seconds = preferences.auto.onInactivitySeconds;
    if (seconds == null || seconds <= 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let engaged = false;
    const engage = () => {
      engaged = true;
      engageAutoPrivacy();
      setAutoActive(true);
    };
    const reset = () => {
      if (engaged) {
        engaged = false;
        releaseAutoPrivacy();
        setAutoActive(false);
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(engage, seconds * 1000);
    };
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "pointerdown",
      "wheel",
      "touchstart",
      "scroll",
    ];
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [preferences.auto]);

  // ── Global shortcut (default Shift+H) ────────────────────────────────────
  React.useEffect(() => {
    const shortcut = preferences.shortcut || "shift+h";
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (eventChord(event) !== shortcut) return;
      event.preventDefault();
      setPrivacy({ mode: getPrivacySnapshot().mode === "OFF" ? "HIDE" : "OFF" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preferences.shortcut]);

  const value = React.useMemo<PrivacyContextValue>(
    () => ({
      preferences,
      setMode: (mode) => {
        setIsPresenting(false);
        presentingBackup.current = null;
        setPrivacy({ mode });
      },
      setScope: (scope) => setPrivacy({ scope }),
      setAuto: (auto) => setPrivacy({ auto }),
      setShortcut: (shortcut) => setPrivacy({ shortcut }),
      setBlurScreenshots: (blurScreenshots) => setPrivacy({ blurScreenshots }),
      setRevealOnHover: (revealOnHover) => setPrivacy({ revealOnHover }),
      hideAmountsInNotifications,
      setHideAmountsInNotifications: (v) => {
        setHideAmountsInNotificationsState(v);
        apiFetch("/api/display-preferences", {
          method: "PUT",
          body: JSON.stringify({ hideAmountsInNotifications: v }),
        }).catch(() => undefined);
      },
      // Presenting preset (§3.2): temporarily apply the maximal privacy state,
      // fully reversible — the previous preferences are restored on stop.
      startPresenting: () => {
        if (isPresenting) return;
        presentingBackup.current = preferences;
        setIsPresenting(true);
        setPrivacy({
          mode: "HIDE",
          scope: PRESENTING_SCOPE,
          blurScreenshots: true,
        });
      },
      stopPresenting: () => {
        const backup = presentingBackup.current;
        presentingBackup.current = null;
        setIsPresenting(false);
        if (backup) {
          loadPrivacyState(backup, { adopt: true });
        } else {
          setPrivacy({ mode: "OFF" });
        }
      },
      isPresenting,
      autoActive,
      synced,
    }),
    [preferences, autoActive, synced, hideAmountsInNotifications, isPresenting]
  );

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacyPreferences(): PrivacyContextValue {
  const ctx = React.useContext(PrivacyContext);
  if (!ctx) {
    throw new Error("usePrivacyPreferences must be used inside <PrivacyProvider>");
  }
  return ctx;
}
