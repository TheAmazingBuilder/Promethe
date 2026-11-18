/**
 * Versioned alias of /api/strategies/stats.
 *
 * Re-exports the handlers from src/app/api/strategies/stats/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../strategies/stats/route";
