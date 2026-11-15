/**
 * Accent-insensitive text normalization + searchText builders
 * (v2.5 Module 4 §4.2).
 *
 * The sandbox database is SQLite: no tsvector / unaccent / pg_trgm. The
 * Postgres-equivalent design is a MAINTAINED normalized column — every
 * write recomputes `searchText` as the folded (NFD → strip combining
 * marks → lowercase) concatenation of the entity's searchable fields.
 * Queries run LIKE '%folded term%' scoped by userId (Postgres upgrade
 * path: pg_trgm GIN index on the same column — documented in README).
 */

/** Fold to lowercase ASCII-ish: "Sécurité" → "securite". */
export function foldText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Join non-empty parts with a single space (order is irrelevant for LIKE). */
function joinFolded(parts: Array<string | null | undefined>): string {
  return foldText(
    parts
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .join(" ")
  );
}

export interface TradeSearchFields {
  symbol: string;
  setupType?: string | null;
  notes?: string | null;
  preTradeAnalysis?: string | null;
  postTradeReview?: string | null;
  lessonLearned?: string | null;
  brokerComment?: string | null;
  /** Live tag names attached to the trade. */
  tagNames?: string[];
}

/** Trade.searchText — notes, analyses, lesson, setup, symbol, tags, comment. */
export function buildTradeSearchText(f: TradeSearchFields): string {
  return joinFolded([
    f.symbol,
    f.setupType,
    f.notes,
    f.preTradeAnalysis,
    f.postTradeReview,
    f.lessonLearned,
    f.brokerComment,
    ...(f.tagNames ?? []),
  ]);
}

export interface JournalSearchFields {
  date: string;
  preMarketPlan?: string | null;
  postMarketReview?: string | null;
  keyLesson?: string | null;
  marketBias?: string | null;
}

/** JournalEntry.searchText — plan, review, lesson, bias, date. */
export function buildJournalSearchText(f: JournalSearchFields): string {
  return joinFolded([
    f.date,
    f.preMarketPlan,
    f.postMarketReview,
    f.keyLesson,
    f.marketBias,
  ]);
}

export interface StrategySearchFields {
  name: string;
  description?: string | null;
  entryRules?: string | null;
  exitRules?: string | null;
  riskRules?: string | null;
}

/** Strategy.searchText — name, description, all rule bodies. */
export function buildStrategySearchText(f: StrategySearchFields): string {
  return joinFolded([
    f.name,
    f.description,
    f.entryRules,
    f.exitRules,
    f.riskRules,
  ]);
}
