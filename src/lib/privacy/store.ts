/**
 * v2.5 Module 8 — Privacy runtime store.
 *
 * A tiny external store (no dependency) so that:
 *  - `fmtMoney` / `fmtSignedMoney` / formatters can read the current privacy
 *    state SYNCHRONOUSLY anywhere (they are the single choke point, §1), and
 *  - React components subscribe with `useSyncExternalStore` — only the
 *    components that render sensitive values re-render when the mode
 *    changes, never the whole tree (§6 performance rule).
 *
 * The state is mirrored to localStorage (per-device instant apply, pre-paint
 * script reads it) and reconciled with the server row by the PrivacyProvider.
 *
 * Auto-privacy triggers (window blur / inactivity) remember the user-chosen
 * mode and restore it when the trigger clears.
 */
import {
  DEFAULT_PRIVACY_PREFERENCES,
  isPrivacyMode,
  type PrivacyAutoEnable,
  type PrivacyMode,
  type PrivacyPreferences,
  type PrivacyScope,
} from "./types";

export const PRIVACY_STORAGE_KEY = "tj-privacy";

type Listener = () => void;

const listeners = new Set<Listener>();

/** Snapshot of the defaults (stable identity for SSR + reset). */
const DEFAULT_STATE: PrivacyPreferences = {
  ...DEFAULT_PRIVACY_PREFERENCES,
  scope: { ...DEFAULT_PRIVACY_PREFERENCES.scope },
  auto: { ...DEFAULT_PRIVACY_PREFERENCES.auto },
};

/** Current runtime state (module singleton - one per JS realm). */
let state: PrivacyPreferences = DEFAULT_STATE;

/** The user-chosen mode, tracked separately so auto-triggers can restore it. */
let userMode: PrivacyMode = "OFF";
/** True while an auto-trigger (blur/inactivity) is overriding the mode. */
let autoOverride = false;

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PRIVACY_STORAGE_KEY,
      JSON.stringify({ ...state, mode: userMode })
    );
  } catch {
    // Private mode / quota — privacy still works in-memory for this session.
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** useSyncExternalStore subscription endpoint. */
export function subscribePrivacy(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore snapshot - the CURRENT effective preferences. */
export function getPrivacySnapshot(): PrivacyPreferences {
  return state;
}

/** Server snapshot for useSyncExternalStore during SSR (always defaults). */
export function getPrivacyServerSnapshot(): PrivacyPreferences {
  return DEFAULT_STATE;
}

/** True while an auto-trigger is overriding the user's chosen mode. */
export function isAutoPrivacyActive(): boolean {
  return autoOverride;
}

export interface PrivacyPatch {
  mode?: PrivacyMode;
  scope?: Partial<PrivacyScope>;
  auto?: Partial<PrivacyAutoEnable>;
  shortcut?: string;
  blurScreenshots?: boolean;
  revealOnHover?: boolean;
}

/** Applies a patch, persists it and notifies subscribers. */
export function setPrivacy(patch: PrivacyPatch): void {
  let changed = false;
  // An explicit mode always becomes the user's choice — even while an
  // auto-trigger is overriding the effective mode (the manual action wins).
  if (patch.mode !== undefined) {
    if (patch.mode !== userMode) changed = true;
    userMode = patch.mode;
  }
  if (patch.scope !== undefined) {
    const scope = { ...state.scope, ...patch.scope };
    if (JSON.stringify(scope) !== JSON.stringify(state.scope)) changed = true;
    state = { ...state, scope };
  }
  if (patch.auto !== undefined) {
    const auto = { ...state.auto, ...patch.auto };
    if (JSON.stringify(auto) !== JSON.stringify(state.auto)) changed = true;
    state = { ...state, auto };
  }
  if (patch.shortcut !== undefined && patch.shortcut !== state.shortcut) {
    state = { ...state, shortcut: patch.shortcut };
    changed = true;
  }
  if (patch.blurScreenshots !== undefined) {
    state = { ...state, blurScreenshots: patch.blurScreenshots };
    changed = true;
  }
  if (patch.revealOnHover !== undefined) {
    state = { ...state, revealOnHover: patch.revealOnHover };
    changed = true;
  }

  // Effective mode follows the (possibly new) user mode unless overridden.
  const effectiveMode = autoOverride && userMode === "OFF" ? "HIDE" : userMode;
  if (effectiveMode !== state.mode) {
    state = { ...state, mode: effectiveMode };
    changed = true;
  }
  if (changed) {
    persist();
    notify();
  }
}

/**
 * Auto-trigger entry point (window blur / inactivity): force privacy ON
 * without touching the user's chosen mode. No-op when already overridden.
 */
export function engageAutoPrivacy(): void {
  if (autoOverride) return;
  autoOverride = true;
  if (state.mode === "OFF") {
    state = { ...state, mode: "HIDE" };
    notify();
  }
}

/** Auto-trigger exit (focus / activity): restore the user's chosen mode. */
export function releaseAutoPrivacy(): void {
  if (!autoOverride) return;
  autoOverride = false;
  if (state.mode !== userMode) {
    state = { ...state, mode: userMode };
    notify();
  }
}

/**
 * Replaces the whole state from the server row (login / settings sync).
 * `adopt` = write to localStorage (first use on this device). When the device
 * already has a stored value it wins (per-device override) — the provider
 * decides before calling.
 */
export function loadPrivacyState(
  prefs: PrivacyPreferences,
  opts: { adopt: boolean }
): void {
  const normalized: PrivacyPreferences = {
    mode: isPrivacyMode(prefs.mode) ? prefs.mode : "OFF",
    scope: { ...DEFAULT_PRIVACY_PREFERENCES.scope, ...prefs.scope },
    auto: { ...DEFAULT_PRIVACY_PREFERENCES.auto, ...prefs.auto },
    shortcut: prefs.shortcut || DEFAULT_PRIVACY_PREFERENCES.shortcut,
    blurScreenshots: prefs.blurScreenshots ?? false,
    revealOnHover: prefs.revealOnHover ?? true,
  };
  userMode = normalized.mode;
  autoOverride = false;
  state = normalized;
  if (opts.adopt) persist();
  notify();
}

/** Reads localStorage (browser only) - null when absent or invalid. */
export function readStoredPrivacy(): PrivacyPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PRIVACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PrivacyPreferences>;
    return {
      mode: isPrivacyMode(parsed.mode ?? "") ? (parsed.mode as PrivacyMode) : "OFF",
      scope: { ...DEFAULT_PRIVACY_PREFERENCES.scope, ...parsed.scope },
      auto: { ...DEFAULT_PRIVACY_PREFERENCES.auto, ...parsed.auto },
      shortcut: parsed.shortcut || DEFAULT_PRIVACY_PREFERENCES.shortcut,
      blurScreenshots: parsed.blurScreenshots ?? false,
      revealOnHover: parsed.revealOnHover ?? true,
    };
  } catch {
    return null;
  }
}

// On the client, hydrate from localStorage immediately so the very first
// render (not just the pre-paint CSS) already matches the stored mode.
if (typeof window !== "undefined") {
  const stored = readStoredPrivacy();
  if (stored) {
    userMode = stored.mode;
    state = stored;
  }
}
