/**
 * Versioned alias of /api/performance-report.
 *
 * Re-exports the handlers from src/app/api/performance-report/route.ts so
 * the versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../performance-report/route";
