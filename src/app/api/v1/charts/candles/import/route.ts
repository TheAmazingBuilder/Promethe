/**
 * Versioned alias of /api/charts/candles/import.
 *
 * Re-exports the handlers from src/app/api/charts/candles/import/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../charts/candles/import/route";
