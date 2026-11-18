/**
 * Versioned alias of /api/journal.
 *
 * Re-exports the handlers from src/app/api/journal/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../journal/route";
