/**
 * Central shortcut registry (v2.5 Module 4 §4.1).
 *
 * Single source of truth for every global keyboard shortcut: the action
 * id, its default chord, its i18n label and whether the user may reassign
 * it on #/reglages/raccourcis. Chords use the same "mod+k" / "shift+h" /
 * "f" / "?" notation as the privacy provider (mod = Cmd on macOS,
 * Ctrl elsewhere). Stored overrides live in KeyboardShortcut (one row per
 * user + action); absent row = default.
 *
 * Existing behaviour is preserved: palette (mod+k), focus (f), quick
 * trade (q) and privacy (shift+h) keep their current handlers - those
 * handlers now read the effective chord from this registry instead of a
 * hardcoded literal. New actions: "?" opens the cheat sheet, mod+z
 * undoes the last bulk change.
 */
import type { ShortcutDTO } from "@/lib/trading/dto";

export type ShortcutCategory = "navigation" | "actions" | "display";

export interface ShortcutAction {
  id: string;
  defaultKeys: string;
  labelKey: string;
  descKey: string;
  category: ShortcutCategory;
  /** False when the chord lives in another store (privacy prefs). */
  editable: boolean;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "command-palette",
    defaultKeys: "mod+k",
    labelKey: "actions.commandPalette",
    descKey: "actions.commandPaletteDesc",
    category: "navigation",
    editable: true,
  },
  {
    id: "focus-mode",
    defaultKeys: "f",
    labelKey: "actions.focusMode",
    descKey: "actions.focusModeDesc",
    category: "navigation",
    editable: true,
  },
  {
    id: "quick-trade",
    defaultKeys: "q",
    labelKey: "actions.quickTrade",
    descKey: "actions.quickTradeDesc",
    category: "actions",
    editable: true,
  },
  {
    id: "toggle-privacy",
    defaultKeys: "shift+h",
    labelKey: "actions.togglePrivacy",
    descKey: "actions.togglePrivacyDesc",
    category: "display",
    editable: false,
  },
  {
    id: "shortcuts-help",
    defaultKeys: "?",
    labelKey: "actions.shortcutsHelp",
    descKey: "actions.shortcutsHelpDesc",
    category: "navigation",
    editable: true,
  },
  {
    id: "undo-last-change",
    defaultKeys: "mod+z",
    labelKey: "actions.undoLastChange",
    descKey: "actions.undoLastChangeDesc",
    category: "actions",
    editable: true,
  },
  {
    id: "go-search",
    defaultKeys: "mod+shift+f",
    labelKey: "actions.goSearch",
    descKey: "actions.goSearchDesc",
    category: "navigation",
    editable: true,
  },
];

export function defaultKeysFor(actionId: string): string {
  return SHORTCUT_ACTIONS.find((a) => a.id === actionId)?.defaultKeys ?? "";
}

/** Effective chord for an action given the stored overrides (or default). */
export function effectiveKeys(
  actionId: string,
  overrides: ShortcutDTO[]
): string {
  const row = overrides.find((o) => o.actionId === actionId);
  if (row) return row.keys;
  return defaultKeysFor(actionId);
}

/** "mod+k" → ["mod", "k"]; "?" stays ["?"]. */
export function parseChord(chord: string): string[] {
  return chord
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

/** Chord of a keydown event, same notation as the privacy provider. */
export function eventChord(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  const key = event.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return "";
  // "?" needs Shift on most layouts - the chord is just "?".
  if (key === "?") return "?";
  parts.push(key);
  return parts.join("+");
}

/** True when the event matches the chord (order-insensitive, "?" special). */
export function matchesChord(event: KeyboardEvent, chord: string): boolean {
  if (chord === "?") return event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey;
  const wanted = parseChord(chord);
  const got = parseChord(eventChord(event));
  if (wanted.length !== got.length) return false;
  return wanted.every((p) => got.includes(p));
}

/** Human label for a chord: "mod+k" → "Ctrl+K", "shift+h" → "Maj+H". */
export function formatChord(chord: string, locale = "fr"): string {
  return parseChord(chord)
    .map((p) => {
      if (p === "mod") return "Ctrl/⌘";
      if (p === "shift") return locale === "fr" ? "Maj" : "Shift";
      if (p === "alt") return "Alt";
      if (p === "?") return "?";
      return p.toUpperCase();
    })
    .join("+");
}

/** True when the event target is a text field (typing must win over shortcuts). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/** Find the actions whose effective chord collides with `chord`. */
export function findConflicts(
  chord: string,
  actionId: string,
  overrides: ShortcutDTO[]
): ShortcutAction[] {
  const normalized = parseChord(chord).slice().sort().join("+");
  return SHORTCUT_ACTIONS.filter((a) => {
    if (a.id === actionId) return false;
    const keys = effectiveKeys(a.id, overrides);
    return parseChord(keys).slice().sort().join("+") === normalized;
  });
}
