/**
 * Versioned alias of /api/saved-views/[id]/duplicate.
 *
 * Re-exports the handlers from src/app/api/saved-views/[id]/duplicate/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../saved-views/[id]/duplicate/route";
