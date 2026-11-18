/**
 * Versioned alias of /api/mentor/[ownerId]/trades.
 *
 * Re-exports the handlers from src/app/api/mentor/[ownerId]/trades/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../mentor/[ownerId]/trades/route";
