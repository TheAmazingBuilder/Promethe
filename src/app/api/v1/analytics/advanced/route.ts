/**
 * Versioned alias of /api/analytics/advanced.
 *
 * Re-exports the handlers from src/app/api/analytics/advanced/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../analytics/advanced/route";
