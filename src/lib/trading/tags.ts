/**
 * Global preset tags — seeded once (userId = null), available to every user.
 * Users can add their own; presets cannot be edited/deleted.
 */

export interface TagPreset {
  name: string;
  kind: "SETUP" | "MISTAKE" | "CONTEXT" | "CUSTOM";
  color: string;
}

export const PRESET_TAGS: TagPreset[] = [
  // ── Erreurs (MISTAKE) ──
  { name: "SL moved", kind: "MISTAKE", color: "#ef4444" },
  { name: "No SL", kind: "MISTAKE", color: "#ef4444" },
  { name: "Position too big", kind: "MISTAKE", color: "#f97316" },
  { name: "Exited too early", kind: "MISTAKE", color: "#f97316" },
  { name: "Late entry", kind: "MISTAKE", color: "#f59e0b" },
  { name: "Chased entry (chase)", kind: "MISTAKE", color: "#f59e0b" },
  { name: "Overtrading", kind: "MISTAKE", color: "#eab308" },
  { name: "Rules not followed", kind: "MISTAKE", color: "#ef4444" },
  { name: "Traded during news", kind: "MISTAKE", color: "#f97316" },
  { name: "Revenge trade", kind: "MISTAKE", color: "#ef4444" },
  { name: "FOMO entry", kind: "MISTAKE", color: "#f59e0b" },
  { name: "Held past invalidation", kind: "MISTAKE", color: "#ef4444" },
  // ── Contexte (CONTEXT) ──
  { name: "Economic news", kind: "CONTEXT", color: "#8b5cf6" },
  { name: "Market open", kind: "CONTEXT", color: "#8b5cf6" },
  { name: "Weekend", kind: "CONTEXT", color: "#8b5cf6" },
  { name: "Low liquidity", kind: "CONTEXT", color: "#8b5cf6" },
  // ── Setups (SETUP) ──
  { name: "Breakout", kind: "SETUP", color: "#10b981" },
  { name: "Retracement", kind: "SETUP", color: "#10b981" },
  { name: "Inversion", kind: "SETUP", color: "#10b981" },
  { name: "Trend continuation", kind: "SETUP", color: "#10b981" },
  { name: "Range", kind: "SETUP", color: "#10b981" },
];
