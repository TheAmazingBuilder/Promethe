/**
 * Confluences (MRT wave 1, chantier 2) — ICT/SMC confluences tagged on trades.
 *
 * A confluence is a Tag with kind "CONFLUENCE" (see src/lib/validations/trade.ts):
 * no new Prisma model, no migration — the existing Tag + TradeTag join carries
 * them, the trade form already saves tag ids, the trade list already filters
 * by tag id, and the tags settings view already manages them by kind.
 *
 * The predefined list below lives in code ONLY and is NEVER seeded in the
 * database: a Tag row is created on demand, per user, the first time the user
 * picks a predefined confluence (POST /api/tags, upsert by name) or adds a
 * custom one in the trade form. Custom confluences are user-owned tags with
 * kind CONFLUENCE, editable and deletable like any other tag.
 */

export interface ConfluencePreset {
  name: string;
  color: string;
}

/** ICT/SMC confluences adapted to XAUUSD / forex, in the order shown in the form. */
export const CONFLUENCE_PRESETS: ConfluencePreset[] = [
  { name: "Liquidity Sweep", color: "#0ea5e9" },
  { name: "Fair Value Gap", color: "#10b981" },
  { name: "Order Block", color: "#14b8a6" },
  { name: "Break of Structure", color: "#06b6d4" },
  { name: "Change of Character", color: "#3b82f6" },
  { name: "Killzone", color: "#f59e0b" },
  { name: "HTF Aligned", color: "#22c55e" },
  { name: "Premium / Discount", color: "#84cc16" },
  { name: "Equal Highs/Lows", color: "#f97316" },
  { name: "Session Liquidity", color: "#eab308" },
];

export const CONFLUENCE_PRESET_NAMES: ReadonlySet<string> = new Set(
  CONFLUENCE_PRESETS.map((p) => p.name)
);

export const CONFLUENCE_KIND = "CONFLUENCE";

/** Default color for a user-created custom confluence. */
export const CONFLUENCE_CUSTOM_COLOR = "#10b981";

export function isConfluenceTag(tag: { kind: string }): boolean {
  return tag.kind === CONFLUENCE_KIND;
}

export function confluenceTagsOf<T extends { kind: string }>(
  tags: readonly T[]
): T[] {
  return tags.filter(isConfluenceTag);
}
