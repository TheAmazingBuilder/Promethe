/**
 * Search snippets (v2.5 Module 4 §4.2) - shared by the /api/search route
 * and the /search page.
 *
 * Folding (NFD strip + lowercase) changes string length, so a folded index
 * does not map 1:1 onto the raw text. Strategy: try a plain
 * case-insensitive match on the raw text first (covers the common case,
 * including exact accented input); otherwise fall back to the folded
 * position scaled back onto the raw text, which stays close enough for a
 * 120-character window.
 */
import { foldText } from "@/lib/search/text";

/** Short excerpt of `text` centred on the first match of `query`. */
export function buildSnippet(text: string, query: string, radius = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (!query.trim()) return clean.slice(0, radius * 2);
  const lower = clean.toLowerCase();
  const rawIndex = lower.indexOf(query.trim().toLowerCase());
  let index = rawIndex;
  if (index < 0) {
    const folded = foldText(clean);
    const foldedIndex = folded.indexOf(foldText(query.trim()));
    if (foldedIndex >= 0) {
      // Scale the folded offset back onto the raw string.
      index = Math.min(
        clean.length - 1,
        Math.round((foldedIndex / Math.max(1, folded.length)) * clean.length)
      );
    }
  }
  if (index < 0) return clean.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(clean.length, index + query.trim().length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < clean.length ? "..." : "";
  return `${prefix}${clean.slice(start, end)}${suffix}`;
}

/** Split `text` into segments, marking the parts that match `query`. */
export function splitHighlight(
  text: string,
  query: string
): Array<{ text: string; match: boolean }> {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const out: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  let index = lower.indexOf(qLower, cursor);
  if (index < 0) {
    // Accent-insensitive fallback: highlight the whole snippet when the
    // folded query matches but the raw query does not (e.g. "securite").
    if (foldText(text).includes(foldText(q))) {
      return [{ text, match: true }];
    }
    return [{ text, match: false }];
  }
  while (index >= 0) {
    if (index > cursor) out.push({ text: text.slice(cursor, index), match: false });
    out.push({ text: text.slice(index, index + q.length), match: true });
    cursor = index + q.length;
    index = lower.indexOf(qLower, cursor);
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), match: false });
  return out;
}
