/**
 * Versioned alias of /api/analytics/when-you-trade.
 *
 * Re-exports the handlers from src/app/api/analytics/when-you-trade/route.ts
 * so the versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../analytics/when-you-trade/route";
