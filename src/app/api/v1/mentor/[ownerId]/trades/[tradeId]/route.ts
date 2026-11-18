/**
 * Versioned alias of /api/mentor/[ownerId]/trades/[tradeId].
 *
 * Re-exports the handlers from src/app/api/mentor/[ownerId]/trades/[tradeId]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../../mentor/[ownerId]/trades/[tradeId]/route";
