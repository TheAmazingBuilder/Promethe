/**
 * Versioned alias of /api/charts/annotations.
 *
 * Re-exports the handlers from src/app/api/charts/annotations/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../charts/annotations/route";
