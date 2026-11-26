/**
 * Global search (v2.5 Module 4 §4.2) - one folded query over the maintained
 * `searchText` columns (Trade / Strategy / JournalEntry). Multi-term
 * queries AND the terms: every term must appear in the folded column.
 * Accent-insensitive via foldText ("securite" finds "Sécurité").
 */
import { db } from "@/lib/db";
import { foldText } from "@/lib/search/text";
import { buildSnippet } from "@/lib/search/snippet";
import type { SearchPayload, SearchResultItemDTO } from "@/lib/trading/dto";

function foldedTerms(query: string): string[] {
  return foldText(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Prisma `contains` filter for a folded column over all terms. */
function searchTextFilter(terms: string[]) {
  return {
    AND: terms.map((term) => ({ searchText: { contains: term } })),
  };
}

/** First field (in priority order) whose folded text contains a term. */
function pickSnippetField(
  fields: Array<string | null | undefined>,
  terms: string[]
): string {
  for (const field of fields) {
    if (!field) continue;
    const folded = foldText(field);
    if (terms.some((t) => folded.includes(t))) return field;
  }
  return fields.find((f) => f) ?? "";
}

export async function globalSearch(
  userId: string,
  query: string,
  limit: number,
  offset = 0
): Promise<SearchPayload> {
  const terms = foldedTerms(query);
  if (terms.length === 0) {
    return {
      query,
      trades: [],
      strategies: [],
      journal: [],
      total: 0,
      totalTrades: 0,
      totalStrategies: 0,
      totalJournal: 0,
    };
  }
  const where = searchTextFilter(terms);

  // Paged rows + real per-category totals (the totals count every
  // match, not just the returned page - the UI count and the
  // "Show more" affordance depend on them).
  const [tradeRows, strategyRows, journalRows, totalTrades, totalStrategies, totalJournal] =
    await Promise.all([
      db.trade.findMany({
        where: { userId, ...where },
        include: { instrument: { select: { symbol: true } }, account: { select: { name: true } } },
        orderBy: { entryTime: "desc" },
        take: limit,
        skip: offset,
      }),
      db.strategy.findMany({
        where: { userId, ...where },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.journalEntry.findMany({
        where: { userId, ...where },
        orderBy: { date: "desc" },
        take: limit,
        skip: offset,
      }),
      db.trade.count({ where: { userId, ...where } }),
      db.strategy.count({ where: { userId, ...where } }),
      db.journalEntry.count({ where: { userId, ...where } }),
    ]);

  const trades: SearchResultItemDTO[] = tradeRows.map((t) => ({
    id: t.id,
    entity: "trade",
    title: `${t.instrument.symbol} - ${t.direction}`,
    subtitle: `${t.account.name} - ${new Date(t.entryTime).toISOString().slice(0, 10)}`,
    snippet: buildSnippet(
      pickSnippetField(
        [t.notes, t.preTradeAnalysis, t.postTradeReview, t.lessonLearned, t.brokerComment, t.setupType],
        terms
      ),
      query
    ),
    href: `/trades/${t.id}`,
  }));

  const strategies: SearchResultItemDTO[] = strategyRows.map((s) => ({
    id: s.id,
    entity: "strategy",
    title: s.name,
    subtitle: s.status,
    snippet: buildSnippet(
      pickSnippetField([s.description, s.entryRules, s.exitRules, s.riskRules], terms),
      query
    ),
    href: `/strategies`,
  }));

  const journal: SearchResultItemDTO[] = journalRows.map((j) => ({
    id: j.id,
    entity: "journal",
    title: `Journal - ${j.date}`,
    subtitle: j.marketBias ?? null,
    snippet: buildSnippet(
      pickSnippetField([j.preMarketPlan, j.postMarketReview, j.keyLesson], terms),
      query
    ),
    href: `/journal/${j.date}`,
  }));

  return {
    query,
    trades,
    strategies,
    journal,
    total: totalTrades + totalStrategies + totalJournal,
    totalTrades,
    totalStrategies,
    totalJournal,
  };
}
