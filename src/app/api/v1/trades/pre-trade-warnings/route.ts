/**
 * Versioned alias of /api/trades/pre-trade-warnings.
 *
 * Re-exports the handlers from src/app/api/trades/pre-trade-warnings/route.ts
 * so the versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../trades/pre-trade-warnings/route";
