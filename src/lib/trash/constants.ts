/**
 * Trash constants (v2.5 Module 4 §4.6).
 *
 * Soft delete applies to user-content entities only (Trade, JournalEntry,
 * Strategy, Tag). Structural entities (Account, Instrument, TradingRule…)
 * keep hard deletes — they are referenced by FKs everywhere and cascading
 * soft deletes would poison every read path (documented in README).
 */

/** Days a trashed item is kept before the daily cron purges it permanently. */
export const TRASH_RETENTION_DAYS = 30;

/** Prisma model names that carry deletedAt / deletedBy. */
export const SOFT_DELETE_MODELS = [
  "trade",
  "journalEntry",
  "strategy",
  "tag",
] as const;

export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

/** Stable entity discriminators used by the trash API / ChangeLog. */
export const TRASH_ENTITIES = [
  "TRADE",
  "JOURNAL_ENTRY",
  "STRATEGY",
  "TAG",
] as const;

export type TrashEntity = (typeof TRASH_ENTITIES)[number];

/** Map a trash entity discriminator to its Prisma model name. */
export const ENTITY_TO_MODEL: Record<TrashEntity, SoftDeleteModel> = {
  TRADE: "trade",
  JOURNAL_ENTRY: "journalEntry",
  STRATEGY: "strategy",
  TAG: "tag",
};
