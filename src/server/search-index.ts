/**
 * searchText maintenance (v2.5 Module 4 §4.2) — recompute the normalized
 * search column after every write. Called from the trades / journal /
 * strategy data-access modules and the import & sync engines, so the
 * column is always consistent regardless of the write path.
 */
import { db } from "@/lib/db";
import {
  buildJournalSearchText,
  buildStrategySearchText,
  buildTradeSearchText,
} from "@/lib/search/text";
import { foldText } from "@/lib/search/text";
import {
  customFieldsSearchText,
  parseCustomFields,
} from "@/lib/custom-fields/validate";
import { activeCustomFieldDefinitions } from "@/server/custom-fields";

/** Recompute Trade.searchText from the stored row (symbol, tags included). */
export async function refreshTradeSearchText(tradeId: string): Promise<void> {
  const row = await db.trade.findFirst({
    where: { id: tradeId },
    include: { instrument: { select: { symbol: true } }, tags: { include: { tag: true } } },
  });
  if (!row) return;
  // v2.5 Module 4 — custom-field values are searchable too.
  const defs = await activeCustomFieldDefinitions(row.userId);
  const customText = customFieldsSearchText(parseCustomFields(row.customFields), defs);
  await db.trade.update({
    where: { id: tradeId },
    data: {
      searchText:
        buildTradeSearchText({
          symbol: row.instrument.symbol,
          setupType: row.setupType,
          notes: row.notes,
          preTradeAnalysis: row.preTradeAnalysis,
          postTradeReview: row.postTradeReview,
          lessonLearned: row.lessonLearned,
          brokerComment: row.brokerComment,
          tagNames: row.tags
            .filter((tt) => tt.tag.deletedAt == null)
            .map((tt) => tt.tag.name),
        }) + (customText ? ` ${foldText(customText)}` : ""),
    },
  });
}

/** Recompute JournalEntry.searchText from the stored row. */
export async function refreshJournalSearchText(entryId: string): Promise<void> {
  const row = await db.journalEntry.findFirst({ where: { id: entryId } });
  if (!row) return;
  await db.journalEntry.update({
    where: { id: entryId },
    data: {
      searchText: buildJournalSearchText({
        date: row.date,
        preMarketPlan: row.preMarketPlan,
        postMarketReview: row.postMarketReview,
        keyLevels: row.keyLevels,
        primaryScenario: row.primaryScenario,
        alternateScenario: row.alternateScenario,
        invalidationConditions: row.invalidationConditions,
        keyLesson: row.keyLesson,
        marketBias: row.marketBias,
        nextSessionCommitment: row.nextSessionCommitment,
      }),
    },
  });
}

/** Recompute Strategy.searchText from the stored row. */
export async function refreshStrategySearchText(strategyId: string): Promise<void> {
  const row = await db.strategy.findFirst({ where: { id: strategyId } });
  if (!row) return;
  await db.strategy.update({
    where: { id: strategyId },
    data: {
      searchText: buildStrategySearchText({
        name: row.name,
        description: row.description,
        entryRules: row.entryRules,
        exitRules: row.exitRules,
        riskRules: row.riskRules,
      }),
    },
  });
}
