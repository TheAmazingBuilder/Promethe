import { Prisma } from "@prisma/client";
import { isDeletedIncluded } from "./deleted-scope";
import { SOFT_DELETE_MODELS } from "./constants";

/**
 * Soft-delete Prisma client extension (v2.5 Module 4 §4.6).
 *
 * Excludes `deletedAt IS NOT NULL` rows from every default read of the
 * soft-delete models (trade, journalEntry, strategy, tag):
 *
 *  - findMany / findFirst / findFirstOrThrow / count / aggregate / groupBy:
 *    the user's `where` is preserved and combined via `AND: [{ deletedAt: null }]`.
 *  - findUnique / findUniqueOrThrow: Prisma does not allow extra filters on
 *    unique inputs, so the result is post-checked (with `deletedAt` force-
 *    included in `select` when a partial select hides it, then stripped).
 *    A trashed match behaves as "not found" (null / P2025).
 *  - updateMany: same `where` injection — bulk writes never touch trashed rows.
 *
 * Deliberately NOT intercepted:
 *  - create / update / upsert — explicit single-row writes; every server
 *    update path reads the row first (and that read is already filtered).
 *  - delete / deleteMany — permanent deletes stay explicit. Only the trash
 *    purge and the user-deletion cascade call them, both intentionally
 *    (the purge runs inside `withDeleted`).
 *  - Nested relation loads (`include`) bypass model query extensions; the
 *    codebase was audited to have ZERO nested `trades: true` reads — all
 *    trade reads are top-level `db.trade.*`. Keep it that way (grep before
 *    adding one). Trashed strategies/tags referenced by live trades are
 *    filtered in the DTO mappers instead.
 *
 * Escape hatch: `withDeleted(() => ...)` (AsyncLocalStorage) — used by the
 * trash module and the import/sync dedupe only.
 */

/** Read ops whose `where` clause accepts extra filters. */
const FILTERED_READ_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/** Unique-where read ops - result post-check. */
const UNIQUE_READ_OPS = new Set(["findUnique", "findUniqueOrThrow"]);

/** Bulk write ops whose `where` accepts extra filters. */
const FILTERED_WRITE_OPS = new Set(["updateMany"]);

type RawArgs = Record<string, unknown>;

interface GuardParams {
  operation: string;
  args: RawArgs;
  query: (args: RawArgs) => Promise<unknown>;
}

/** Combine the caller's where with `deletedAt: null` (existing AND preserved). */
function injectNotDeleted(args: RawArgs): RawArgs {
  const where = (args.where ?? {}) as RawArgs;
  const existingAnd = Array.isArray(where.AND)
    ? (where.AND as unknown[])
    : where.AND != null
      ? [where.AND]
      : [];
  return {
    ...args,
    where: { ...where, AND: [...existingAnd, { deletedAt: null }] },
  };
}

/** Post-check helper result for unique reads. */
interface PreparedUnique {
  args: RawArgs;
  /** True when the caller's own select already asked for deletedAt. */
  stripDeletedAt: boolean;
}

/** Force `deletedAt` into a partial select so the post-check can see it. */
function prepareUnique(args: RawArgs): PreparedUnique {
  const select = args.select as RawArgs | undefined;
  if (select != null && !("deletedAt" in select)) {
    return {
      args: { ...args, select: { ...select, deletedAt: true } },
      stripDeletedAt: true,
    };
  }
  return { args, stripDeletedAt: false };
}

function softDeleteGuard({ operation, args, query }: GuardParams): Promise<unknown> {
  if (isDeletedIncluded()) return query(args);

  if (FILTERED_READ_OPS.has(operation) || FILTERED_WRITE_OPS.has(operation)) {
    return query(injectNotDeleted(args));
  }

  if (UNIQUE_READ_OPS.has(operation)) {
    const { args: prepared, stripDeletedAt } = prepareUnique(args);
    return query(prepared).then((result) => {
      const row = result as ({ deletedAt?: Date | null } | null) | undefined;
      if (row != null && row.deletedAt != null) {
        if (operation === "findUniqueOrThrow") {
          throw new Prisma.PrismaClientKnownRequestError(
            "Soft-deleted row excluded by the trash extension",
            { code: "P2025", clientVersion: Prisma.prismaVersion.client }
          );
        }
        return null;
      }
      if (stripDeletedAt && row != null) delete row.deletedAt;
      return result;
    });
  }

  return query(args);
}

/**
 * The extension object — apply on the shared client in src/lib/db.ts.
 * Query-only: the client's public surface is unchanged at runtime.
 *
 * The `$allOperations` guard is deliberately model-agnostic (one generic
 * implementation for all soft-delete models); Prisma's generated per-model
 * operation types cannot express that, hence the single confined cast.
 */
const QUERY_MAP = Object.fromEntries(
  SOFT_DELETE_MODELS.map((model) => [model, { $allOperations: softDeleteGuard }])
);

export const softDeleteExtension = Prisma.defineExtension({
  name: "softDeleteTrash",
  query: QUERY_MAP as Parameters<typeof Prisma.defineExtension>[0] extends infer T
    ? T extends { query: infer Q }
      ? Q
      : never
    : never,
});
