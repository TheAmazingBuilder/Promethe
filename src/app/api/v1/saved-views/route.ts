/**
 * Versioned alias of /api/saved-views.
 *
 * Re-exports the handlers from src/app/api/saved-views/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../saved-views/route";
