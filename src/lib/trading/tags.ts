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
  { name: "SL déplacé", kind: "MISTAKE", color: "#ef4444" },
  { name: "Pas de SL", kind: "MISTAKE", color: "#ef4444" },
  { name: "Position trop grosse", kind: "MISTAKE", color: "#f97316" },
  { name: "Sortie trop tôt", kind: "MISTAKE", color: "#f97316" },
  { name: "Entrée trop tardive", kind: "MISTAKE", color: "#f59e0b" },
  { name: "Entrée chassée (chase)", kind: "MISTAKE", color: "#f59e0b" },
  { name: "Overtrading", kind: "MISTAKE", color: "#eab308" },
  { name: "Règles non respectées", kind: "MISTAKE", color: "#ef4444" },
  { name: "Tradé pendant une news", kind: "MISTAKE", color: "#f97316" },
  { name: "Trade de revanche", kind: "MISTAKE", color: "#ef4444" },
  { name: "Entrée FOMO", kind: "MISTAKE", color: "#f59e0b" },
  { name: "Tenu au-delà de l'invalidation", kind: "MISTAKE", color: "#ef4444" },
  // ── Contexte (CONTEXT) ──
  { name: "News économique", kind: "CONTEXT", color: "#8b5cf6" },
  { name: "Ouverture du marché", kind: "CONTEXT", color: "#8b5cf6" },
  { name: "Fin de semaine", kind: "CONTEXT", color: "#8b5cf6" },
  { name: "Liquidité faible", kind: "CONTEXT", color: "#8b5cf6" },
  // ── Setups (SETUP) ──
  { name: "Cassure", kind: "SETUP", color: "#10b981" },
  { name: "Retracement", kind: "SETUP", color: "#10b981" },
  { name: "Inversion", kind: "SETUP", color: "#10b981" },
  { name: "Continuation de tendance", kind: "SETUP", color: "#10b981" },
  { name: "Range", kind: "SETUP", color: "#10b981" },
];
