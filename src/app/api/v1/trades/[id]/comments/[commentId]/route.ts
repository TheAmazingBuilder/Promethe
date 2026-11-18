/**
 * Versioned alias of /api/trades/[id]/comments/[commentId].
 *
 * Re-exports the handlers from src/app/api/trades/[id]/comments/[commentId]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../../trades/[id]/comments/[commentId]/route";
