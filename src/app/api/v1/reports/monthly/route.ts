/**
 * Versioned alias of /api/reports/monthly.
 *
 * Re-exports the handlers from src/app/api/reports/monthly/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../reports/monthly/route";
