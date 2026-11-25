/**
 * Gaïa full-text search ranking (Lot 11, roadmap §15).
 *
 * Search used to be a plain substring match sorted by recency: a note
 * whose title matched ranked the same as a note that merely mentioned the
 * word once in its body, and the reported total was capped at the page
 * size. Ranking is now deterministic and relevance-first:
 *
 * - the query is split into tokens; EVERY token must match somewhere
 *   (AND semantics), so multi-word queries narrow instead of widening;
 * - tokens and haystacks are accent-folded and lowercased, so "cafe"
 *   finds "café" and "Resume" finds "résumé";
 * - a title hit scores highest, then a tag hit, then a body hit;
 * - ties break by most recently updated.
 */

export interface SearchableNote {
  title: string;
  tagNames: string[];
  bodyText: string;
  updatedAt: string;
}

/** Lowercase + strip accents (NFD + combining marks). */
export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function searchTokens(query: string): string[] {
  return foldSearchText(query)
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

const TITLE_SCORE = 100;
const TAG_SCORE = 50;
const BODY_SCORE = 10;

/**
 * Score of one note for a token list. 0 = no match (at least one token
 * matches nowhere). Title and tag hits dominate body hits.
 */
export function scoreSearchNote(
  note: SearchableNote,
  tokens: string[],
): number {
  if (tokens.length === 0) return 0;
  const title = foldSearchText(note.title);
  const tags = note.tagNames.map((t) => foldSearchText(t));
  const body = foldSearchText(note.bodyText);
  let score = 0;
  for (const token of tokens) {
    let hit = false;
    if (title.includes(token)) {
      score += TITLE_SCORE;
      hit = true;
    }
    if (tags.some((tag) => tag.includes(token))) {
      score += TAG_SCORE;
      hit = true;
    }
    if (body.includes(token)) {
      score += BODY_SCORE;
      hit = true;
    }
    if (!hit) return 0;
  }
  return score;
}

/** Ranked search: relevance first, recency as tiebreak. */
export function rankSearchNotes<T extends SearchableNote>(
  notes: T[],
  query: string,
): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const scored = notes
    .map((note) => ({ note, score: scoreSearchNote(note, tokens) }))
    .filter((entry) => entry.score > 0);
  scored.sort(
    (a, b) =>
      b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt),
  );
  return scored.map((entry) => entry.note);
}
