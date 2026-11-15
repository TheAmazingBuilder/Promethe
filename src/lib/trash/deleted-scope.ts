import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Include-deleted escape hatch (v2.5 Module 4 §4.6).
 *
 * The soft-delete Prisma extension filters `deletedAt IS NOT NULL` out of
 * every default read. The trash module (list / restore / purge) and the
 * import/sync dedupe (trashed rows still hold the (accountId, externalId)
 * unique key) are the ONLY consumers allowed to see soft-deleted rows —
 * they run their queries inside `withDeleted(...)`.
 */
interface DeletedScope {
  includeDeleted: true;
}

/**
 * The storage lives on globalThis on purpose (same pattern as the Prisma
 * client cache in src/lib/db.ts): Next.js dev recompiles route bundles and
 * can re-instantiate this module while the cached extended Prisma client
 * keeps the ORIGINAL extension closure. Anchoring the AsyncLocalStorage on
 * globalThis guarantees every module instance — and therefore every
 * `withDeleted` / `isDeletedIncluded` pair — shares one storage.
 */
const globalForScope = globalThis as unknown as {
  __tjDeletedScopeStorage?: AsyncLocalStorage<DeletedScope>;
};

const storage: AsyncLocalStorage<DeletedScope> =
  globalForScope.__tjDeletedScopeStorage ?? new AsyncLocalStorage<DeletedScope>();
globalForScope.__tjDeletedScopeStorage = storage;

/**
 * Run `fn` with soft-deleted rows visible to Prisma reads.
 *
 * IMPORTANT — the callback is wrapped in an async function on purpose:
 * Prisma client extensions defer `$allOperations` by (at least) one
 * microtask, so a SYNCHRONOUS callback's `storage.run` scope would end
 * before the extension reads it (verified empirically in bun & vitest —
 * see tests/integration/trash.test.ts). The async wrapper keeps the whole
 * promise chain — and therefore the async context — rooted inside the
 * `storage.run` scope.
 */
export function withDeleted<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ includeDeleted: true }, async () => fn());
}

/** True when the current async context explicitly opted into trashed rows. */
export function isDeletedIncluded(): boolean {
  return storage.getStore()?.includeDeleted === true;
}
