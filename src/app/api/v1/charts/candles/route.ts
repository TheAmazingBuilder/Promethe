/**
 * Versioned alias of /api/charts/candles.
 *
 * Re-exports the handlers from src/app/api/charts/candles/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../charts/candles/route";
