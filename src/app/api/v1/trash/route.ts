/**
 * Versioned alias of /api/trash.
 *
 * Re-exports the handlers from src/app/api/trash/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../trash/route";
