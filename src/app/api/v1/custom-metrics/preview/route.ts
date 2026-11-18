/**
 * Versioned alias of /api/custom-metrics/preview.
 *
 * Re-exports the handlers from src/app/api/custom-metrics/preview/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../custom-metrics/preview/route";
